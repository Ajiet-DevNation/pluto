/**
 * Configuration loader for .planning/config.json.
 *
 * Reads the JSON file at build time. Missing or malformed config throws.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedConfig: Config | null = null;

export interface DiscordConfig {
  application_id: string;
  guild_id: string;
  output_channel_id: string;
  output_channel_name: string;
  index_own_output_channel: boolean;
  indexed_channels: Record<string, string>;
  excluded_channels: string[];
}

export interface Config {
  planning: {
    discord: DiscordConfig;
    credentials: {
      github: {
        org: string;
        app: string;
        interim: {
          type: string;
          owner: string;
          scopes: string[];
          repo_access: string;
          expires: string;
        };
      };
      neon: {
        database_url: string;
      };
      [key: string]: unknown;
    };
  };
}

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = resolve(process.cwd(), '.planning/config.json');

  try {
    const raw = readFileSync(configPath, 'utf8');
    cachedConfig = JSON.parse(raw) as Config;
    return cachedConfig;
  } catch (error) {
    throw new Error(`Failed to load config from ${configPath}: ${error instanceof Error ? error.message : error}`);
  }
}

export function getGitHubOrg(): string {
  return loadConfig().planning.credentials.github.org;
}

export function getDiscordGuildId(): string {
  return loadConfig().planning.discord.guild_id;
}

export function getDiscordOutputChannelId(): string {
  return loadConfig().planning.discord.output_channel_id;
}

export function getIndexedChannels(): Record<string, string> {
  return loadConfig().planning.discord.indexed_channels;
}

export function getExcludedChannels(): string[] {
  return loadConfig().planning.discord.excluded_channels;
}