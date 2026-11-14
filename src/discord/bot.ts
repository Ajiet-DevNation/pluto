/**
 * Discord bot lifecycle for P1.
 *
 * Startup is fail-fast: configuration, guild membership, allowlist access and
 * guild command registration must all succeed. The only permitted history read
 * is the one startup backfill per allowlisted channel.
 */

import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { runStartupBackfill, type BackfillChannel } from './backfill';
import { registerGuildCommands } from './commands';
import { handleMessageCreate, type IntakeContext } from './intake';
import {
  assertEnvMatchesPolicy,
  loadDiscordPolicy,
  requireEnv,
  type DiscordPolicy,
} from './policy';
import { createDefaultStore, type JsonDiscordStore } from './store';
import { defaultLogger, errorMessage } from './types';
import { handleOptOutInteraction, type OptOutInteraction } from '../optout/command';

export interface StartedDiscordBot {
  client: Client;
  store: JsonDiscordStore;
  shutdown: () => Promise<void>;
}

export interface StartDiscordBotOptions {
  env?: NodeJS.ProcessEnv;
  policy?: DiscordPolicy;
  store?: JsonDiscordStore;
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

function asGuildChannel(
  channel: GuildBasedChannel | null | undefined,
  label: string,
  id: string,
): GuildBasedChannel {
  if (!channel) {
    throw new Error(
      `${label} (${id}) is not visible to the bot; check the allowlist and channel permissions`,
    );
  }
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    throw new Error(`${label} (${id}) is not a supported text or announcement channel`);
  }
  return channel;
}

export async function assertGuildAccess(
  guild: Guild,
  policy: DiscordPolicy,
): Promise<void> {
  if (guild.id !== policy.guildId) {
    throw new Error(
      `Resolved guild ${guild.id} does not match configured guild ${policy.guildId}`,
    );
  }

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me) {
    throw new Error('The bot is not a member of the configured guild');
  }

  for (const [name, id] of Object.entries(policy.indexedChannels)) {
    const channel = asGuildChannel(
      guild.channels.cache.get(id) ?? (await guild.channels.fetch(id)),
      `Indexed channel ${name}`,
      id,
    );

    const permissions = channel.permissionsFor(me);
    const required = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.ReadMessageHistory,
    ];
    if (!permissions?.has(required)) {
      throw new Error(
        `Missing View Channel / Read Message History on indexed channel ${name} (${id})`,
      );
    }
  }

  const output = asGuildChannel(
    guild.channels.cache.get(policy.outputChannelId) ??
      (await guild.channels.fetch(policy.outputChannelId)),
    'Output channel',
    policy.outputChannelId,
  );
  const outputPermissions = output.permissionsFor(me);
  const outputRequired = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  if (!outputPermissions?.has(outputRequired)) {
    throw new Error(
      `Missing View Channel / Send Messages / Embed Links on output channel (${policy.outputChannelId})`,
    );
  }
}

async function resolveBackfillChannels(
  guild: Guild,
  policy: DiscordPolicy,
): Promise<BackfillChannel[]> {
  const channels: BackfillChannel[] = [];

  for (const [name, id] of Object.entries(policy.indexedChannels)) {
    const channel = asGuildChannel(
      guild.channels.cache.get(id) ?? (await guild.channels.fetch(id)),
      `Indexed channel ${name}`,
      id,
    ) as GuildTextBasedChannel;

    channels.push({
      channelId: id,
      channelName: name,
      fetchPage: async (after, limit) => {
        const collection = await channel.messages.fetch({ after, limit });
        return Array.from(collection.values());
      },
    });
  }

  return channels;
}

export async function startDiscordBot(
  options: StartDiscordBotOptions = {},
): Promise<StartedDiscordBot> {
  const env = options.env ?? process.env;
  const policy = options.policy ?? loadDiscordPolicy();
  assertEnvMatchesPolicy(policy, env);

  const token = requireEnv('DISCORD_BOT_TOKEN', env);
  const configuredClientId = env.DISCORD_CLIENT_ID?.trim();
  const store = options.store ?? createDefaultStore(env);
  const client = createDiscordClient();

  const context: IntakeContext = {
    guildId: policy.guildId,
    botUserId: '',
    indexedChannelIds: policy.indexedChannelIds,
    outputChannelId: policy.outputChannelId,
    optOutStore: store,
    indexStore: store,
  };

  client.on(Events.MessageCreate, (message: Message) => {
    void handleMessageCreate(message, context);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleOptOutInteraction(interaction as unknown as OptOutInteraction, {
      guildId: policy.guildId,
      optOutStore: store,
      indexStore: store,
    }).catch((error: unknown) => {
      defaultLogger.error('Unhandled Discord interaction error', {
        error: errorMessage(error),
      });
    });
  });

  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });

  try {
    await client.login(token);
    await ready;

    if (!client.user) {
      throw new Error('Discord client became ready without a user');
    }
    context.botUserId = client.user.id;

    if (configuredClientId && configuredClientId !== client.user.id) {
      throw new Error(
        `DISCORD_CLIENT_ID (${configuredClientId}) does not match the logged-in application id (${client.user.id})`,
      );
    }

    const guild = await client.guilds.fetch(policy.guildId);
    await assertGuildAccess(guild, policy);

    await registerGuildCommands({
      set: (commands) => guild.commands.set(commands),
    });

    const channels = await resolveBackfillChannels(guild, policy);
    const results = await runStartupBackfill(channels, {
      guildId: policy.guildId,
      context,
    });

    defaultLogger.info('Discord bot ready', {
      guildId: policy.guildId,
      indexedChannels: channels.length,
      backfill: results.map((result) => ({
        channelId: result.channelId,
        indexed: result.indexed,
        skipped: result.skipped,
        error: result.error,
      })),
    });

    return {
      client,
      store,
      shutdown: async () => {
        client.destroy();
      },
    };
  } catch (error) {
    client.destroy();
    throw new Error(`Discord bot failed to start: ${errorMessage(error)}`);
  }
}
