import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_EVIDENCE_MESSAGE } from '../../src/guardrails/evidence';
import {
  AskService,
  buildAskPrompt,
  repositoryScopeFromQuestion,
  repositoryScopesFromQuestion,
  renderAnswer,
  selectAnswerChunks,
  selectDisplaySources,
  sourcesFromChunks,
  stripCitationMarkers,
  stripUrls,
  isReadOnlyRequest,
  isRepositoryListQuestion,
  isRepositoryPurposeQuestion,
  hasUnsupportedVersionClaim,
} from '../../src/search/ask';
import { ContributorLookupError, formatContributors } from '../../src/search/contributors';
import { stripInternalPromptLeakage } from '../../src/search/prompt';
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

test('repository-list questions take one chunk per repository first', () => {
  const url = (repo: string, path = 'README.md') =>
    `https://github.com/Ajiet-DevNation/${repo}/blob/main/${path}`;
  const chunks = [
    chunk({ sourceType: 'github', sourceUrl: url('repo-a'), content: 'a1', score: 0.9 }),
    chunk({ sourceType: 'github', sourceUrl: url('repo-a', 'b.ts'), content: 'a2', score: 0.8 }),
    chunk({ sourceType: 'github', sourceUrl: url('repo-b'), content: 'b1', score: 0.5 }),
    chunk({ sourceType: 'github', sourceUrl: url('repo-c'), content: 'c1', score: 0.4 }),
    chunk({ sourceType: 'github', sourceUrl: url('repo-d'), content: 'd1', score: 0.3 }),
  ];

  const selected = selectAnswerChunks(
    chunks,
    [],
    3,
    3,
    'Which repositories use Next.js?',
    { preferDistinctGithubRepositories: true },
  );

  assert.deepEqual(
    selected.map((entry) => entry.content),
    ['a1', 'b1', 'c1'],
  );
});

test('repository-list detection is limited to listing questions', () => {
  assert.equal(isRepositoryListQuestion('Which repositories use Next.js?'), true);
  assert.equal(isRepositoryListQuestion('List the repos that use Postgres'), true);
  assert.equal(isRepositoryListQuestion('What is the project stack?'), false);
});

test('repository-purpose detection excludes artifact and generic overview questions', () => {
  assert.equal(
    isRepositoryPurposeQuestion('What is Ajiet-DevNation/pluto for?'),
    true,
  );
  assert.equal(isRepositoryPurposeQuestion('What is the repository purpose?'), true);
  assert.equal(isRepositoryPurposeQuestion('Give an overview of the repository'), true);
  assert.equal(isRepositoryPurposeQuestion('What is the project about?'), true);

  assert.equal(isRepositoryPurposeQuestion('Give an overview of the current project stack'), false);
  assert.equal(isRepositoryPurposeQuestion('Give an overview of the project'), false);
  assert.equal(isRepositoryPurposeQuestion('What is the purpose of this pull request?'), false);
  assert.equal(isRepositoryPurposeQuestion('What is the purpose of this issue?'), false);
  assert.equal(isRepositoryPurposeQuestion('What is Pluto?'), false);
});

test('PR purpose questions keep PR evidence while repository overviews require docs', () => {
  const pr = chunk({
    sourceType: 'github',
    sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/7',
    content: 'PR purpose evidence',
  });
  const question = 'What is the purpose of this pull request?';
  const selected = selectAnswerChunks([pr], [], 3, 6, question, {
    purpose: isRepositoryPurposeQuestion(question),
  });
  assert.deepEqual(selected.map((entry) => entry.sourceUrl), [pr.sourceUrl]);

  const overview = 'What is the repository for?';
  const filtered = selectAnswerChunks([pr], [], 3, 6, overview, {
    purpose: isRepositoryPurposeQuestion(overview),
  });
  assert.deepEqual(filtered, []);
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
  assert.equal(
    repositoryScopeFromQuestion('Summarize issue #99999 in Ajiet-DevNation/pluto.', 'Ajiet-DevNation'),
    'Ajiet-DevNation/pluto',
  );
  assert.equal(
    repositoryScopeFromQuestion('What is in Ajiet-DevNation/pluto?', 'Ajiet-DevNation'),
    'Ajiet-DevNation/pluto',
  );
});

test('extracts every explicitly named repository for comparison questions', () => {
  assert.deepEqual(
    repositoryScopesFromQuestion(
      'Compare Ajiet-DevNation/pluto and Ajiet-DevNation/dn-orbit.',
      'Ajiet-DevNation',
    ),
    ['Ajiet-DevNation/pluto', 'Ajiet-DevNation/dn-orbit'],
  );
  assert.deepEqual(
    repositoryScopesFromQuestion('Compare Pluto and dn-orbit', 'Ajiet-DevNation', [
      'Ajiet-DevNation/pluto',
      'Ajiet-DevNation/dn-orbit',
    ]),
    ['Ajiet-DevNation/pluto', 'Ajiet-DevNation/dn-orbit'],
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

test('multi-repository questions retrieve from every named repository', async () => {
  const calls: string[] = [];
  const generator = new FakeGenerator('Both repositories are compared.');
  const ask = new AskService({
    retrieval: {
      async retrieve(_question, repositoryFullName) {
        if (!repositoryFullName) throw new Error('expected a repository scope');
        calls.push(repositoryFullName);
        return {
          ok: true,
          chunks: [
            chunk({
              sourceType: 'github',
              sourceId: `${repositoryFullName}#readme`,
              sourceUrl: `https://github.com/${repositoryFullName}/blob/main/README.md`,
              content: `${repositoryFullName} README`,
              score: 0.9,
            }),
          ],
        };
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async resolveRepositoryScopes() {
      return ['Ajiet-DevNation/pluto', 'Ajiet-DevNation/dn-orbit'];
    },
  });

  const result = await ask.ask('Compare Ajiet-DevNation/pluto and Ajiet-DevNation/dn-orbit');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(calls, ['Ajiet-DevNation/pluto', 'Ajiet-DevNation/dn-orbit']);
    assert.equal(result.chunks.length, 2);
    assert.equal(result.sources.length, 2);
  }
  assert.match(generator.prompts[0], /Ajiet-DevNation\/pluto/);
  assert.match(generator.prompts[0], /Ajiet-DevNation\/dn-orbit/);
});

test('seven explicitly requested repositories are all included', async () => {
  const scopes = Array.from({ length: 7 }, (_, index) => `Ajiet-DevNation/repo-${index}`);
  const calls: string[] = [];
  const generator = new FakeGenerator('All seven repositories are compared.');
  const ask = new AskService({
    retrieval: {
      async retrieve(_question, repositoryFullName) {
        if (!repositoryFullName) throw new Error('expected a repository scope');
        calls.push(repositoryFullName);
        return {
          ok: true,
          chunks: [
            chunk({
              sourceType: 'github',
              sourceId: `${repositoryFullName}#readme`,
              sourceUrl: `https://github.com/${repositoryFullName}/blob/main/README.md`,
              content: `${repositoryFullName} README`,
              score: 0.9,
            }),
          ],
        };
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async resolveRepositoryScopes() {
      return scopes;
    },
  });

  const result = await ask.ask(`Compare ${scopes.join(', ')}`);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(calls.length, 7);
    assert.equal(result.chunks.length, 7);
    assert.equal(result.sources.length, 7);
    assert.equal(new Set(result.sources.map((source) => source.url)).size, 7);
  }
});

test('a grounded answer displays one source and keeps full internal evidence', async () => {
  const generator = new FakeGenerator();
  const ask = service(
    [
      chunk({
        sourceType: 'github',
        sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/src/index.ts',
        content: 'Typescript entry point.',
        score: 0.9,
      }),
      chunk({
        sourceType: 'github',
        sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
        content: 'Pluto project documentation.',
        score: 0.7,
      }),
    ],
    generator,
  );

  const result = await ask.ask('what is the project stack?');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sources.length, 2);
    assert.equal(result.displaySources?.length, 1);
    assert.match(result.displaySources?.[0]?.url ?? '', /README\.md$/);
  }
});

test('direct PR and issue questions select the exact source', () => {
  const chunks = [
    chunk({
      sourceType: 'github',
      sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/7#discussion_r123',
      content: 'PR 7',
    }),
    chunk({
      sourceType: 'github',
      sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/issues/7?notification_referrer_id=1',
      content: 'Issue 7',
    }),
    chunk({
      sourceType: 'github',
      sourceUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
      content: 'README',
    }),
  ];
  const sources = sourcesFromChunks(chunks);
  assert.equal(
    selectDisplaySources('What does PR #7 change?', chunks, sources)[0]?.url,
    'https://github.com/Ajiet-DevNation/pluto/pull/7#discussion_r123',
  );
  assert.equal(
    selectDisplaySources('What does issue #7 say?', chunks, sources)[0]?.url,
    'https://github.com/Ajiet-DevNation/pluto/issues/7?notification_referrer_id=1',
  );
});

test('comparisons display at most one selected source per repository', async () => {
  const ask = new AskService({
    retrieval: {
      async retrieve(_question, repositoryFullName) {
        if (!repositoryFullName) throw new Error('expected a repository scope');
        return {
          ok: true,
          chunks: [
            chunk({
              sourceType: 'github',
              sourceUrl: `https://github.com/${repositoryFullName}/blob/main/README.md`,
              content: `${repositoryFullName} README`,
              score: 0.9,
            }),
            chunk({
              sourceType: 'github',
              sourceUrl: `https://github.com/${repositoryFullName}/blob/main/src/index.ts`,
              content: `${repositoryFullName} code`,
              score: 0.8,
            }),
          ],
        };
      },
    },
    generator: new FakeGenerator('Both repositories are compared.'),
    githubOrg: 'Ajiet-DevNation',
    async resolveRepositoryScopes() {
      return ['Ajiet-DevNation/pluto', 'Ajiet-DevNation/dn-orbit'];
    },
  });

  const result = await ask.ask('Compare Ajiet-DevNation/pluto and Ajiet-DevNation/dn-orbit');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.displaySources?.length, 2);
    assert.deepEqual(
      result.displaySources?.map((source) => source.url),
      [
        'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
        'https://github.com/Ajiet-DevNation/dn-orbit/blob/main/README.md',
      ],
    );
  }
});

test('comparisons disclose repositories with only historical evidence', async () => {
  const generator = new FakeGenerator('The repositories are compared.');
  const ask = new AskService({
    retrieval: {
      async retrieve(_question, repositoryFullName) {
        if (repositoryFullName === 'Ajiet-DevNation/repo-a') {
          return {
            ok: true,
            chunks: [
              chunk({
                sourceType: 'github',
                sourceUrl: 'https://github.com/Ajiet-DevNation/repo-a/blob/main/README.md',
                content: 'repo-a README',
                score: 0.9,
              }),
            ],
          };
        }
        if (repositoryFullName === 'Ajiet-DevNation/repo-b') {
          return {
            ok: true,
            chunks: [
              chunk({
                sourceType: 'github',
                sourceUrl: 'https://github.com/Ajiet-DevNation/repo-b/commit/da2fb19',
                content: 'chore(deps): bump next to 16.4.2',
                score: 0.8,
              }),
            ],
          };
        }
        throw new Error(`unexpected scope: ${repositoryFullName}`);
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async resolveRepositoryScopes() {
      return ['Ajiet-DevNation/repo-a', 'Ajiet-DevNation/repo-b'];
    },
  });

  const result = await ask.ask(
    'Compare the purpose of Ajiet-DevNation/repo-a and Ajiet-DevNation/repo-b.',
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0]?.sourceUrl.includes('repo-a'), true);
    assert.deepEqual(
      result.displaySources?.map((source) => source.url),
      ['https://github.com/Ajiet-DevNation/repo-a/blob/main/README.md'],
    );
  }
  assert.match(generator.prompts[0], /Only incidental or non-documentation evidence \(for example commits, pull requests, Discord messages, or meeting transcripts\) was retrieved for: Ajiet-DevNation\/repo-b/);
  assert.match(generator.prompts[0], /Do not describe their overall purpose/);
});

test('internal prompt instructions never leak into the answer', async () => {
  const leaked =
    'The evidence was retrieved for this question. ' +
    'If any item answers it, use that item; you can ignore irrelevant items. ' +
    'The stack is TypeScript.';
  const ask = service([chunk()], new FakeGenerator(leaked));
  const result = await ask.ask('what is the stack?');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.answer, 'The stack is TypeScript.');
});

test('system prompt instructions never leak into the answer', async () => {
  const leaked =
    'You are Pluto, a project assistant. Answer only from the supplied evidence. ' +
    'The stack is TypeScript.';
  const ask = service([chunk()], new FakeGenerator(leaked));
  const result = await ask.ask('what is the stack?');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.answer, 'The stack is TypeScript.');
});

test('an answer containing only internal instructions becomes no-evidence', async () => {
  const ask = service(
    [chunk()],
    new FakeGenerator(
      'The evidence was retrieved for this question. ' +
        'If any item answers it, use that item; you can ignore irrelevant items.',
    ),
  );
  assert.deepEqual(await ask.ask('what is the stack?'), {
    ok: false,
    message: NO_EVIDENCE_MESSAGE,
    reason: 'no-evidence',
  });
});

test('leakage cleanup preserves normal answer text', () => {
  assert.equal(stripInternalPromptLeakage('The stack is TypeScript.'), 'The stack is TypeScript.');
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

test('URLs and source footers are removed from displayed answers', () => {
  assert.equal(
    stripUrls('See https://example.com/secret and http://localhost:3000/health.'),
    'See and.',
  );
  assert.equal(
    stripUrls('Details [here](https://example.com/path).'),
    'Details here.',
  );
  assert.equal(
    stripUrls('Answer line\n\nSources: https://example.com\n\nAfter'),
    'Answer line\n\nAfter',
  );
  assert.equal(stripUrls('Use http://localhost:3000/health.'), '');
});

test('prompt labels current files, historical commits, issues and pull requests', () => {
  const prompt = buildAskPrompt('q', [
    chunk({ sourceType: 'github', sourceUrl: 'https://github.com/a/b/blob/main/x.ts' }),
    chunk({ sourceType: 'github', sourceUrl: 'https://github.com/a/b/commit/abc1234' }),
    chunk({ sourceType: 'github', sourceUrl: 'https://github.com/a/b/issues/4' }),
    chunk({ sourceType: 'github', sourceUrl: 'https://github.com/a/b/pull/5' }),
  ]);

  assert.match(prompt, /GitHub current file/);
  assert.match(prompt, /GitHub historical commit/);
  assert.match(prompt, /GitHub issue/);
  assert.match(prompt, /GitHub pull request/);
});

test('prompt requires uncertainty, conflict disclosure and no visible citations', () => {
  const prompt = buildAskPrompt('q', [chunk()]);

  assert.match(prompt, /If the evidence is insufficient, reply exactly/);
  assert.match(prompt, /If the evidence conflicts, say so explicitly/);
  assert.match(prompt, /Do not include URLs, source lists, or bracketed citation numbers/);
  assert.match(prompt, /If any item answers it, use that item/);
});

test('citation markers and source footers are removed from displayed answers', () => {
  assert.equal(stripCitationMarkers('Grounded [1] and [2, 3].'), 'Grounded and.');
  assert.equal(renderAnswer('Answer [1]', [{ label: 'x', url: 'https://example.com', references: [1] }]), 'Answer');
});

test('numeric code arrays are not mistaken for citation markers', () => {
  assert.equal(
    stripCitationMarkers('The array is [1, 2] and [3].'),
    'The array is [1, 2] and [3].',
  );
  assert.equal(stripCitationMarkers('Grounded [1] and [2].'), 'Grounded and.');
});

test('answer text never includes source links even when evidence exists', async () => {
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

test('additional uncertainty phrasings are normalised to the standard message', async () => {
  for (const reply of [
    'This is not mentioned in the indexed sources.',
    'I am unable to determine the current version.',
    'The indexed evidence does not specify a deployment IP.',
    'There is insufficient information in the available data.',
  ]) {
    const ask = service([chunk()], new FakeGenerator(reply));
    const result = await ask.ask('question');
    assert.deepEqual(result, {
      ok: false,
      message: NO_EVIDENCE_MESSAGE,
      reason: 'no-evidence',
    });
  }
});

test('bare no-evidence phrases are normalized to the standard message', async () => {
  for (const reply of ['No evidence.', 'There is no evidence.', 'No relevant evidence.']) {
    const ask = service([chunk()], new FakeGenerator(reply));
    assert.deepEqual(await ask.ask('question'), {
      ok: false,
      message: NO_EVIDENCE_MESSAGE,
      reason: 'no-evidence',
    });
  }
});

test('unrelated sentences containing the word evidence are not suppressed', async () => {
  const reply = 'The repository has no evidence files; it only contains documentation.';
  const ask = service([chunk()], new FakeGenerator(reply));
  const result = await ask.ask('question');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.answer, reply);
});

test('speculative answers are not presented as grounded facts', async () => {
  for (const reply of [
    'We can make an educated guess that the version is 7.',
    'I think the project uses Next.js 16.',
    'This is speculation based on the evidence.',
  ]) {
    const ask = service([chunk()], new FakeGenerator(reply));
    const result = await ask.ask('question');
    assert.deepEqual(result, {
      ok: false,
      message: NO_EVIDENCE_MESSAGE,
      reason: 'no-evidence',
    });
  }
});

test('grounded negative, partial and negated-speculation answers are not suppressed', async () => {
  for (const reply of [
    'The repository has no data files; it only contains documentation.',
    'The indexed sources do not mention Slack, but PR #9 says notifications are posted.',
    'I cannot speculate; the README states the project stack.',
  ]) {
    const ask = service([chunk()], new FakeGenerator(reply));
    const result = await ask.ask('question');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.answer, reply);
  }
});

test('a mixed partial answer does not keep a contradictory no-evidence sentence', async () => {
  const reply =
    'The project is a community platform for developers. ' +
    "I couldn't find evidence for what the project is for in the indexed sources.";
  const ask = service([chunk()], new FakeGenerator(reply));
  const result = await ask.ask('question');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.answer, /community platform/);
    assert.doesNotMatch(result.answer, /couldn't find evidence/);
  }
});

test('version claims must be supported by the retrieved evidence', () => {
  const evidence = 'Pluto uses TypeScript@7.0.2 and Node.js v22.1.0. Next.js 16.4.2 is current.';
  // Major-only claims are supported by a matching major component.
  assert.equal(hasUnsupportedVersionClaim('Pluto uses TypeScript 7.', evidence), false);
  assert.equal(hasUnsupportedVersionClaim('Pluto uses Node.js 22.', evidence), false);
  assert.equal(hasUnsupportedVersionClaim('Pluto uses Next.js 16.', evidence), false);
  // Full versions must match exactly.
  assert.equal(hasUnsupportedVersionClaim('Pluto uses Next.js 16.4.2.', evidence), false);
  assert.equal(hasUnsupportedVersionClaim('Pluto uses Next.js 16.4.3.', evidence), true);
  // Different major versions are unsupported.
  assert.equal(hasUnsupportedVersionClaim('Pluto uses TypeScript 4.', evidence), true);
  // Unnamed version claims are checked against versions near "version" or a
  // known technology name.
  assert.equal(hasUnsupportedVersionClaim('The version is 9.', 'The version is 1.0.0.'), true);
  assert.equal(hasUnsupportedVersionClaim('The version is 16.', 'Next.js 16.4.2.'), false);
});

test('contributor questions use the on-demand GitHub contributor lookup', async () => {
  const generator = new FakeGenerator();
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async lookupGitHubContributors(repository) {
      assert.equal(repository, 'Ajiet-DevNation/pluto');
      return [
        { login: 'khushi', contributions: 12 },
        { login: 'pragathi', contributions: 8 },
        { login: null, contributions: 3 },
      ];
    },
  });

  const result = await ask.ask('Who are the contributors of Ajiet-DevNation/pluto?');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.answer, /khushi \(12 contributions\)/);
    assert.match(result.answer, /pragathi \(8 contributions\)/);
    assert.match(result.answer, /Anonymous contributors: 3 contributions/);
    assert.match(result.answer, /may be reused for identical questions/);
    assert.equal(result.displaySources?.length, 1);
    assert.equal(
      result.displaySources?.[0]?.url,
      'https://github.com/Ajiet-DevNation/pluto/graphs/contributors',
    );
  }
  assert.equal(generator.prompts.length, 0);
});

test('anonymous-only contributor results stay honest', () => {
  assert.equal(
    formatContributors('Ajiet-DevNation/pluto', [
      { login: null, contributions: 4 },
      { login: null, contributions: 2 },
    ]),
    'Contributors to Ajiet-DevNation/pluto: anonymous contributors (6 contributions).',
  );
});

test('missing contributor data returns an honest message instead of a guessed name', async () => {
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator: new FakeGenerator('The contributor is Ajiet-DevNation.'),
    githubOrg: 'Ajiet-DevNation',
    async lookupGitHubContributors() {
      return [];
    },
  });

  const result = await ask.ask('Who are the contributors of Ajiet-DevNation/pluto?');
  assert.deepEqual(result, {
    ok: false,
    message:
      'GitHub returned no contributor data for that repository. It may be empty or have no public contributor records.',
    reason: 'contributor-unavailable',
  });
});

test('contributor lookup failures are reported without falling back to retrieval', async () => {
  for (const [kind, message] of [
    ['not-found', "I couldn't find a public GitHub repository with that owner/repo name."],
    ['rate-limited', "GitHub's contributor API is rate-limited right now. Please try again later."],
    [
      'forbidden',
      "GitHub denied access to that repository's contributor data. The repository may be private, restricted, or unavailable to Pluto's read-only GitHub identity.",
    ],
    [
      'not-allowed',
      "I can only look up contributors for public repositories in Pluto's indexed organization corpus; that repository is unknown, private, or could not be verified.",
    ],
    ['unavailable', "I couldn't reach GitHub's contributor API right now. Please try again later."],
  ] as const) {
    const generator = new FakeGenerator('A guessed contributor');
    const ask = new AskService({
      retrieval: {
        async retrieve() {
          throw new Error('retrieval should not run for contributor questions');
        },
      },
      generator,
      githubOrg: 'Ajiet-DevNation',
      async lookupGitHubContributors() {
        throw new ContributorLookupError(kind, 'failure');
      },
    });

    const result = await ask.ask('Who has contributed to Ajiet-DevNation/dn-orbit?');
    assert.deepEqual(result, { ok: false, message, reason: 'contributor-unavailable' });
    assert.equal(generator.prompts.length, 0);
  }
});

test('contributor questions without owner/repo ask for clarification', async () => {
  let lookups = 0;
  const generator = new FakeGenerator('A guessed contributor');
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator,
    githubOrg: 'Ajiet-DevNation',
    async lookupGitHubContributors() {
      lookups += 1;
      return [];
    },
  });

  const result = await ask.ask('Who has contributed to this repository?');
  assert.deepEqual(result, {
    ok: false,
    message: 'Please include the repository as owner/repo so I can look up its contributors.',
    reason: 'contributor-unavailable',
  });
  assert.equal(lookups, 0);
  assert.equal(generator.prompts.length, 0);
});

test('multi-repository contributor questions ask for one repository at a time', async () => {
  let lookups = 0;
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator: new FakeGenerator('A guessed contributor'),
    githubOrg: 'Ajiet-DevNation',
    async lookupGitHubContributors() {
      lookups += 1;
      return [];
    },
  });

  const result = await ask.ask(
    'Who has contributed to Ajiet-DevNation/pluto and Ajiet-DevNation/dn-orbit?',
  );
  assert.deepEqual(result, {
    ok: false,
    message: 'Please ask about one repository at a time so I can look up its contributors.',
    reason: 'contributor-unavailable',
  });
  assert.equal(lookups, 0);
});

test('contributor allowlist preflight rejects unknown or private repositories before lookup', async () => {
  let lookups = 0;
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        throw new Error('retrieval should not run for contributor questions');
      },
    },
    generator: new FakeGenerator('A guessed contributor'),
    githubOrg: 'Ajiet-DevNation',
    async isContributorRepositoryAllowed() {
      return false;
    },
    async lookupGitHubContributors() {
      lookups += 1;
      return [];
    },
  });

  const result = await ask.ask('Who are the contributors of Ajiet-DevNation/core-secrets?');
  assert.deepEqual(result, {
    ok: false,
    message:
      "I can only look up contributors for public repositories in Pluto's indexed organization corpus; that repository is unknown, private, or could not be verified.",
    reason: 'contributor-unavailable',
  });
  assert.equal(lookups, 0);
});

test('ordinary questions never call the GitHub contributor lookup', async () => {
  let lookups = 0;
  const ask = new AskService({
    retrieval: {
      async retrieve() {
        return { ok: true, chunks: [chunk()] };
      },
    },
    generator: new FakeGenerator(),
    githubOrg: 'Ajiet-DevNation',
    async lookupGitHubContributors() {
      lookups += 1;
      return [];
    },
  });

  const result = await ask.ask('What is the project stack?');
  assert.equal(result.ok, true);
  assert.equal(lookups, 0);
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
