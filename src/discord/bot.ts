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
import { createDefaultStore } from './store';
import {
  defaultLogger,
  errorMessage,
  type DiscordIndexStore,
  type OptOutStore,
} from './types';
import { handleOptOutInteraction, type OptOutInteraction } from '../optout/command';
import {
  handleDigestInteraction,
  type DigestInteraction,
} from '../digest/command';
import type { DigestService } from '../digest/service';
import {
  handleEventInteraction,
  EVENT_MESSAGES,
  type EventInteraction,
} from '../events/command';
import type { EventRepository } from '../events/repository';
import { handleHelpInteraction, type HelpInteraction } from '../help/command';
import {
  handleUpcomingInteraction,
  type UpcomingInteraction,
} from '../upcoming/command';
import type { UpcomingRepository } from '../upcoming/repository';

export type BotStore = DiscordIndexStore & OptOutStore;

export interface ActivityServices {
  digest?: Pick<DigestService, 'build'>;
  upcoming?: Pick<UpcomingRepository, 'listMeetings' | 'listEvents'>;
  events?: Pick<EventRepository, 'create' | 'getById' | 'cancel'>;
}

export interface StartedDiscordBot {
  client: Client;
  store: BotStore;
  shutdown: () => Promise<void>;
}

export interface StartDiscordBotOptions {
  env?: NodeJS.ProcessEnv;
  policy?: DiscordPolicy;
  store?: BotStore;
  activity?: ActivityServices;
}

const ACTIVITY_MESSAGES = {
  digestUnavailable:
    'The activity database is not configured, so /digest is unavailable.',
  upcomingUnavailable:
    'The activity database is not configured, so /upcoming is unavailable.',
} as const;

async function replyUnavailable(
  interaction: { reply(options: { content: string; ephemeral: boolean }): Promise<unknown> },
  message: string,
): Promise<void> {
  try {
    await interaction.reply({ content: message, ephemeral: true });
  } catch (error) {
    defaultLogger.warn('Failed to send unavailable-command reply', {
      error: errorMessage(error),
    });
  }
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

  if (policy.eventsChannelId) {
    const eventsChannel = asGuildChannel(
      guild.channels.cache.get(policy.eventsChannelId) ??
        (await guild.channels.fetch(policy.eventsChannelId)),
      'Events channel',
      policy.eventsChannelId,
    );
    const eventsPermissions = eventsChannel.permissionsFor(me);
    const eventsRequired = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
    ];
    if (!eventsPermissions?.has(eventsRequired)) {
      throw new Error(
        `Missing View Channel / Send Messages on events channel (${policy.eventsChannelId})`,
      );
    }
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

  const postPublicRecord = async (
    content: string,
  ): Promise<{ messageId?: string } | null> => {
    if (!policy.eventsChannelId) {
      throw new Error('The #events channel is not configured');
    }
    const channel = await client.channels.fetch(policy.eventsChannelId);
    if (!channel) {
      throw new Error('The #events channel is not visible to the bot');
    }
    if (!channel.isSendable()) {
      throw new Error('The #events channel is not a sendable channel');
    }
    const message = await channel.send({
      content,
      allowedMentions: { parse: [] },
    });
    return { messageId: message.id };
  };

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'digest') {
      if (!options.activity?.digest) {
        void replyUnavailable(interaction, ACTIVITY_MESSAGES.digestUnavailable);
        return;
      }
      void handleDigestInteraction(interaction as unknown as DigestInteraction, {
        guildId: policy.guildId,
        digest: options.activity.digest,
      }).catch((error: unknown) => {
        defaultLogger.error('Unhandled /digest interaction error', {
          error: errorMessage(error),
        });
      });
      return;
    }

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === 'upcoming'
    ) {
      if (!options.activity?.upcoming) {
        void replyUnavailable(
          interaction,
          ACTIVITY_MESSAGES.upcomingUnavailable,
        );
        return;
      }
      void handleUpcomingInteraction(
        interaction as unknown as UpcomingInteraction,
        {
          guildId: policy.guildId,
          upcoming: options.activity.upcoming,
        },
      ).catch((error: unknown) => {
        defaultLogger.error('Unhandled /upcoming interaction error', {
          error: errorMessage(error),
        });
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'event') {
      if (!options.activity?.events || !policy.eventsChannelId) {
        void replyUnavailable(interaction, EVENT_MESSAGES.unavailable);
        return;
      }
      void handleEventInteraction(interaction as unknown as EventInteraction, {
        guildId: policy.guildId,
        events: options.activity.events,
        postPublicRecord,
      }).catch((error: unknown) => {
        defaultLogger.error('Unhandled /event interaction error', {
          error: errorMessage(error),
        });
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'help') {
      void handleHelpInteraction(interaction as unknown as HelpInteraction, {
        guildId: policy.guildId,
      }).catch((error: unknown) => {
        defaultLogger.error('Unhandled /help interaction error', {
          error: errorMessage(error),
        });
      });
      return;
    }

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
