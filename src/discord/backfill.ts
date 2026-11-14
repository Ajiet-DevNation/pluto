/**
 * One startup backfill per allowlisted channel.
 *
 * This is the only history read. It uses Discord's
 * GET /channels/{id}/messages?after=<last_id>&limit=100 cursor, sorts each page
 * ascending, and commits the cursor only after the batch has been stored.
 */

import type { AuthoredMessage, DiscordLogger } from './types';
import type { IntakeContext } from './intake';
import { shouldIndexMessage, toIndexRecord } from './intake';
import { defaultLogger, errorMessage } from './types';

export interface BackfillChannel {
  channelId: string;
  channelName?: string;
  fetchPage: (after: string, limit: number) => Promise<AuthoredMessage[]>;
}

export interface BackfillOptions {
  guildId: string;
  context: IntakeContext;
  pageSize?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  logger?: DiscordLogger;
}

export interface BackfillResult {
  channelId: string;
  channelName?: string;
  fetched: number;
  indexed: number;
  skipped: number;
  cursor: string | null;
  error?: string;
}

export function compareSnowflakes(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  } catch {
    return left.localeCompare(right);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(
  task: () => Promise<T>,
  attempts: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await sleep(delayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function backfillChannel(
  channel: BackfillChannel,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const { guildId, context } = options;
  const pageSize = options.pageSize ?? 100;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const logger = options.logger ?? context.logger ?? defaultLogger;

  const initialCursor = await context.indexStore.getLastMessageId(
    guildId,
    channel.channelId,
  );
  let after = initialCursor ?? '0';
  let cursor = initialCursor;
  let fetched = 0;
  let indexed = 0;
  let skipped = 0;

  for (;;) {
    const page = await withRetry(
      () => channel.fetchPage(after, pageSize),
      maxAttempts,
      retryDelayMs,
    );

    if (page.length === 0) {
      break;
    }

    const sorted = [...page].sort((left, right) =>
      compareSnowflakes(left.id, right.id),
    );

    for (const message of sorted) {
      fetched += 1;
      if (await shouldIndexMessage(message, context)) {
        await context.indexStore.upsert(toIndexRecord(message, context));
        indexed += 1;
      } else {
        skipped += 1;
      }
    }

    const highest = sorted[sorted.length - 1].id;
    if (compareSnowflakes(highest, after) <= 0) {
      logger.warn('Discord backfill made no cursor progress; stopping channel', {
        channelId: channel.channelId,
        after,
        highest,
      });
      break;
    }

    await context.indexStore.setLastMessageId(guildId, channel.channelId, highest);
    cursor = highest;
    after = highest;

    if (page.length < pageSize) {
      break;
    }
  }

  logger.info('Discord backfill complete for channel', {
    channelId: channel.channelId,
    channelName: channel.channelName,
    fetched,
    indexed,
    skipped,
    cursor,
  });

  return {
    channelId: channel.channelId,
    channelName: channel.channelName,
    fetched,
    indexed,
    skipped,
    cursor,
  };
}

/**
 * Backfill runs sequentially and isolates per-channel failures: a transient
 * failure on one allowlisted channel must not stop the other three. Startup
 * configuration/access validation is still fatal before this point.
 */
export async function runStartupBackfill(
  channels: readonly BackfillChannel[],
  options: BackfillOptions,
): Promise<BackfillResult[]> {
  const logger = options.logger ?? options.context.logger ?? defaultLogger;
  const results: BackfillResult[] = [];

  for (const channel of channels) {
    try {
      results.push(await backfillChannel(channel, options));
    } catch (error) {
      logger.error('Discord backfill failed for channel', {
        channelId: channel.channelId,
        channelName: channel.channelName,
        error: errorMessage(error),
      });
      results.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        fetched: 0,
        indexed: 0,
        skipped: 0,
        cursor: null,
        error: errorMessage(error),
      });
    }
  }

  return results;
}
