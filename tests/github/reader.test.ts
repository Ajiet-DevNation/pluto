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
  assert.match(calls[0].url, /\/issues\?state=all&per_page=100$/);
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

test('throws when the token is missing instead of returning empty results', () => {
  assert.throws(() => createGitHubReader({ token: '' }), GitHubReadError);
});

test('rejects an invalid issue number before any request', async () => {
  const { impl, calls } = fakeFetch(ISSUE);
  const reader = createGitHubReader({ token: 't', fetchImpl: impl });

  await assert.rejects(() => reader.getIssue('o', 'r', 0), GitHubReadError);
  assert.equal(calls.length, 0);
});
