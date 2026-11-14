/**
 * PostgreSQL implementation of the search store.
 *
 * Drizzle has no first-class pgvector operators, so the two ranked queries use
 * parameterized SQL. All writes go through Drizzle's typed insert/upsert.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { searchChunks } from '../db/schema';
import {
  SEARCH_SOURCE_TYPES,
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

function mapRow(row: RawChunkRow): ScoredSearchChunk | null {
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
  const score = Number(row.score);
  if (!Number.isInteger(chunkIndex) || !Number.isFinite(score)) {
    return null;
  }

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
          embedding: sql`excluded.embedding`,
          indexedAt: sql`now()`,
        },
      });
  }

  async vectorSearch(
    embedding: readonly number[],
    limit: number,
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
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);

    return rowsOf(result)
      .map(mapRow)
      .filter((row): row is ScoredSearchChunk => row !== null);
  }

  async fullTextSearch(query: string, limit: number): Promise<ScoredSearchChunk[]> {
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
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return rowsOf(result)
      .map(mapRow)
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
