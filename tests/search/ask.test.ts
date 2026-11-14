import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_EVIDENCE_MESSAGE } from '../../src/guardrails/evidence';
import {
  AskService,
  buildAskPrompt,
  renderAnswer,
  sourcesFromChunks,
  stripUnverifiedCitationMarkers,
} from '../../src/search/ask';
import type { AnswerGenerator, ScoredSearchChunk } from '../../src/search/types';

const OUTPUT = '1570721649538502686';

function chunk(overrides: Partial<ScoredSearchChunk> = {}): ScoredSearchChunk {
  return {
    sourceType: 'discord',
    sourceId: '1300000000000000000',
    chunkIndex: 0,
    sourceUrl:
      'https://discord.com/channels/1422593925658579036/1423323863093088407/1300000000000000000',
    channelId: '1423323863093088407',
    authorId: '200000000000000001',
    content: 'The stack is TypeScript, Node 22, Postgres and pgvector.',
    score: 0.8,
    ...overrides,
  };
}

class FakeGenerator implements AnswerGenerator {
  prompts: string[] = [];

  constructor(private readonly response = 'The stack is TypeScript and Postgres [1].') {}

  async generate(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    return this.response;
  }
}

function service(
  chunks: ScoredSearchChunk[],
  generator: FakeGenerator,
): AskService {
  return new AskService({
    retrieval: {
      async retrieve() {
        return chunks.length > 0
          ? { ok: true, chunks }
          : { ok: false, message: NO_EVIDENCE_MESSAGE };
      },
    },
    generator,
    blockedChannelIds: [OUTPUT],
  });
}

test('empty or no-evidence retrieval never calls the model', async () => {
  const generator = new FakeGenerator();
  const ask = service([], generator);

  assert.deepEqual(await ask.ask('   '), {
    ok: false,
    message: NO_EVIDENCE_MESSAGE,
  });
  assert.deepEqual(await ask.ask('unknown'), {
    ok: false,
    message: NO_EVIDENCE_MESSAGE,
  });
  assert.deepEqual(generator.prompts, []);
});

test('a grounded answer includes the evidence and source links', async () => {
  const generator = new FakeGenerator();
  const ask = service([chunk()], generator);

  const result = await ask.ask('what is the stack?');

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.answer, /The stack is TypeScript and Postgres \[1\]\./);
    assert.match(result.answer, /Sources:/);
    assert.match(result.answer, /\[Discord message\]\(https:\/\/discord\.com\/channels\//);
    assert.equal(result.sources.length, 1);
  }
  assert.equal(generator.prompts.length, 1);
  assert.match(generator.prompts[0], /Question: what is the stack\?/);
  assert.match(generator.prompts[0], /\[1\] Discord message/);
  assert.match(generator.prompts[0], /TypeScript/);
});

test('source links are de-duplicated by URL', async () => {
  const sources = sourcesFromChunks([chunk(), chunk({ chunkIndex: 1 })]);
  assert.equal(sources.length, 1);
});

test('blocked channels never become citations', () => {
  const sources = sourcesFromChunks(
    [
      chunk({
        channelId: OUTPUT,
        sourceUrl: `https://discord.com/channels/1422593925658579036/${OUTPUT}/1400000000000000000`,
      }),
    ],
    [OUTPUT],
  );
  assert.deepEqual(sources, []);
});

test('blocked channels are also detected from a Discord URL when channelId is missing', () => {
  const sources = sourcesFromChunks(
    [
      chunk({
        channelId: null,
        sourceUrl: `https://discord.com/channels/1422593925658579036/${OUTPUT}/1400000000000000000`,
      }),
    ],
    [OUTPUT],
  );
  assert.deepEqual(sources, []);
});

test('prompt labels all four source types', () => {
  const prompt = buildAskPrompt('q', [
    chunk({ sourceType: 'github', sourceUrl: 'https://github.com/a/b/issues/1' }),
    chunk({ sourceType: 'discord' }),
    chunk({ sourceType: 'meeting', sourceUrl: 'https://example.com/meeting' }),
    chunk({ sourceType: 'miro', sourceUrl: 'https://miro.com/app/board/x/' }),
  ]);

  assert.match(prompt, /\[1\] GitHub/);
  assert.match(prompt, /\[2\] Discord message/);
  assert.match(prompt, /\[3\] Meeting transcript/);
  assert.match(prompt, /\[4\] Miro board/);
});

test('renderAnswer leaves an answer without sources unchanged', () => {
  assert.equal(renderAnswer(' plain answer ', []), 'plain answer');
});

test('unverified citation markers are removed', () => {
  assert.equal(
    stripUnverifiedCitationMarkers('Grounded [1] but invented [2].', 1),
    'Grounded [1] but invented .',
  );
  assert.equal(
    stripUnverifiedCitationMarkers('Mixed [1, 7] and [0].', 2),
    'Mixed [1] and .',
  );
  assert.equal(stripUnverifiedCitationMarkers('No citations.', 0), 'No citations.');
});

test('answers can only cite evidence that passed the gate', async () => {
  const ask = service([chunk()], new FakeGenerator('Claim [1] and invented [2].'));
  const result = await ask.ask('what is the stack?');

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.answer, /Claim \[1\]/);
    assert.doesNotMatch(result.answer, /\[2\]/);
  }
});

test('generator errors propagate so the command can report them', async () => {
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator: {
      async generate(): Promise<string> {
        throw new Error('provider down');
      },
    },
  });

  await assert.rejects(() => ask.ask('question'), /provider down/);
});
