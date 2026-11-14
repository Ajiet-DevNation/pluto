import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_EVIDENCE_MESSAGE } from '../../src/guardrails/evidence';
import {
  AskService,
  buildAskPrompt,
  repositoryScopeFromQuestion,
  renderAnswer,
  selectAnswerChunks,
  sourcesFromChunks,
  renderAnswer,
  stripCitationMarkers,
  isReadOnlyRequest,
} from '../../src/search/ask';
import type { AnswerGenerator, ScoredSearchChunk } from '../../src/search/types';
import { AnswerQuotaExceededError } from '../../src/search/embedding-errors';

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
    reason: 'no-evidence',
  });
  assert.deepEqual(await ask.ask('unknown'), {
    ok: false,
    message: NO_EVIDENCE_MESSAGE,
    reason: 'no-evidence',
  });
  assert.deepEqual(generator.prompts, []);
});

test('a grounded answer includes the evidence and source links', async () => {
  const generator = new FakeGenerator();
  const ask = service([chunk()], generator);

  const result = await ask.ask('what is the stack?');

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.answer, 'The stack is TypeScript and Postgres.');
    assert.doesNotMatch(result.answer, /Sources:|https?:\/\/|\[1\]/);
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
  assert.deepEqual(sources[0].references, [1, 2]);
});

test('answer evidence is limited to three unique URLs and two chunks per URL', () => {
  const chunks = [
    chunk({ sourceUrl: 'https://github.com/Ajiet-DevNation/repo-a/blob/main/a.ts' }),
    chunk({ sourceUrl: 'https://github.com/Ajiet-DevNation/repo-a/blob/main/a.ts', chunkIndex: 1 }),
    chunk({ sourceUrl: 'https://github.com/Ajiet-DevNation/repo-a/blob/main/b.ts', chunkIndex: 0 }),
    chunk({ sourceUrl: 'https://github.com/Ajiet-DevNation/repo-b/blob/main/c.ts' }),
    chunk({ sourceUrl: 'https://github.com/Ajiet-DevNation/repo-c/blob/main/d.ts' }),
  ];
  const selected = selectAnswerChunks(chunks);
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map((item) => item.sourceUrl)).size, 3);
  assert.equal(sourcesFromChunks(selected).length, 3);
});

test('current-stack questions prefer default-branch files over commit messages', () => {
  const commit = chunk({
    sourceType: 'github',
    sourceUrl: 'https://github.com/Ajiet-DevNation/dn-orbit/commit/da2fb19',
    sourceId: 'Ajiet-DevNation/dn-orbit@da2fb19',
    content: 'chore(deps): bump next to 16.4.2',
    score: 0.95,
  });
  const manifest = chunk({
    sourceType: 'github',
    sourceUrl: 'https://github.com/Ajiet-DevNation/dn-orbit/blob/main/package.json',
    sourceId: 'Ajiet-DevNation/dn-orbit#file:package-json-hash',
    content: '"next": "16.3.1"',
    score: 0.72,
  });
  const selected = selectAnswerChunks([commit, manifest], [], 3, 6, 'project stack in dn-orbit');
  assert.equal(selected[0].sourceUrl, manifest.sourceUrl);
});

test('extracts an explicit repository qualifier for scoped retrieval', () => {
  assert.equal(
    repositoryScopeFromQuestion(
      'According to Ajiet-DevNation/DevNation-CMS, what is the project for?',
      'Ajiet-DevNation',
    ),
    'Ajiet-DevNation/DevNation-CMS',
  );
  assert.equal(repositoryScopeFromQuestion('What is Pluto?', 'Ajiet-DevNation'), undefined);
  assert.equal(
    repositoryScopeFromQuestion('What is the project stack in dn-orbit?', 'Ajiet-DevNation', [
      'Ajiet-DevNation/dn-orbit',
      'Ajiet-DevNation/pluto',
    ]),
    'Ajiet-DevNation/dn-orbit',
  );
});

test('/ask passes an explicit repository qualifier to retrieval', async () => {
  let requestedRepository: string | undefined;
  const ask = new AskService({
    retrieval: {
      async retrieve(_question, repositoryFullName) {
        requestedRepository = repositoryFullName;
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator: new FakeGenerator(),
    githubOrg: 'Ajiet-DevNation',
  });

  await ask.ask('Tell me about Ajiet-DevNation/DevNation-CMS');
  assert.equal(requestedRepository, 'Ajiet-DevNation/DevNation-CMS');
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

test('citation markers and source footers are removed from displayed answers', () => {
  assert.equal(stripCitationMarkers('Grounded [1] and [2, 3].'), 'Grounded and.');
  assert.equal(renderAnswer('Answer [1]', [{ label: 'x', url: 'https://example.com', references: [1] }]), 'Answer');
});

test('displayed answers never include source links even when evidence exists', async () => {
  const ask = service([chunk()], new FakeGenerator('Claim [1] and more.'));
  const result = await ask.ask('what is the stack?');

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.answer, 'Claim and more.');
    assert.doesNotMatch(result.answer, /Sources:|https?:\/\/|\[\d+\]/);
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

test('write requests are refused without retrieval or generation', async () => {
  const generator = new FakeGenerator();
  let retrieved = 0;
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        retrieved += 1;
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator,
  });

  const result = await ask.ask('Edit the README of Ajiet-DevNation/pluto to add my name.');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'read-only');
    assert.match(result.message, /read-only/i);
  }
  assert.equal(retrieved, 0);
  assert.equal(generator.prompts.length, 0);
});

test('read questions that merely mention a change are not refused', async () => {
  assert.equal(isReadOnlyRequest('What does pull request #12 change?'), false);
  assert.equal(isReadOnlyRequest('Update me on the project status'), false);
  assert.equal(isReadOnlyRequest('Add my name to the README'), true);
});

test('a model reply that cannot find evidence becomes the standard message', async () => {
  const ask = service(
    [chunk()],
    new FakeGenerator('I cannot find evidence that Pluto supports Slack notifications.'),
  );
  const result = await ask.ask('Does Pluto support Slack notifications?');
  assert.deepEqual(result, {
    ok: false,
    message: NO_EVIDENCE_MESSAGE,
    reason: 'no-evidence',
  });
});

test('contributor questions use the structured contributor index', async () => {
  const generator = new FakeGenerator();
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async listContributors(repository) {
      assert.equal(repository, 'Ajiet-DevNation/pluto');
      return [
        { login: 'khushi', contributions: 12 },
        { login: 'pragathi', contributions: 8 },
        { login: 'likhith', contributions: 5 },
      ];
    },
  });

  const result = await ask.ask('Who are the contributors of Ajiet-DevNation/pluto?');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.answer, /khushi/);
    assert.match(result.answer, /pragathi/);
    assert.match(result.answer, /likhith/);
    assert.doesNotMatch(result.answer, /https?:\/\//);
  }
  assert.equal(generator.prompts.length, 0);
});

test('repeated identical questions are served from the answer cache', async () => {
  const generator = new FakeGenerator();
  const ask = service([chunk()], generator);

  await ask.ask('what is the stack?');
  await ask.ask('What is the stack?');
  assert.equal(generator.prompts.length, 1);
});

test('an exhausted answering reserve returns the busy message without generating', async () => {
  const generator = new FakeGenerator();
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator,
    async reserveAnswerBudget() {
      return new Date(Date.now() + 60_000);
    },
  });

  const result = await ask.ask('what is the stack?');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'quota');
  assert.equal(generator.prompts.length, 0);
});

test('a provider quota error during generation returns the busy message', async () => {
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator: {
      async generate(): Promise<string> {
        throw new AnswerQuotaExceededError(new Date(Date.now() + 60_000), 'quota');
      },
    },
  });

  const result = await ask.ask('what is the stack?');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'quota');
});
