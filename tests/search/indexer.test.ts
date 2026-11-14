import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDiscordStore } from '../../src/discord/store';
import { SearchBackedDiscordStore, SearchIndexer } from '../../src/search/indexer';
import type {
  EmbeddingClient,
  SearchChunkInput,
  SearchStore,
  ScoredSearchChunk,
} from '../../src/search/types';
import { makeRecord } from '../discord/helpers';

class FakeSearchStore implements SearchStore {
  readonly writes: SearchChunkInput[][] = [];
  deleted: string[] = [];

  async upsertChunks(chunks: readonly SearchChunkInput[]): Promise<void> {
    this.writes.push(chunks.map((chunk) => ({ ...chunk })));
  }

  async vectorSearch(): Promise<ScoredSearchChunk[]> {
    return [];
  }

  async fullTextSearch(): Promise<ScoredSearchChunk[]> {
    return [];
  }

  async deleteDiscordAuthor(authorId: string): Promise<number> {
    this.deleted.push(authorId);
    return 1;
  }
}

class FakeEmbeddings implements EmbeddingClient {
  readonly batches: string[][] = [];

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.batches.push([...texts]);
    return texts.map(() => Array.from({ length: 768 }, () => 0.5));
  }
}

test('Discord records are embedded and upserted as search chunks', async () => {
  const store = new FakeSearchStore();
  const embeddings = new FakeEmbeddings();
  const indexer = new SearchIndexer(store, embeddings);

  await indexer.indexDiscordRecords([makeRecord()]);

  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].length, 1);
  assert.equal(store.writes[0][0].sourceType, 'discord');
  assert.equal(store.writes[0][0].sourceId, makeRecord().messageId);
  assert.equal(store.writes[0][0].embedding?.length, 768);
  assert.deepEqual(embeddings.batches, [[makeRecord().content]]);
});

test('bot-authored records are filtered before embedding', async () => {
  const store = new FakeSearchStore();
  const embeddings = new FakeEmbeddings();
  const indexer = new SearchIndexer(store, embeddings);

  await indexer.indexDiscordRecords([makeRecord({ authorIsBot: true })]);

  assert.deepEqual(store.writes, []);
  assert.deepEqual(embeddings.batches, []);
});

test('GitHub issues are chunked and embedded', async () => {
  const store = new FakeSearchStore();
  const indexer = new SearchIndexer(store, new FakeEmbeddings());

  await indexer.indexGitHubIssue({
    repositoryFullName: 'Ajiet-DevNation/pluto',
    issueNumber: 9,
    title: 'P1',
    body: 'Discord indexing',
    state: 'closed',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/9',
  });

  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0][0].sourceId, 'Ajiet-DevNation/pluto#9');
});

test('the composite store writes both the JSON store and the search index', async () => {
  const base = new InMemoryDiscordStore();
  const indexer = new SearchIndexer(new FakeSearchStore(), new FakeEmbeddings());
  const store = new SearchBackedDiscordStore(base, indexer);
  const record = makeRecord();

  await store.upsert(record);

  assert.deepEqual(await base.listRecords(), [record]);
  assert.equal((await store.listRecords()).length, 1);
});

test('opting out purges the JSON store and search chunks', async () => {
  const base = new InMemoryDiscordStore();
  const searchStore = new FakeSearchStore();
  const indexer = new SearchIndexer(searchStore, new FakeEmbeddings());
  const store = new SearchBackedDiscordStore(base, indexer);
  const record = makeRecord();

  await store.upsert(record);
  const removed = await store.removeAuthor(record.guildId, record.authorId);

  assert.equal(removed, 1);
  assert.deepEqual(await base.listRecords(), []);
  assert.deepEqual(searchStore.deleted, [record.authorId]);
});
