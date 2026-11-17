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
import { buildFullTextQuery } from './query';
import {
  SEARCH_SOURCE_TYPES,
  type ChunkIdentity,
  type ScoredSearchChunk,
  type SearchChunkInput,
  type SearchSourceType,
  type SearchStore,
} from './types';

/**
 * IVFFlat probes. The live index was built with no explicit `lists` option;
 * empirical recall plateaus at 64–100 probes on the 7,880-chunk corpus, and
 * `probes=1` (the PostgreSQL default) misses ~68% of the exact top-5. The
 * default therefore scans enough lists to be exact for the current index.
 * Tune with `IVFFLAT_PROBES` after a future index rebuild adds lists.
 */
export const DEFAULT_IVFFLAT_PROBES = 100;

export function ivfflatProbesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.IVFFLAT_PROBES?.trim();
  if (!raw) {
    return DEFAULT_IVFFLAT_PROBES;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32768) {
    throw new Error(`IVFFLAT_PROBES must be an integer between 1 and 32768, got "${raw}"`);
  }
  return value;
}

export interface PostgresSearchStoreOptions {
  ivfflatProbes?: number;
  organizationName?: string;
}

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
  strict_match?: boolean;
  matched_terms?: number | string;
  term_count?: number | string;
  coverage?: number | string;
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
  toRelevance: (rawScore: number, row: RawChunkRow) => number,
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
  const score = toRelevance(rawScore, row);

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
  private readonly ivfflatProbes: number;

  constructor(
    private readonly db: Db,
    private readonly options: PostgresSearchStoreOptions = {},
  ) {
    this.ivfflatProbes = options.ivfflatProbes ?? DEFAULT_IVFFLAT_PROBES;
  }

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
    return this.reserveBudget(units, dailyLimit);
  }

  async reserveAnswerBudget(units: number, dailyLimit: number): Promise<Date | null> {
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

  async listContributors(
    repositoryFullName: string,
  ): Promise<Array<{ login: string; contributions: number }>> {
    const prefix = `${repositoryFullName.toLowerCase()}#contributor:`;
    const rows = await this.db
      .select({ sourceId: searchChunks.sourceId, content: searchChunks.content })
      .from(searchChunks)
      .where(
        and(
          eq(searchChunks.sourceType, 'github'),
          sql`left(lower(${searchChunks.sourceId}), ${prefix.length}) = ${prefix}`,
        ),
      );
    const contributors = new Map<string, number>();
    for (const row of rows) {
      const login = row.sourceId.slice(prefix.length).trim();
      if (!login || contributors.has(login)) continue;
      const match = row.content.match(/Contributions:\s*(\d+)/i);
      contributors.set(login, match ? Number(match[1]) : 0);
    }
    return [...contributors.entries()]
      .map(([login, contributions]) => ({ login, contributions }))
      .sort((left, right) => right.contributions - left.contributions || left.login.localeCompare(right.login));
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

  async findBySourceIds(sourceIds: readonly string[]): Promise<ScoredSearchChunk[]> {
    const ids = [...new Set(sourceIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
    if (ids.length === 0) {
      return [];
    }

    // A question may name a short commit SHA (7–39 hex characters). Match it
    // as a prefix; a full 40-character SHA remains an exact lookup.
    const exactIds: string[] = [];
    const prefixIds: string[] = [];
    for (const id of ids) {
      const sha = id.includes('@') ? id.slice(id.indexOf('@') + 1) : '';
      if (sha.length >= 7 && sha.length < 40 && /^[0-9a-f]+$/.test(sha)) {
        prefixIds.push(id);
      } else {
        exactIds.push(id);
      }
    }

    const conditions = [];
    if (exactIds.length > 0) {
      conditions.push(
        sql`lower(source_id) IN (${sql.join(exactIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    }
    for (const prefix of prefixIds) {
      conditions.push(
        sql`left(lower(source_id), ${prefix.length}) = ${prefix}`,
      );
    }

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
        1 AS score
      FROM search_chunks
      WHERE source_type = 'github'
        AND (${sql.join(conditions, sql` OR `)})
      ORDER BY source_id, chunk_index
    `);

    return rowsOf(result)
      .map((row) => mapRow(row, () => 1))
      .filter((row): row is ScoredSearchChunk => row !== null);
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
    // `SET LOCAL` only affects the transaction that runs it. Drizzle's
    // transaction reserves one pooled connection, so the setting and the query
    // below cannot land on different connections. A standalone `SET` would
    // leak to one pooled connection and miss the rest.
    //
    // Do not force `enable_seqscan=off`. On the current 7,880-row table the
    // planner often chooses an exact sequential scan that is as fast as, or
    // faster than, a cold index scan, and forcing the index after a future
    // rebuild could turn an exact plan into an approximate one. Let PostgreSQL
    // choose; probes still covers all current lists.
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('ivfflat.probes', ${String(this.ivfflatProbes)}, true)`,
      );
      return tx.execute(sql`
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
    });

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

    const built = buildFullTextQuery(
      query,
      repositoryFullName,
      this.options.organizationName,
    );
    if (built.groups.length === 0 || !built.broadText) {
      return [];
    }

    // Rank a bounded broad candidate set, then score each candidate by the
    // IDF-weighted share of the question's full terms it matches. A common
    // word such as "migration" carries little weight; a rare identifier such
    // as "tsvector" carries a lot. This is what makes the exact migration PR
    // outrank unrelated PRs that merely share generic vocabulary.
    const candidateLimit = Math.max(limit * 10, 200);
    const fullTermValues = sql.join(
      built.terms.map((term) => sql`(${term})`),
      sql`, `,
    );

    const result = await this.db.execute(sql`
      WITH q AS (
        SELECT
          to_tsquery('english', ${built.strictText}) AS strict_q,
          to_tsquery('english', ${built.broadText}) AS broad_q
      ),
      terms AS (
        SELECT * FROM (VALUES ${fullTermValues}) AS g(term)
      ),
      stats AS (
        SELECT
          d.term,
          CASE
            WHEN d.df = 0 THEN 0
            ELSE 1.0 / ln(2.0 + d.df)
          END AS weight
        FROM (
          SELECT
            g.term,
            (
              SELECT count(*)
              FROM search_chunks sc
              WHERE sc.search_vector @@ to_tsquery('english', g.term)
            ) AS df
          FROM terms g
        ) d
      ),
      totals AS (
        SELECT coalesce(sum(weight), 0) AS total_weight FROM stats
      ),
      candidates AS (
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
          search_vector,
          ts_rank_cd(search_vector, q.broad_q) AS rank
        FROM search_chunks, q
        WHERE search_vector @@ q.broad_q
        ${githubRepositoryFilter(repositoryFullName)}
        ORDER BY rank DESC
        LIMIT ${candidateLimit}
      ),
      scored AS (
        SELECT
          c.*,
          (
            SELECT count(*)
            FROM stats s
            WHERE c.search_vector @@ to_tsquery('english', s.term)
          ) AS matched_terms,
          (
            SELECT coalesce(sum(s.weight), 0)
            FROM stats s
            WHERE c.search_vector @@ to_tsquery('english', s.term)
          ) AS matched_weight,
          totals.total_weight
        FROM candidates c
        CROSS JOIN totals
      )
      SELECT
        s.id,
        s.source_type,
        s.source_id,
        s.chunk_index,
        s.source_url,
        s.channel_id,
        s.author_id,
        s.content,
        s.indexed_at,
        s.rank AS score,
        (s.search_vector @@ q.strict_q) AS strict_match,
        s.matched_terms,
        ${built.terms.length} AS term_count,
        CASE
          WHEN s.total_weight > 0 THEN s.matched_weight / s.total_weight
          ELSE 0
        END AS coverage
      FROM scored s, q
      ORDER BY strict_match DESC, coverage DESC, s.rank DESC
      LIMIT ${limit}
    `);

    return rowsOf(result)
      .map((row) =>
        mapRow(row, (rawScore, candidate) =>
          fullTextToRelevance(
            rawScore,
            Number(candidate.coverage ?? 0),
            Number(candidate.term_count ?? 1),
            candidate.strict_match === true,
          ),
        ),
      )
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
