import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndexer } from '../../src/search/indexer';
import { EmbeddingDeferredError, EmbeddingQuotaExceededError } from '../../src/search/embedding-errors';
import type { ChunkIdentity, SearchChunkInput } from '../../src/search/types';

function fakes(stored: Set<string>) {
  const embedded: string[][] = [];
  const upserted: SearchChunkInput[] = [];
  const vectors = new Map<string, readonly number[]>();
  const store = {
    async upsertChunks(chunks: readonly SearchChunkInput[]) {
      upserted.push(...chunks);
      for (const chunk of chunks) {
        if (chunk.contentHash && chunk.embedding) vectors.set(chunk.contentHash, chunk.embedding);
      }
    },
    async cachedEmbeddings(hashes: readonly string[]) {
      return new Map(hashes.flatMap((hash) => {
        const vector = vectors.get(hash);
        return vector ? [[hash, vector] as const] : [];
      }));
    },
    async unchangedKeys(identities: readonly ChunkIdentity[]) {
      return new Set(
        identities
          .map((i) => `${i.sourceType}:${i.sourceId}:${i.chunkIndex}:${i.contentHash}`)
          .filter((key) => stored.has(key)),
      );
    },
    async vectorSearch() { return []; },
    async fullTextSearch() { return []; },
    async deleteDiscordAuthor() { return 0; },
  };
  const embeddingClient = {
    async embed(texts: readonly string[]) {
      embedded.push([...texts]);
      return texts.map(() => Array.from({ length: 768 }, () => 0.1));
    },
  };
  return { store, embeddingClient, embedded, upserted };
}

const issue = {
  repositoryFullName: 'Ajiet-DevNation/pluto',
  issueNumber: 1,
  title: 'Index everything',
  body: 'Body text',
  state: 'open',
  htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/issues/1',
};

test('unchanged chunks are not re-embedded on a later refresh', async () => {
  const first = fakes(new Set());
  await new SearchIndexer(first.store, first.embeddingClient).indexGitHubIssue(issue);
  assert.equal(first.embedded.length, 1);

  const stored = new Set(
    first.upserted.map((chunk) => {
      return `${chunk.sourceType}:${chunk.sourceId}:${chunk.chunkIndex}:${chunk.contentHash}`;
    }),
  );
  const second = fakes(stored);
  await new SearchIndexer(second.store, second.embeddingClient).indexGitHubIssue(issue);
  assert.equal(second.embedded.length, 0);
  assert.equal(second.upserted.length, 0);
});

test('identical content in different sources reuses the stored vector', async () => {
  const run = fakes(new Set());
  const indexer = new SearchIndexer(run.store, run.embeddingClient);
  await indexer.indexGitHubCommit({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    sha: 'first',
    message: 'same commit message',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/commit/first',
  });
  await indexer.indexGitHubCommit({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    sha: 'second',
    message: 'same commit message',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/commit/second',
  });
  assert.equal(run.embedded.length, 1);
  assert.equal(run.upserted.length, 2);
  assert.ok(run.upserted[1].embedding);
});

test('quota exhaustion defers cleanly and persists the provider pause', async () => {
  const run = fakes(new Set());
  const resumeAt = new Date(Date.now() + 60_000);
  let deferredUntil: Date | undefined;
  run.store.deferEmbeddingUntil = async (date: Date) => { deferredUntil = date; };
  const quotaClient = {
    async embed() { throw new EmbeddingQuotaExceededError(resumeAt, 'quota exhausted'); },
  };
  const indexer = new SearchIndexer(run.store, quotaClient);
  await assert.rejects(
    () => indexer.indexGitHubIssue(issue),
    (error: unknown) => error instanceof EmbeddingDeferredError && error.reason === 'provider-quota',
  );
  assert.equal(deferredUntil?.getTime(), resumeAt.getTime());
  assert.equal(run.upserted.length, 0);
});

test('daily budget exhaustion defers before calling the embedding provider', async () => {
  const run = fakes(new Set());
  const resumeAt = new Date(Date.now() + 60_000);
  run.store.reserveEmbeddingBudget = async () => resumeAt;
  const indexer = new SearchIndexer(run.store, run.embeddingClient);
  await assert.rejects(
    () => indexer.indexGitHubIssue(issue),
    (error: unknown) => error instanceof EmbeddingDeferredError && error.reason === 'daily-budget',
  );
  assert.equal(run.embedded.length, 0);
  assert.equal(run.upserted.length, 0);
});

test('run budget pauses after persisting successful chunks for a later resume', async () => {
  const oldRunBudget = process.env.INDEX_EMBEDDING_RUN_BUDGET;
  process.env.INDEX_EMBEDDING_RUN_BUDGET = '1800';
  try {
    const run = fakes(new Set());
    const indexer = new SearchIndexer(run.store, run.embeddingClient);
    const message = Array.from({ length: 5000 }, (_, index) => `word${index}`).join(' ');
    await assert.rejects(
      () => indexer.indexGitHubCommit({
        repositoryFullName: 'Ajiet-DevNation/pluto',
        sha: 'long',
        message,
        htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/commit/long',
      }),
      (error: unknown) => error instanceof EmbeddingDeferredError && error.reason === 'run-budget',
    );
    assert.equal(run.embedded.length, 1);
    assert.ok(run.upserted.length > 0, 'completed chunks should be saved before yielding');
  } finally {
    if (oldRunBudget === undefined) delete process.env.INDEX_EMBEDDING_RUN_BUDGET;
    else process.env.INDEX_EMBEDDING_RUN_BUDGET = oldRunBudget;
  }
});

test('changed content is re-embedded', async () => {
  const run = fakes(new Set(['github:Ajiet-DevNation/pluto#1:0:stale']));
  await new SearchIndexer(run.store, run.embeddingClient).indexGitHubIssue(issue);
  assert.equal(run.embedded.length, 1);
  assert.equal(run.upserted.length, 1);
});
