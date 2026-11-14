/**
 * Discord channel policy.
 *
 * The allowlist is the only source of indexed channel IDs. `excluded_channels`
 * is documentation and is never consulted: it is not exhaustive, and deriving
 * from it would admit channels (for example #core-secrets) that must never be
 * indexed.
 */

import { loadConfig } from '../config';

export const SNOWFLAKE = /^\d{5,25}$/;

export class DiscordConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordConfigError';
  }
}

export interface RawDiscordConfig {
  guild_id: string;
  output_channel_id: string;
  index_own_output_channel: boolean;
  indexed_channels: Record<string, string>;
  indexing_mode?: string;
}

export interface DiscordPolicy {
  guildId: string;
  outputChannelId: string;
  indexedChannels: Readonly<Record<string, string>>;
  indexedChannelIds: ReadonlySet<string>;
}

export interface DiscordPolicyInput {
  guildId: string;
  outputChannelId: string;
  indexedChannels: Record<string, string>;
}

/**
 * Build and validate the policy from an already-extracted config object.
 * Kept pure so tests can exercise every rejection path.
 */
export function buildDiscordPolicy(input: DiscordPolicyInput): DiscordPolicy {
  if (!SNOWFLAKE.test(input.guildId)) {
    throw new DiscordConfigError(`Invalid Discord guild id: ${input.guildId}`);
  }
  if (!SNOWFLAKE.test(input.outputChannelId)) {
    throw new DiscordConfigError(`Invalid Discord output channel id: ${input.outputChannelId}`);
  }

  const entries = Object.entries(input.indexedChannels);
  if (entries.length === 0) {
    throw new DiscordConfigError('discord.indexed_channels is empty; refusing to start');
  }

  const seen = new Set<string>();
  for (const [name, id] of entries) {
    if (!SNOWFLAKE.test(id)) {
      throw new DiscordConfigError(`Invalid channel id for ${name}: ${id}`);
    }
    if (seen.has(id)) {
      throw new DiscordConfigError(`Duplicate indexed channel id: ${id}`);
    }
    seen.add(id);
  }

  if (seen.has(input.outputChannelId)) {
    throw new DiscordConfigError(
      `The bot output channel (${input.outputChannelId}) must never be indexed`,
    );
  }

  return {
    guildId: input.guildId,
    outputChannelId: input.outputChannelId,
    indexedChannels: { ...input.indexedChannels },
    indexedChannelIds: seen,
  };
}

/**
 * Validate the raw config block, including the two switches that protect the
 * allowlist rule. Throwing here prevents a policy change from silently
 * broadening indexing.
 */
export function validateDiscordConfig(raw: RawDiscordConfig): DiscordPolicy {
  if (raw.indexing_mode !== 'allowlist') {
    throw new DiscordConfigError(
      `discord.indexing_mode must be "allowlist" (received ${String(raw.indexing_mode)}); ` +
        'excluded_channels is documentation and is never used to derive the index set',
    );
  }

  if (raw.index_own_output_channel !== false) {
    throw new DiscordConfigError(
      'discord.index_own_output_channel must be false; the bot must never index or cite its own output',
    );
  }

  return buildDiscordPolicy({
    guildId: raw.guild_id,
    outputChannelId: raw.output_channel_id,
    indexedChannels: raw.indexed_channels,
  });
}

export function loadDiscordPolicy(): DiscordPolicy {
  // config.json nests the block under `planning`; accept a top-level `discord`
  // too so the loader keeps working if the file is flattened later.
  const config = loadConfig() as unknown as {
    planning?: { discord?: RawDiscordConfig };
    discord?: RawDiscordConfig;
  };
  const raw = config.planning?.discord ?? config.discord;
  if (!raw) {
    throw new DiscordConfigError('config.json is missing planning.discord');
  }
  return validateDiscordConfig(raw);
}

/**
 * The guild id comes from .env (hard rule), and must agree with config.json.
 * The optional output-channel override must agree too.
 */
export function assertEnvMatchesPolicy(
  policy: DiscordPolicy,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const guildId = env.DISCORD_GUILD_ID?.trim();
  if (!guildId) {
    throw new DiscordConfigError('DISCORD_GUILD_ID is required in .env');
  }
  if (guildId !== policy.guildId) {
    throw new DiscordConfigError(
      `DISCORD_GUILD_ID (${guildId}) does not match config.json guild_id (${policy.guildId})`,
    );
  }

  const outputChannelId = env.DISCORD_OUTPUT_CHANNEL_ID?.trim();
  if (outputChannelId && outputChannelId !== policy.outputChannelId) {
    throw new DiscordConfigError(
      `DISCORD_OUTPUT_CHANNEL_ID (${outputChannelId}) does not match ` +
        `config.json output_channel_id (${policy.outputChannelId})`,
    );
  }
}

export function requireEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new DiscordConfigError(`${name} is required in .env`);
  }
  return value;
}
