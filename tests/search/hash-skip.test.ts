import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SearchIndexer } from '../../src/search/indexer';
import type { ChunkIdentity, SearchChunkInput } from '../../src/search/types';

function fakes(stored: Set<string>) {
  const embedded: string[][] = [];
  const upserted: SearchChunkInput[] = [];
  const store = {
    async upsertChunks(chunks: readonly SearchChunkInput[]) {
      upserted.push(...chunks);
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
      const hash = createHash('sha256').update(chunk.content).digest('hex');
      return `${chunk.sourceType}:${chunk.sourceId}:${chunk.chunkIndex}:${hash}`;
    }),
  );
  const second = fakes(stored);
  await new SearchIndexer(second.store, second.embeddingClient).indexGitHubIssue(issue);
  assert.equal(second.embedded.length, 0);
  assert.equal(second.upserted.length, 0);
});

test('changed content is re-embedded', async () => {
  const run = fakes(new Set(['github:Ajiet-DevNation/pluto#1:0:stale']));
  await new SearchIndexer(run.store, run.embeddingClient).indexGitHubIssue(issue);
  assert.equal(run.embedded.length, 1);
  assert.equal(run.upserted.length, 1);
});
