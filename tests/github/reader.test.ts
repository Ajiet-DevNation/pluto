import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubReader, GitHubReadError } from '../../src/github/reader';
import { ReadOnlyViolation } from '../../src/guardrails/read-only';

interface RecordedCall {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
}

function fakeFetch(payload: unknown, status = 200) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: headers.get('authorization') ?? undefined,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const REPO = {
  id: 1,
  name: 'pluto',
  full_name: 'Ajiet-DevNation/pluto',
  private: false,
  html_url: 'https://github.com/Ajiet-DevNation/pluto',
  description: 'Read-only Discord knowledge assistant',
  default_branch: 'main',
};

const ISSUE = {
  id: 10,
  number: 7,
  title: 'Index GitHub issues',
  body: 'Body text',
  state: 'open',
  html_url: 'https://github.com/Ajiet-DevNation/pluto/issues/7',
  user: { login: 'likhith992' },
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
};

const PULL = {
  id: 20,
  number: 2,
  title: 'fix(khushi/K1): replace ts-node with tsx',
  body: 'Body',
  state: 'closed',
  html_url: 'https://github.com/Ajiet-DevNation/pluto/pull/2',
  user: { login: 'khushikantaria310' },
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T09:22:41Z',
  merged_at: '2026-11-13T09:22:41Z',
};

const COMMIT = {
  sha: '823d07c1a3e3711048cc7e36c235cf9d2d40526e',
  html_url: 'https://github.com/Ajiet-DevNation/pluto/commit/823d07c',
  commit: {
    message: 'Merge pull request #2',
    author: { name: 'Khushi', date: '2026-11-13T09:22:41Z' },
  },
};

test('getRepo issues a GET with the bearer token', async () => {
  const { impl, calls } = fakeFetch(REPO);
  const reader = createGitHubReader({ token: 'test-token', fetchImpl: impl });

  const repo = await reader.getRepo('Ajiet-DevNation', 'pluto');

  assert.equal(repo.fullName, 'Ajiet-DevNation/pluto');
  assert.equal(repo.private, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.github.com/repos/Ajiet-DevNation/pluto');
  assert.equal(calls[0].authorization, 'Bearer test-token');
});

test('listIssues maps fields and flags pull requests', async () => {
  const { impl, calls } = fakeFetch([
    ISSUE,
    { ...ISSUE, id: 11, number: 8, pull_request: { url: 'x' } },
  ]);
  const reader = createGitHubReader({ token: 't', fetchImpl: impl });

  const issues = await reader.listIssues('Ajiet-DevNation', 'pluto');

  assert.equal(issues.length, 2);
  assert.equal(issues[0].number, 7);
  assert.equal(issues[0].author, 'likhith992');
  assert.equal(issues[0].pullRequest, false);
  assert.equal(issues[1].pullRequest, true);
  assert.match(calls[0].url, /\/issues\?state=all&per_page=100&page=1$/);
});

test('listPullRequests and listCommits map their payloads', async () => {
  const pullFetch = fakeFetch([PULL]);
  const pullReader = createGitHubReader({ token: 't', fetchImpl: pullFetch.impl });
  const pulls = await pullReader.listPullRequests('Ajiet-DevNation', 'pluto');
  assert.equal(pulls[0].mergedAt, '2026-11-13T09:22:41Z');

  const commitFetch = fakeFetch([COMMIT]);
  const commitReader = createGitHubReader({ token: 't', fetchImpl: commitFetch.impl });
  const commits = await commitReader.listCommits('Ajiet-DevNation', 'pluto');
  assert.equal(commits[0].sha, COMMIT.sha);
  assert.equal(commits[0].author, 'Khushi');
});

test('non-2xx responses throw GitHubReadError with the status', async () => {
  const { impl } = fakeFetch({ message: 'Not Found' }, 404);
  const reader = createGitHubReader({ token: 't', fetchImpl: impl });

  await assert.rejects(
    () => reader.getRepo('Ajiet-DevNation', 'missing'),
    (error: unknown) => {
      assert.ok(error instanceof GitHubReadError);
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('rejects a write method through the guard', () => {
  const { impl } = fakeFetch(REPO);
  const reader = createGitHubReader({ token: 't', fetchImpl: impl });

  assert.throws(
    () => (reader as unknown as Record<string, unknown>)['createIssue'],
    ReadOnlyViolation,
  );
  assert.throws(
    () => (reader as unknown as Record<string, unknown>)['deleteRepo'],
    ReadOnlyViolation,
  );
});

test('throws when token and token provider are missing instead of returning empty results', () => {
  assert.throws(() => createGitHubReader({}), GitHubReadError);
  assert.throws(() => createGitHubReader({ token: '' }), GitHubReadError);
});

test('rejects an invalid issue number before any request', async () => {
  const { impl, calls } = fakeFetch(ISSUE);
  const reader = createGitHubReader({ token: 't', fetchImpl: impl });

  await assert.rejects(() => reader.getIssue('o', 'r', 0), GitHubReadError);
  assert.equal(calls.length, 0);
});

test('uses a token provider for every request so expiring App tokens can refresh', async () => {
  const tokens = ['installation-token-1', 'installation-token-2'];
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: headers.get('authorization') ?? undefined,
    });
    return new Response(JSON.stringify(REPO), { status: 200 });
  }) as unknown as typeof fetch;
  const reader = createGitHubReader({
    tokenProvider: async () => tokens.shift() ?? 'fallback-token',
    fetchImpl,
  });

  await reader.getRepo('Ajiet-DevNation', 'pluto');
  await reader.getRepo('Ajiet-DevNation', 'pluto');
  assert.deepEqual(calls.map((call) => call.authorization), [
    'Bearer installation-token-1',
    'Bearer installation-token-2',
  ]);
});

test('listRepos paginates every public organization repository', async () => {
  const calls: string[] = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...REPO,
    id: index + 1,
    name: `repo-${index + 1}`,
    full_name: `Ajiet-DevNation/repo-${index + 1}`,
  }));
  const secondPage = [{ ...REPO, id: 101, name: 'last-repo', full_name: 'Ajiet-DevNation/last-repo' }];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(url.endsWith('page=1') ? firstPage : secondPage), { status: 200 });
  }) as unknown as typeof fetch;
  const reader = createGitHubReader({ token: 'test-token', fetchImpl });

  const repos = await reader.listRepos('Ajiet-DevNation');
  assert.equal(repos.length, 101);
  assert.match(calls[0], /type=public&per_page=100&page=1$/);
  assert.match(calls[1], /type=public&per_page=100&page=2$/);
});

test('paginates issue, pull request, and commit lists', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const page = url.endsWith('page=1') ? 1 : 2;
    const rows = (template: object) => Array.from(
      { length: page === 1 ? 100 : 1 },
      (_, index) => ({ ...template, id: (page - 1) * 100 + index + 1, number: (page - 1) * 100 + index + 1 }),
    );
    const payload = url.includes('/pulls?')
      ? rows(PULL)
      : url.includes('/commits?')
        ? rows(COMMIT)
        : rows(ISSUE);
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;
  const reader = createGitHubReader({ token: 'test-token', fetchImpl });

  assert.equal((await reader.listIssues('Ajiet-DevNation', 'pluto')).length, 101);
  assert.equal((await reader.listPullRequests('Ajiet-DevNation', 'pluto')).length, 101);
  assert.equal((await reader.listCommits('Ajiet-DevNation', 'pluto')).length, 101);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((url) => /page=[12]$/.test(url)));
});

test('decodes repository README and returns null when a README is absent', async () => {
  const payload = {
    path: 'README.md',
    html_url: 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
    encoding: 'base64',
    content: Buffer.from('# Pluto\nKnowledge assistant').toString('base64'),
  };
  const reader = createGitHubReader({ token: 'test-token', fetchImpl: fakeFetch(payload).impl });
  const readme = await reader.getReadme('Ajiet-DevNation', 'pluto');
  assert.equal(readme?.content, '# Pluto\nKnowledge assistant');
  assert.equal(readme?.repositoryFullName, 'Ajiet-DevNation/pluto');

  const noReadme = createGitHubReader({
    token: 'test-token',
    fetchImpl: fakeFetch({ message: 'Not Found' }, 404).impl,
  });
  assert.equal(await noReadme.getReadme('Ajiet-DevNation', 'empty'), null);
});

test('lists repository blobs and refuses a truncated tree rather than indexing partial source', async () => {
  const treeReader = createGitHubReader({
    token: 'test-token',
    fetchImpl: fakeFetch({
      truncated: false,
      tree: [
        { path: 'src/index.ts', type: 'blob', sha: 'blob-1', size: 42 },
        { path: 'src', type: 'tree', sha: 'tree-1' },
      ],
    }).impl,
  });
  assert.deepEqual(await treeReader.listRepositoryFiles('Ajiet-DevNation', 'pluto', 'main'), [
    { path: 'src/index.ts', sha: 'blob-1', size: 42 },
  ]);

  const truncatedReader = createGitHubReader({
    token: 'test-token',
    fetchImpl: fakeFetch({ truncated: true, tree: [] }).impl,
  });
  await assert.rejects(
    () => truncatedReader.listRepositoryFiles('Ajiet-DevNation', 'pluto', 'main'),
    /truncated file tree/,
  );
});

test('decodes blob content through a GET request', async () => {
  const { impl, calls } = fakeFetch({
    encoding: 'base64',
    content: Buffer.from('export const answer = 42;').toString('base64'),
  });
  const reader = createGitHubReader({ token: 'test-token', fetchImpl: impl });
  assert.equal(await reader.getFileContent('Ajiet-DevNation', 'pluto', 'blob-sha'), 'export const answer = 42;');
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/git\/blobs\/blob-sha$/);
});

test('lists paginated contributor identities and contribution counts', async () => {
  const { impl, calls } = fakeFetch([
    { login: 'khushi', contributions: 12, html_url: 'https://github.com/khushi' },
    { login: 'pragathi', contributions: 8, html_url: 'https://github.com/pragathi' },
  ]);
  const reader = createGitHubReader({ token: 'test-token', fetchImpl: impl });
  const contributors = await reader.listContributors('Ajiet-DevNation', 'pluto');
  assert.deepEqual(contributors, [
    { login: 'khushi', contributions: 12, htmlUrl: 'https://github.com/khushi' },
    { login: 'pragathi', contributions: 8, htmlUrl: 'https://github.com/pragathi' },
  ]);
  assert.match(calls[0].url, /\/contributors\?per_page=100&page=1$/);
  assert.equal(calls[0].method, 'GET');
});
