/**
 * PostgreSQL implementation of the search store.
 *
 * Drizzle has no first-class pgvector operators, so the two ranked queries use
 * parameterized SQL. All writes go through Drizzle's typed insert/upsert.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { searchChunks } from '../db/schema';
import { cosineToRelevance, fullTextToRelevance } from './relevance';
import {
  SEARCH_SOURCE_TYPES,
  type ChunkIdentity,
  type ScoredSearchChunk,
  type SearchChunkInput,
  type SearchSourceType,
  type SearchStore,
} from './types';

interface RawChunkRow {
  id?: string;
  source_type?: string;
  source_id?: string;
  chunk_index?: number | string;
  source_url?: string;
  channel_id?: string | null;
  author_id?: string | null;
  content?: string;
  indexed_at?: Date | string | null;
  content_hash?: string | null;
  embedding?: unknown;
  resume_at?: Date | string | null;
  score?: number | string;
}

function isSourceType(value: string): value is SearchSourceType {
  return (SEARCH_SOURCE_TYPES as readonly string[]).includes(value);
}

function rowsOf(result: unknown): RawChunkRow[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as RawChunkRow[]) : [];
}

function mapRow(
  row: RawChunkRow,
  toRelevance: (rawScore: number) => number,
): ScoredSearchChunk | null {
  if (
    !row.source_type ||
    !isSourceType(row.source_type) ||
    !row.source_id ||
    !row.source_url ||
    typeof row.content !== 'string'
  ) {
    return null;
  }

  const chunkIndex = Number(row.chunk_index);
  const rawScore = Number(row.score);
  if (!Number.isInteger(chunkIndex) || !Number.isFinite(rawScore)) {
    return null;
  }
  const score = toRelevance(rawScore);

  const indexedAt =
    row.indexed_at instanceof Date
      ? row.indexed_at.toISOString()
      : typeof row.indexed_at === 'string'
        ? row.indexed_at
        : undefined;

  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    chunkIndex,
    sourceUrl: row.source_url,
    channelId: row.channel_id ?? null,
    authorId: row.author_id ?? null,
    content: row.content,
    indexedAt,
    score,
  };
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
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

function githubRepositoryFilter(repositoryFullName?: string) {
  if (!repositoryFullName) return sql``;
  const lower = repositoryFullName.toLowerCase();
  const hashPrefix = `${lower}#`;
  const commitPrefix = `${lower}@`;
  return sql`
    AND source_type = 'github'
    AND (
      left(lower(source_id), ${hashPrefix.length}) = ${hashPrefix}
      OR left(lower(source_id), ${commitPrefix.length}) = ${commitPrefix}
    )
  `;
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
      for (const row of rowsOf(rows)) {
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
    const reserved = rowsOf(await this.db.execute(sql`
      INSERT INTO search_embedding_budget (id, budget_date, used_units, paused_until)
      SELECT true, (now() AT TIME ZONE 'UTC')::date, ${units}, NULL
      WHERE ${units} <= ${dailyLimit}
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
          AND search_embedding_budget.used_units + EXCLUDED.used_units <= ${dailyLimit}
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

  async vectorSearch(
    embedding: readonly number[],
    limit: number,
    repositoryFullName?: string,
  ): Promise<ScoredSearchChunk[]> {
    if (embedding.length === 0) {
      return [];
    }
    const literal = vectorLiteral(embedding);
    const result = await this.db.execute(sql`
      SELECT
        id,
        source_type,
        source_id,
        chunk_index,
        source_url,
        channel_id,
        author_id,
        content,
        indexed_at,
        1 - (embedding <=> ${literal}::vector) AS score
      FROM search_chunks
      WHERE embedding IS NOT NULL
      ${githubRepositoryFilter(repositoryFullName)}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);

    return rowsOf(result)
      .map((row) => mapRow(row, cosineToRelevance))
      .filter((row): row is ScoredSearchChunk => row !== null);
  }

  async fullTextSearch(
    query: string,
    limit: number,
    repositoryFullName?: string,
  ): Promise<ScoredSearchChunk[]> {
    if (!query.trim()) {
      return [];
    }
    const result = await this.db.execute(sql`
      WITH q AS (SELECT plainto_tsquery('english', ${query}) AS query)
      SELECT
        id,
        source_type,
        source_id,
        chunk_index,
        source_url,
        channel_id,
        author_id,
        content,
        indexed_at,
        ts_rank_cd(search_vector, q.query) AS score
      FROM search_chunks, q
      WHERE search_vector @@ q.query
      ${githubRepositoryFilter(repositoryFullName)}
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return rowsOf(result)
      .map((row) => mapRow(row, fullTextToRelevance))
      .filter((row): row is ScoredSearchChunk => row !== null);
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
