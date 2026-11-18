/**
 * `/upcoming meetings` and `/upcoming events`.
 *
 * Read-only, guild-scoped and ephemeral. Meetings come from `meeting_events`;
 * manual events come from `events`.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { DiscordLogger } from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';
import type { UpcomingRepository } from './repository';
import {
  formatEventList,
  formatMeetingList,
  UPCOMING_MESSAGES,
} from './format';

export const upcomingCommand = new SlashCommandBuilder()
  .setName('upcoming')
  .setDescription('Show upcoming meetings or club events.')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('meetings')
      .setDescription('List confirmed upcoming meetings.'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('events').setDescription('List scheduled upcoming events.'),
  );

export interface UpcomingInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  options: {
    getSubcommand(required?: boolean): string;
  };
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  deferReply(options?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

export interface UpcomingCommandDependencies {
  guildId: string;
  upcoming: Pick<UpcomingRepository, 'listMeetings' | 'listEvents'>;
  now?: () => Date;
  logger?: DiscordLogger;
}

export type UpcomingCommandResult =
  | 'ignored'
  | 'unsupported-subcommand'
  | 'wrong-guild'
  | 'listed'
  | 'error';

async function safeReply(
  interaction: UpcomingInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (error) {
    logger.warn('Failed to send /upcoming reply', {
      error: errorMessage(error),
    });
  }
}

async function safeEdit(
  interaction: UpcomingInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch (error) {
    logger.warn('Failed to edit /upcoming reply', {
      error: errorMessage(error),
    });
  }
}

export async function handleUpcomingInteraction(
  interaction: UpcomingInteraction,
  dependencies: UpcomingCommandDependencies,
): Promise<UpcomingCommandResult> {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'upcoming'
  ) {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== 'meetings' && subcommand !== 'events') {
    return 'unsupported-subcommand';
  }

  if (interaction.guildId !== dependencies.guildId) {
    await safeReply(interaction, UPCOMING_MESSAGES.wrongGuild, logger);
    return 'wrong-guild';
  }

  try {
    await interaction.deferReply();
  } catch (error) {
    logger.error('Failed to acknowledge /upcoming interaction', {
      error: errorMessage(error),
    });
    return 'error';
  }

  try {
    const now = dependencies.now?.() ?? new Date();
    const content =
      subcommand === 'meetings'
        ? formatMeetingList(
            await dependencies.upcoming.listMeetings(
              dependencies.guildId,
              now,
            ),
          )
        : formatEventList(
            await dependencies.upcoming.listEvents(dependencies.guildId, now),
            now,
          );
    await safeEdit(interaction, content, logger);
    return 'listed';
  } catch (error) {
    logger.error('/upcoming failed', { error: errorMessage(error) });
    await safeEdit(interaction, UPCOMING_MESSAGES.error, logger);
    return 'error';
  }
}
