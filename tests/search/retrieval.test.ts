import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_EVIDENCE_MESSAGE } from '../../src/guardrails/evidence';
import {
  RetrievalService,
  filterRetrievedChunks,
  mergeCandidates,
} from '../../src/search/retrieval';
import type {
  EmbeddingClient,
  ScoredSearchChunk,
  SearchStore,
} from '../../src/search/types';

const GUILD = '1422593925658579036';
const OUTPUT = '1570721649538502686';
const PROJECT_STACK = '1423323863093088407';

function chunk(overrides: Partial<ScoredSearchChunk> = {}): ScoredSearchChunk {
  return {
    sourceType: 'discord',
    sourceId: '1300000000000000000',
    chunkIndex: 0,
    sourceUrl: `https://discord.com/channels/${GUILD}/${PROJECT_STACK}/1300000000000000000`,
    channelId: PROJECT_STACK,
    authorId: '200000000000000001',
    content: 'The project stack is TypeScript and Postgres.',
    score: 0.8,
    ...overrides,
  };
}

class FakeSearchStore implements SearchStore {
  vectorCalls: Array<{ embedding: readonly number[]; limit: number }> = [];
  textCalls: Array<{ query: string; limit: number }> = [];

  constructor(
    private readonly vector: ScoredSearchChunk[] = [],
    private readonly text: ScoredSearchChunk[] = [],
  ) {}

  async upsertChunks(): Promise<void> {}

  async vectorSearch(embedding: readonly number[], limit: number): Promise<ScoredSearchChunk[]> {
    this.vectorCalls.push({ embedding, limit });
    return this.vector;
  }

  async fullTextSearch(query: string, limit: number): Promise<ScoredSearchChunk[]> {
    this.textCalls.push({ query, limit });
    return this.text;
  }

  async deleteDiscordAuthor(): Promise<number> {
    return 0;
  }
}

class FakeEmbeddings implements EmbeddingClient {
  calls: string[][] = [];

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map(() => Array.from({ length: 768 }, () => 0.1));
  }
}

class FakeOptOut {
  calls: Array<[string, string]> = [];
  constructor(private readonly optedOut: Set<string> = new Set()) {}

  async isOptedOut(guildId: string, userId: string): Promise<boolean> {
    this.calls.push([guildId, userId]);
    return this.optedOut.has(userId);
  }
}

test('mergeCandidates keeps the best score per chunk and sorts descending', () => {
  const vector = [chunk({ score: 0.4 }), chunk({ sourceId: 'a', score: 0.9 })];
  const text = [chunk({ score: 0.7 }), chunk({ sourceId: 'b', score: 0.6 })];

  const merged = mergeCandidates(vector, text);

  assert.deepEqual(
    merged.map((entry) => [entry.sourceId, entry.score]),
    [
      ['a', 0.9],
      ['1300000000000000000', 0.7],
      ['b', 0.6],
    ],
  );
});

test('filtering removes #pluto links and opted-out authors', async () => {
  const optOut = new FakeOptOut(new Set(['200000000000000001']));
  const filtered = await filterRetrievedChunks(
    [
      chunk(),
      chunk({
        sourceId: 'bot-answer',
        channelId: OUTPUT,
        sourceUrl: `https://discord.com/channels/${GUILD}/${OUTPUT}/1400000000000000000`,
      }),
      chunk({
        sourceId: 'other-author',
        authorId: '200000000000000002',
        sourceUrl: `https://discord.com/channels/${GUILD}/${PROJECT_STACK}/1300000000000000001`,
      }),
    ],
    {
      optOutStore: optOut,
      guildId: GUILD,
      blockedChannelIds: [OUTPUT],
    },
  );

  assert.deepEqual(filtered.map((entry) => entry.sourceId), ['other-author']);
  assert.deepEqual(optOut.calls, [
    [GUILD, '200000000000000001'],
    [GUILD, '200000000000000002'],
  ]);
});

test('filtering falls back to the channel encoded in a Discord URL', async () => {
  const filtered = await filterRetrievedChunks(
    [
      chunk({
        channelId: null,
        sourceUrl: `https://discord.com/channels/${GUILD}/${OUTPUT}/1400000000000000000`,
      }),
    ],
    { guildId: GUILD, blockedChannelIds: [OUTPUT] },
  );
  assert.deepEqual(filtered, []);
});

test('non-http source URLs are never evidence', async () => {
  const filtered = await filterRetrievedChunks(
    [chunk({ sourceUrl: 'javascript:alert(1)' })],
    { guildId: GUILD },
  );
  assert.deepEqual(filtered, []);
});

test('retrieval runs vector and full-text search, then passes the gate', async () => {
  const store = new FakeSearchStore(
    [chunk({ score: 0.82 })],
    [chunk({ score: 0.91, sourceId: '1300000000000000000' })],
  );
  const embeddings = new FakeEmbeddings();
  const service = new RetrievalService({
    embeddingClient: embeddings,
    searchStore: store,
    optOutStore: new FakeOptOut(),
    guildId: GUILD,
    minScore: 0.4,
    blockedChannelIds: [OUTPUT],
    candidateLimit: 20,
  });

  const result = await service.retrieve('what is the project stack?');

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].score, 0.91);
  }
  assert.deepEqual(embeddings.calls, [['what is the project stack?']]);
  assert.equal(store.vectorCalls[0].limit, 20);
  assert.equal(store.textCalls[0].query, 'what is the project stack?');
});

test('retrieval returns the standard no-evidence result below the threshold', async () => {
  const service = new RetrievalService({
    embeddingClient: new FakeEmbeddings(),
    searchStore: new FakeSearchStore([chunk({ score: 0.2 })]),
    optOutStore: new FakeOptOut(),
    guildId: GUILD,
    minScore: 0.4,
  });

  const result = await service.retrieve('unanswerable');
  assert.deepEqual(result, { ok: false, message: NO_EVIDENCE_MESSAGE });
});

test('empty questions never call the embedding provider', async () => {
  const embeddings = new FakeEmbeddings();
  const service = new RetrievalService({
    embeddingClient: embeddings,
    searchStore: new FakeSearchStore(),
    guildId: GUILD,
    minScore: 0.4,
  });

  const result = await service.retrieve('   ');
  assert.deepEqual(result, { ok: false, message: NO_EVIDENCE_MESSAGE });
  assert.deepEqual(embeddings.calls, []);
});
