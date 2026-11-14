/**
 * `/ask` — grounded project Q&A.
 *
 * The handler only acknowledges the interaction and renders the AskService
 * result. All retrieval, evidence-gate and citation decisions stay in the
 * search layer so they are independently testable.
 */

import type { DiscordLogger } from '../discord/types';
import { defaultLogger, errorMessage } from '../discord/types';
import { NO_EVIDENCE_MESSAGE } from '../guardrails/evidence';
import type { AskService } from '../search/ask';

export const ASK_MESSAGES = {
  wrongGuild: 'This command works only inside the DevNation server.',
  emptyQuestion: 'Ask a question, for example: `/ask what is the current project stack?`',
  error: 'Something went wrong while answering that. Please try again.',
} as const;

export interface AskInteraction {
  isChatInputCommand(): boolean;
  commandName: string;
  guildId: string | null;
  user: { id: string };
  options: {
    getString(name: string, required?: boolean): string | null;
  };
  deferReply(options?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

export interface AskCommandDependencies {
  guildId: string;
  askService: Pick<AskService, 'ask'>;
  logger?: DiscordLogger;
}

export type AskCommandResult =
  | 'ignored'
  | 'wrong-guild'
  | 'empty'
  | 'answered'
  | 'no-evidence'
  | 'error';

async function safeEdit(
  interaction: AskInteraction,
  content: string,
  logger: DiscordLogger,
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch (error) {
    logger.warn('Failed to send /ask reply', { error: errorMessage(error) });
  }
}

export async function handleAskInteraction(
  interaction: AskInteraction,
  dependencies: AskCommandDependencies,
): Promise<AskCommandResult> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'ask') {
    return 'ignored';
  }

  const logger = dependencies.logger ?? defaultLogger;

  if (interaction.guildId !== dependencies.guildId) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      logger.warn('Failed to acknowledge wrong-guild /ask', {
        error: errorMessage(error),
      });
      return 'error';
    }
    await safeEdit(interaction, ASK_MESSAGES.wrongGuild, logger);
    return 'wrong-guild';
  }

  const question = interaction.options.getString('question', true)?.trim() ?? '';
  if (!question) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      logger.warn('Failed to acknowledge empty /ask', {
        error: errorMessage(error),
      });
      return 'error';
    }
    await safeEdit(interaction, ASK_MESSAGES.emptyQuestion, logger);
    return 'empty';
  }

  try {
    await interaction.deferReply();
  } catch (error) {
    logger.error('Failed to acknowledge /ask interaction', {
      error: errorMessage(error),
    });
    return 'error';
  }

  try {
    const result = await dependencies.askService.ask(question);
    if (!result.ok) {
      await safeEdit(interaction, result.message ?? NO_EVIDENCE_MESSAGE, logger);
      return 'no-evidence';
    }

    await safeEdit(interaction, result.answer, logger);
    return 'answered';
  } catch (error) {
    logger.error('/ask failed', {
      userId: interaction.user.id,
      error: errorMessage(error),
    });
    await safeEdit(interaction, ASK_MESSAGES.error, logger);
    return 'error';
  }
}
