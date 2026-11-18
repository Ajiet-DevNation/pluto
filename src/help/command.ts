/**
 * `/help` — list the guild-scoped commands and examples.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { DiscordLogger } from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';
import { fitDiscordContent } from '../events/text';

export const HELP_MESSAGES = {
  wrongGuild: 'This command works only inside the DevNation server.',
} as const;

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List Pluto commands and examples.')
  .setDMPermission(false);

export const HELP_CONTENT = [
  '**Pluto commands**',
  '',
  '**Activity**',
  '• `/digest [days:1-30]` — on-demand activity snapshot (default 7 days).',
  '• `/upcoming meetings` — confirmed upcoming meetings.',
  '• `/upcoming events` — scheduled upcoming events.',
  '',
  '**Events**',
  '• `/event add title:<text> date:<YYYY-MM-DD> time:<10:00 AM> [end:<11:00 AM>] [description:<text>]` — save a club event and post a public record in `#events`.',
  '• `/event cancel id:<number>` — cancel an event you created, or any event with Manage Events.',
  '• Events are open to every member. Times use 12-hour AM/PM or 24-hour HH:MM.',
  '',
  '**Account**',
  '• `/optout` — opt out of Pluto indexing your Discord messages.',
  '',
  '**Help**',
  '• `/help` — show this list.',
  '',
  '**Examples**',
  '• `/digest days:14`',
  '• `/upcoming meetings`',
  '• `/upcoming events`',
  '• `/event add title:Hackathon date:2026-11-22 time:10:00 AM end:5:00 PM`',
  '• `/event cancel id:169`',
].join('\n');

export interface HelpInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  reply(options: { content: string; ephemeral?: boolean }): Promise<unknown>;
}

export interface HelpCommandDependencies {
  guildId: string;
  logger?: DiscordLogger;
}

export type HelpCommandResult = 'ignored' | 'wrong-guild' | 'sent' | 'error';

export async function handleHelpInteraction(
  interaction: HelpInteraction,
  dependencies: HelpCommandDependencies,
): Promise<HelpCommandResult> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'help') {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;
  const sameGuild = interaction.guildId === dependencies.guildId;

  try {
    await interaction.reply(
      sameGuild
        ? { content: fitDiscordContent(HELP_CONTENT) }
        : { content: HELP_MESSAGES.wrongGuild, ephemeral: true },
    );
    return sameGuild ? 'sent' : 'wrong-guild';
  } catch (error) {
    logger.error('Failed to send /help reply', {
      error: errorMessage(error),
    });
    return 'error';
  }
}
