#!/usr/bin/env tsx
/**
 * Retrieval quality evaluation against the live corpus.
 *
 * Measures:
 * - approximate IVFFlat recall@5/@10 and MRR against an exact sequential scan
 * - hybrid retrieval recall@5/@10 against exact vector neighbours
 * - expected-source hit rate for labelled questions
 * - zero-result rate and retrieval latency
 *
 * This script only reads the database. It spends Cloudflare embedding quota for
 * the curated questions; the chunk-vector sample reuses stored embeddings and
 * costs nothing.
 *
 * Usage:
 *   npm run eval:retrieval -- --allow-cloudflare
 *   npm run eval:retrieval -- --allow-cloudflare --samples=0
 */

import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createReadOnlyDb, type Db } from '../src/db/index';
import { repositories } from '../src/db/schema';
import { getDiscordGuildId, getDiscordOutputChannelId, getGitHubOrg } from '../src/config';
import { NO_EVIDENCE_MESSAGE } from '../src/guardrails/evidence';
import { CloudflareEmbeddingClient } from '../src/search/cloudflare';
import { repositoryScopesFromQuestion } from '../src/search/ask';
import { PostgresSearchStore, ivfflatProbesFromEnv } from '../src/search/postgres';
import { RetrievalService } from '../src/search/retrieval';
import type { ScoredSearchChunk } from '../src/search/types';

let activeReadOnlyDb: Db | undefined;

interface EvalQuestion {
  id: string;
  category: string;
  question: string;
  repository: string | null;
  expected_source_any?: string[];
  required_source_any?: string[];
}

interface Row {
  id: string;
}

function rowsOf(result: unknown): Row[] {
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

async function assertReadOnly(db: Db): Promise<void> {
  const settings = await db.transaction(async (tx) => {
    const transaction = await tx.execute(sql`SHOW transaction_read_only`);
    const defaultSetting = await tx.execute(sql`SHOW default_transaction_read_only`);
    const transactionRows =
      (transaction as { rows?: Array<{ transaction_read_only?: string }> }).rows ?? [];
    const defaultRows =
      (defaultSetting as { rows?: Array<{ default_transaction_read_only?: string }> }).rows ?? [];
    return {
      transaction: transactionRows[0]?.transaction_read_only,
      defaultSetting: defaultRows[0]?.default_transaction_read_only,
    };
  });
  if (settings.transaction !== 'on' || settings.defaultSetting !== 'on') {
    throw new Error(
      'Retrieval evaluation requires a read-only PostgreSQL connection; ' +
        '`SHOW transaction_read_only` and `SHOW default_transaction_read_only` must both return "on".',
    );
  }
}

function recallAt(truth: readonly string[], got: readonly string[], k: number): number | null {
  const denominator = truth.slice(0, k);
  if (denominator.length === 0) return null;
  const relevant = new Set(denominator);
  let hits = 0;
  for (const id of got.slice(0, k)) if (relevant.has(id)) hits += 1;
  return hits / relevant.size;
}

function mrr(truth: readonly string[], got: readonly string[], k: number): number {
  const relevant = new Set(truth.slice(0, k));
  for (let index = 0; index < got.length; index += 1) {
    if (relevant.has(got[index])) return 1 / (index + 1);
  }
  return 0;
}

function average(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) return null;
  return Number((defined.reduce((sum, value) => sum + value, 0) / defined.length).toFixed(4));
}

function sourceHit(
  chunks: readonly ScoredSearchChunk[],
  expected: readonly string[],
  k: number,
): boolean | null {
  if (expected.length === 0) return null;
  return chunks
    .slice(0, k)
    .some((chunk) => expected.some((fragment) => chunk.sourceUrl.includes(fragment)));
}

function sourceRank(
  chunks: readonly ScoredSearchChunk[],
  expected: readonly string[],
): number | null {
  if (expected.length === 0) return null;
  const index = chunks.findIndex((chunk) =>
    expected.some((fragment) => chunk.sourceUrl.includes(fragment)),
  );
  return index >= 0 ? index + 1 : null;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--allow-cloudflare')) {
    throw new Error(
      'Refusing to run retrieval evaluation without --allow-cloudflare; ' +
        'this prevents consuming Cloudflare embedding quota.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_AI_TOKEN?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN are required');
  }

  const sampleArg = process.argv.find((argument) => argument.startsWith('--samples='));
  const sampleCount = Math.max(0, Number(sampleArg?.split('=')[1] ?? 40) || 0);
  const questions = JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/eval/questions.json'), 'utf8'),
  ) as EvalQuestion[];

  const probes = ivfflatProbesFromEnv();
  // One protected handle is used for retrieval, exact scans, and samples.
  const db = await createReadOnlyDb(databaseUrl);
  activeReadOnlyDb = db;
  await assertReadOnly(db);
  const store = new PostgresSearchStore(db, {
    ivfflatProbes: probes,
    organizationName: getGitHubOrg(),
  });
  const embeddingClient = new CloudflareEmbeddingClient({ accountId, token });
  const retrieval = new RetrievalService({
    embeddingClient,
    searchStore: store,
    guildId: getDiscordGuildId(),
    minScore: Number(process.env.EVIDENCE_MIN_SCORE ?? 0.4),
    blockedChannelIds: [getDiscordOutputChannelId()],
    organizationName: getGitHubOrg(),
    candidateLimit: 20,
  });

  const repositoryFilter = (repository?: string) => {
    if (!repository) return sql``;
    const prefix = `${repository.toLowerCase()}`;
    return sql`
      AND source_type = 'github'
      AND (
        left(lower(source_id), ${prefix.length + 1}) = ${`${prefix}#`}
        OR left(lower(source_id), ${prefix.length + 1}) = ${`${prefix}@`}
      )
    `;
  };

  const exactVector = async (
    embedding: readonly number[],
    limit: number,
    repository?: string,
  ): Promise<string[]> => {
    const literal = `[${embedding.join(',')}]`;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_indexscan = off`);
      await tx.execute(sql`SET LOCAL enable_bitmapscan = off`);
      await tx.execute(sql`SET LOCAL max_parallel_workers_per_gather = 0`);
      return tx.execute(sql`
        SELECT id
        FROM search_chunks
        WHERE embedding IS NOT NULL
        ${repositoryFilter(repository)}
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${limit}
      `);
    });
    return rowsOf(result).map((row) => row.id);
  };

  const questionResults: Array<Record<string, unknown>> = [];
  const knownRepositories = (
    await db.select({ fullName: repositories.fullName }).from(repositories)
  ).map((repository) => repository.fullName);

  for (const question of questions) {
    const query = question.question.trim();
    const scopes = question.repository
      ? [question.repository]
      : repositoryScopesFromQuestion(query, getGitHubOrg(), knownRepositories);
    const repository = scopes.length === 1 ? scopes[0] : undefined;
    const [embedding] = await embeddingClient.embed([query]);
    if (!embedding) throw new Error(`Embedding failed for ${question.id}`);

    const truth = await exactVector(embedding, 10, repository);
    const approximate = await store.vectorSearch(embedding, 10, repository);
    const approximateIds = approximate.map((chunk) => chunk.id ?? '');

    const started = performance.now();
    let hybrid: Awaited<ReturnType<RetrievalService['retrieve']>>;
    if (scopes.length > 1) {
      const scoped = await Promise.all(
        scopes.map((scope) => retrieval.retrieve(query, scope)),
      );
      const chunks = scoped
        .flatMap((result) => (result.ok ? result.chunks : []))
        .sort((left, right) => right.score - left.score);
      hybrid = chunks.length > 0
        ? { ok: true, chunks }
        : { ok: false, message: NO_EVIDENCE_MESSAGE };
    } else {
      hybrid = await retrieval.retrieve(query, repository);
    }
    const latencyMs = Number((performance.now() - started).toFixed(1));
    const hybridChunks = hybrid.ok ? hybrid.chunks : [];

    const expected = question.expected_source_any ?? [];
    const required = question.required_source_any ?? [];
    questionResults.push({
      id: question.id,
      category: question.category,
      repository: repository ?? null,
      scopes,
      expectedSources: expected,
      requiredSources: required,
      approximateRecall5: recallAt(truth, approximateIds, 5),
      approximateRecall10: recallAt(truth, approximateIds, 10),
      approximateMrr: mrr(truth, approximateIds, 5),
      hybridRecall5: recallAt(truth, hybridChunks.map((chunk) => chunk.id ?? ''), 5),
      hybridRecall10: recallAt(truth, hybridChunks.map((chunk) => chunk.id ?? ''), 10),
      hybridMrr: mrr(truth, hybridChunks.map((chunk) => chunk.id ?? ''), 5),
      sourceHit5: sourceHit(hybridChunks, expected, 5),
      sourceHit10: sourceHit(hybridChunks, expected, 10),
      requiredSourceHit5: sourceHit(hybridChunks, required, 5),
      requiredSourceHit10: sourceHit(hybridChunks, required, 10),
      expectedSourceRank: sourceRank(hybridChunks, expected),
      requiredSourceRank: sourceRank(hybridChunks, required),
      zeroResult: !hybrid.ok || hybridChunks.length === 0,
      retrieved: hybridChunks.length,
      latencyMs,
      topSources: hybridChunks.slice(0, 10).map((chunk) => chunk.sourceUrl),
    });
    console.log(
      `${question.id}: ${hybridChunks.length} chunks, source rank ${sourceRank(hybridChunks, expected) ?? '-'} , ${latencyMs}ms`,
    );
  }

  const sampleResults: Array<Record<string, unknown>> = [];
  if (sampleCount > 0) {
    const samples = (
      await db.execute(sql`
        SELECT id, embedding::text AS embedding
        FROM search_chunks
        WHERE embedding IS NOT NULL
        ORDER BY md5(id::text)
        LIMIT ${sampleCount}
      `)
    ).rows as Array<{ id: string; embedding: string }>;

    for (const sample of samples) {
      const vector = JSON.parse(sample.embedding) as number[];
      const truth = await exactVector(vector, 10);
      const approximate = await store.vectorSearch(vector, 10);
      const ids = approximate.map((chunk) => chunk.id ?? '');
      sampleResults.push({
        id: sample.id,
        approximateRecall5: recallAt(truth, ids, 5),
        approximateRecall10: recallAt(truth, ids, 10),
        approximateMrr: mrr(truth, ids, 5),
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    ivfflatProbes: probes,
    questions: {
      total: questionResults.length,
      approximateRecall5: average(questionResults.map((r) => r.approximateRecall5 as number | null)),
      approximateRecall10: average(questionResults.map((r) => r.approximateRecall10 as number | null)),
      approximateMrr: average(questionResults.map((r) => r.approximateMrr as number | null)),
      hybridRecall5: average(questionResults.map((r) => r.hybridRecall5 as number | null)),
      hybridRecall10: average(questionResults.map((r) => r.hybridRecall10 as number | null)),
      hybridMrr: average(questionResults.map((r) => r.hybridMrr as number | null)),
      sourceHit5: average(questionResults.map((r) => (r.sourceHit5 === null ? null : Number(r.sourceHit5)))),
      sourceHit10: average(questionResults.map((r) => (r.sourceHit10 === null ? null : Number(r.sourceHit10)))),
      requiredSourceHit5: average(questionResults.map((r) => (r.requiredSourceHit5 === null ? null : Number(r.requiredSourceHit5)))),
      requiredSourceHit10: average(questionResults.map((r) => (r.requiredSourceHit10 === null ? null : Number(r.requiredSourceHit10)))),
      zeroResultRate: Number(
        (
          questionResults.filter((result) => result.zeroResult).length /
          questionResults.length
        ).toFixed(4),
      ),
      latencyMs: average(questionResults.map((r) => r.latencyMs as number)),
    },
    samples: {
      total: sampleResults.length,
      approximateRecall5: average(sampleResults.map((r) => r.approximateRecall5 as number | null)),
      approximateRecall10: average(sampleResults.map((r) => r.approximateRecall10 as number | null)),
      approximateMrr: average(sampleResults.map((r) => r.approximateMrr as number | null)),
    },
    results: questionResults,
    sampleResults,
  };

  const reportPath = resolve(process.cwd(), 'tmp/eval-retrieval-report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.questions, null, 2));
  console.log(JSON.stringify(summary.samples, null, 2));
  console.log(`Report: ${reportPath}`);
  await db.$client?.end?.();
  activeReadOnlyDb = undefined;
}

main().catch(async (error: unknown) => {
  console.error('Retrieval eval failed:', error instanceof Error ? error.message : String(error));
  try {
    await activeReadOnlyDb?.$client?.end?.();
  } catch {
    // Preserve the original evaluation error.
  }
  process.exitCode = 1;
});
