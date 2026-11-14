/**
 * Embedding/generation budget shared by indexing and `/ask`.
 *
 * Cloudflare's free allocation is metered per UTC day. Indexing and answering
 * draw from the same pool, so the day is split: indexing may use its share, and
 * the remainder is reserved for answering. Without this split a backfill can
 * starve `/ask` entirely.
 *
 * Units are estimated tokens. The estimate is deliberately conservative and is
 * not provider metering; see contracts/search.md.
 */

export const DEFAULT_TOTAL_DAILY_UNITS = 1_000_000;
export const DEFAULT_INDEXING_DAILY_UNITS = 700_000;
export const DEFAULT_INDEXING_RUN_UNITS = 150_000;
export const DEFAULT_ANSWER_QUESTION_UNITS = 3_000;

function positiveIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export interface BudgetLimits {
  totalDaily: number;
  indexingDaily: number;
  indexingRun: number;
  answerPerQuestion: number;
}

export function budgetLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const totalDaily = positiveIntegerEnv(env, 'INDEX_EMBEDDING_DAILY_TOTAL', DEFAULT_TOTAL_DAILY_UNITS);
  const indexingDaily = Math.min(
    positiveIntegerEnv(env, 'INDEX_EMBEDDING_DAILY_BUDGET', DEFAULT_INDEXING_DAILY_UNITS),
    totalDaily,
  );
  return {
    totalDaily,
    indexingDaily,
    indexingRun: positiveIntegerEnv(env, 'INDEX_EMBEDDING_RUN_BUDGET', DEFAULT_INDEXING_RUN_UNITS),
    answerPerQuestion: positiveIntegerEnv(env, 'ANSWER_BUDGET_UNITS', DEFAULT_ANSWER_QUESTION_UNITS),
  };
}
