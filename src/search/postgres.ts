/**
 * PostgreSQL implementation of the search/index store.
 *
 * All writes go through Drizzle's typed insert/upsert. Retrieval and answer
 * generation were removed with `/ask` on 2026-11-18; the chunk store remains
 * for indexing and `/digest`.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { searchChunks } from '../db/schema';
import type { ChunkIdentity, SearchChunkInput, SearchStore } from './types';

interface BudgetRow {
  resume_at?: Date | string | null;
}

function rowsOf(result: unknown): BudgetRow[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as BudgetRow[]) : [];
}

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const numbers = value.map(Number);
    return numbers.length === 768 && numbers.every(Number.isFinite) ? numbers : null;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const numbers = parsed.map(Number);
    return numbers.length === 768 && numbers.every(Number.isFinite) ? numbers : null;
  } catch {
    return null;
  }
}

export class PostgresSearchStore implements SearchStore {
  constructor(private readonly db: Db) {}

  async upsertChunks(chunks: readonly SearchChunkInput[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const values = chunks.map((chunk) => ({
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      chunkIndex: chunk.chunkIndex,
      sourceUrl: chunk.sourceUrl,
      channelId: chunk.channelId ?? null,
      authorId: chunk.authorId ?? null,
      content: chunk.content,
      contentHash: chunk.contentHash ?? null,
      embedding: chunk.embedding ? [...chunk.embedding] : null,
      indexedAt: chunk.indexedAt ? new Date(chunk.indexedAt) : new Date(),
    }));

    await this.db
      .insert(searchChunks)
      .values(values)
      .onConflictDoUpdate({
        target: [
          searchChunks.sourceType,
          searchChunks.sourceId,
          searchChunks.chunkIndex,
        ],
        set: {
          sourceUrl: sql`excluded.source_url`,
          channelId: sql`excluded.channel_id`,
          authorId: sql`excluded.author_id`,
          content: sql`excluded.content`,
          contentHash: sql`excluded.content_hash`,
          embedding: sql`excluded.embedding`,
          indexedAt: sql`now()`,
        },
      });
  }

  async unchangedKeys(identities: readonly ChunkIdentity[]): Promise<Set<string>> {
    if (identities.length === 0) {
      return new Set();
    }
    const unchanged = new Set<string>();
    for (let start = 0; start < identities.length; start += 500) {
      const batch = identities.slice(start, start + 500);
      const rows = await this.db.execute(sql`
        SELECT source_type, source_id, chunk_index, content_hash
        FROM search_chunks
        WHERE embedding IS NOT NULL
          AND (source_type, source_id, chunk_index::text, content_hash) IN (${sql.join(
          batch.map((identity) => sql`(${identity.sourceType}, ${identity.sourceId}, ${String(identity.chunkIndex)}, ${identity.contentHash})`),
          sql`, `,
        )})
      `);
      for (const row of rowsOf(rows) as Array<{
        source_type?: string;
        source_id?: string;
        chunk_index?: string | number;
        content_hash?: string;
      }>) {
        unchanged.add(`${row.source_type}:${row.source_id}:${row.chunk_index}:${row.content_hash}`);
      }
    }
    return unchanged;
  }

  async cachedEmbeddings(contentHashes: readonly string[]): Promise<Map<string, readonly number[]>> {
    if (contentHashes.length === 0) return new Map();
    const cached = new Map<string, readonly number[]>();
    const uniqueHashes = [...new Set(contentHashes)];
    for (let start = 0; start < uniqueHashes.length; start += 500) {
      const hashes = uniqueHashes.slice(start, start + 500);
      const rows = await this.db
        .select({ contentHash: searchChunks.contentHash, embedding: searchChunks.embedding })
        .from(searchChunks)
        .where(inArray(searchChunks.contentHash, hashes));
      for (const row of rows) {
        if (!row.contentHash || cached.has(row.contentHash)) continue;
        const vector = parseVector(row.embedding);
        if (vector) cached.set(row.contentHash, vector);
      }
    }
    return cached;
  }

  async reserveEmbeddingBudget(units: number, dailyLimit: number): Promise<Date | null> {
    return this.reserveBudget(units, dailyLimit);
  }

  /**
   * Atomically add `units` to today's ledger when the result stays within `cap`.
   * Returns the time to resume when the reservation is refused.
   */
  private async reserveBudget(units: number, cap: number): Promise<Date | null> {
    const reserved = rowsOf(await this.db.execute(sql`
      INSERT INTO search_embedding_budget (id, budget_date, used_units, paused_until)
      SELECT true, (now() AT TIME ZONE 'UTC')::date, ${units}, NULL
      WHERE ${units} <= ${cap}
      ON CONFLICT (id) DO UPDATE SET
        budget_date = EXCLUDED.budget_date,
        used_units = CASE
          WHEN search_embedding_budget.budget_date = EXCLUDED.budget_date
            THEN search_embedding_budget.used_units + EXCLUDED.used_units
          ELSE EXCLUDED.used_units
        END,
        paused_until = CASE
          WHEN search_embedding_budget.budget_date = EXCLUDED.budget_date
            THEN search_embedding_budget.paused_until
          ELSE NULL
        END
      WHERE search_embedding_budget.budget_date <> EXCLUDED.budget_date
        OR (
          (search_embedding_budget.paused_until IS NULL OR search_embedding_budget.paused_until <= now())
          AND search_embedding_budget.used_units + EXCLUDED.used_units <= ${cap}
        )
      RETURNING paused_until
    `));
    if (reserved.length > 0) return null;

    const rows = rowsOf(await this.db.execute(sql`
      SELECT CASE
        WHEN paused_until > now() THEN paused_until
        ELSE date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day'
      END AS resume_at
      FROM search_embedding_budget
      WHERE id = true
    `));
    const value = rows[0]?.resume_at;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  async deferEmbeddingUntil(resumeAt: Date): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO search_embedding_budget (id, budget_date, used_units, paused_until)
      VALUES (true, (now() AT TIME ZONE 'UTC')::date, 0, ${resumeAt})
      ON CONFLICT (id) DO UPDATE SET
        budget_date = (now() AT TIME ZONE 'UTC')::date,
        paused_until = GREATEST(
          COALESCE(search_embedding_budget.paused_until, ${resumeAt}),
          ${resumeAt}
        )
    `);
  }

  async deleteDiscordAuthor(authorId: string): Promise<number> {
    const rows = await this.db
      .delete(searchChunks)
      .where(
        and(
          eq(searchChunks.sourceType, 'discord'),
          eq(searchChunks.authorId, authorId),
        ),
      )
      .returning({ id: searchChunks.id });
    return rows.length;
  }
}
