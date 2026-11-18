/**
 * `/digest [days]` — on-demand deterministic activity snapshot.
 *
 * Guild-scoped, ephemeral and read-only. No scheduler, no AI narrative.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { DiscordLogger } from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';
import { formatDigest } from './format';
import {
  DIGEST_MAX_DAYS,
  DIGEST_MIN_DAYS,
  normalizeDigestDays,
  type DigestService,
} from './service';

export const DIGEST_MESSAGES = {
  wrongGuild: 'This command works only inside the DevNation server.',
  invalidDays: `Days must be a whole number from ${DIGEST_MIN_DAYS} to ${DIGEST_MAX_DAYS}.`,
  error: 'Something went wrong while building the digest. Please try again.',
} as const;

export const digestCommand = new SlashCommandBuilder()
  .setName('digest')
  .setDescription('Show an on-demand activity snapshot from indexed records.')
  .setDMPermission(false)
  .addIntegerOption((option) =>
    option
      .setName('days')
      .setDescription('Number of days to cover (1–30, default 7)')
      .setMinValue(DIGEST_MIN_DAYS)
      .setMaxValue(DIGEST_MAX_DAYS)
      .setRequired(false),
  );

export interface DigestInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  options: {
    getInteger(name: string, required?: boolean): number | null;
  };
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  deferReply(options?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

export interface DigestCommandDependencies {
  guildId: string;
  digest: Pick<DigestService, 'build'>;
  logger?: DiscordLogger;
}

export type DigestCommandResult =
  | 'ignored'
  | 'wrong-guild'
  | 'invalid-days'
  | 'sent'
  | 'error';

async function safeReply(
  interaction: DigestInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (error) {
    logger.warn('Failed to send /digest reply', { error: errorMessage(error) });
  }
}

async function safeEdit(
  interaction: DigestInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch (error) {
    logger.warn('Failed to edit /digest reply', { error: errorMessage(error) });
  }
}

export async function handleDigestInteraction(
  interaction: DigestInteraction,
  dependencies: DigestCommandDependencies,
): Promise<DigestCommandResult> {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'digest'
  ) {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;

  if (interaction.guildId !== dependencies.guildId) {
    await safeReply(interaction, DIGEST_MESSAGES.wrongGuild, logger);
    return 'wrong-guild';
  }

  const days = normalizeDigestDays(
    interaction.options.getInteger('days', false),
  );
  if (days === null) {
    await safeReply(interaction, DIGEST_MESSAGES.invalidDays, logger);
    return 'invalid-days';
  }

  try {
    await interaction.deferReply();
  } catch (error) {
    logger.error('Failed to acknowledge /digest interaction', {
      error: errorMessage(error),
    });
    return 'error';
  }

  try {
    const report = await dependencies.digest.build({
      guildId: dependencies.guildId,
      days,
    });
    await safeEdit(interaction, formatDigest(report), logger);
    return 'sent';
  } catch (error) {
    logger.error('/digest failed', {
      days,
      error: errorMessage(error),
    });
    await safeEdit(interaction, DIGEST_MESSAGES.error, logger);
    return 'error';
  }
}
