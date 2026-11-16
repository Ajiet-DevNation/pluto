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
import type { AskService, AskSource } from '../search/ask';

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
  | 'read-only'
  | 'busy'
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

export const DISCORD_CONTENT_LIMIT = 2_000;
const TRUNCATION_SUFFIX = '\n\n… [truncated]';
const SOURCE_OMITTED_SUFFIX = "\n\n… [source link omitted to fit Discord's limit]";
const MIN_TRUNCATED_ANSWER_LENGTH = 40;

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  let truncated = text.slice(0, maxLength);
  // Never split a UTF-16 surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(truncated)) {
    truncated = truncated.slice(0, -1);
  }
  // Prefer a word boundary when it does not discard most of the budget.
  const boundary = truncated.search(/\s+\S*$/);
  if (boundary >= Math.floor(maxLength * 0.6)) {
    truncated = truncated.slice(0, boundary);
  }
  return truncated.trimEnd();
}

function truncateAnswer(answer: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (answer.length <= maxLength) return answer;
  const suffix = TRUNCATION_SUFFIX.length <= maxLength ? TRUNCATION_SUFFIX : '…';
  const budget = maxLength - suffix.length;
  return budget > 0 ? `${truncateText(answer, budget)}${suffix}` : suffix.slice(0, maxLength);
}

/**
 * Render the answer plus at most the selected supporting sources. The full
 * evidence set stays internal for grounding and audit. The reply is kept within
 * Discord's single-message limit by truncating the answer, never the link.
 */
export function formatAskReply(
  answer: string,
  sources: readonly AskSource[] = [],
): string {
  const lines = sources.map((source) => {
    const label = source.label.replace(/[[\]\r\n]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return `Source: [${label || 'source'}](${source.url})`;
  });
  const footer = lines.join('\n');
  if (!footer) return truncateAnswer(answer, DISCORD_CONTENT_LIMIT);

  const footerBlock = `\n\n${footer}`;
  if (answer.length + footerBlock.length <= DISCORD_CONTENT_LIMIT) {
    return `${answer}${footerBlock}`;
  }

  const answerBudget =
    DISCORD_CONTENT_LIMIT - footerBlock.length - TRUNCATION_SUFFIX.length;
  if (answerBudget >= MIN_TRUNCATED_ANSWER_LENGTH) {
    return `${truncateText(answer, answerBudget)}${TRUNCATION_SUFFIX}${footerBlock}`;
  }

  // The source block itself is too large to keep any useful answer. Preserve
  // the answer and disclose that the link could not be shown rather than
  // emitting a broken partial URL.
  const omissionBudget = DISCORD_CONTENT_LIMIT - SOURCE_OMITTED_SUFFIX.length;
  return `${truncateText(answer, omissionBudget)}${SOURCE_OMITTED_SUFFIX}`;
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
      if (result.reason === 'read-only') return 'read-only';
      if (result.reason === 'quota') return 'busy';
      return 'no-evidence';
    }

    await safeEdit(
      interaction,
      formatAskReply(result.answer, result.displaySources ?? result.sources.slice(0, 1)),
      logger,
    );
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
