import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexGitHubIssues, main } from '../../src/db/index-github-issues.js';

/* ------------------------------------------------------------------ */
/* Mock reader: returns repos and issues, only exposes read methods   */
/* ------------------------------------------------------------------ */

const MOCK_REPOS = [
  {
    id: 1,
    name: 'pluto',
    fullName: 'Ajiet-DevNation/pluto',
    private: false,
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto',
    description: null,
    defaultBranch: 'main',
  },
  {
    id: 2,
    name: 'private-repo',
    fullName: 'Ajiet-DevNation/private-repo',
    private: true,
    htmlUrl: 'https://github.com/Ajiet-DevNation/private-repo',
    description: null,
    defaultBranch: 'main',
  },
];

const MOCK_ISSUES = [
  {
    id: 10,
    number: 7,
    title: 'Index GitHub issues',
    body: 'Body text',
    state: 'open',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/issues/7',
    author: 'likhith992',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    pullRequest: false,
  },
  {
    id: 20,
    number: 8,
    title: 'PR as issue should be skipped',
    body: 'Body',
    state: 'closed',
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/issues/8',
    author: 'khushikantaria310',
    createdAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T09:22:41Z',
    pullRequest: true,
  },
];

function createMockReader(repos: typeof MOCK_REPOS, issues: typeof MOCK_ISSUES) {
  let listReposCalls = 0;
  let listIssuesCalls: string[] = [];

  return {
    listRepos: async (_org: string) => {
      listReposCalls += 1;
      return repos;
    },
    listIssues: async (_owner: string, repo: string) => {
      listIssuesCalls.push(repo);
      return issues;
    },
    get __calls() {
      return { listReposCalls, listIssuesCalls };
    },
  } as unknown as {
    listRepos: (org: string) => Promise<typeof MOCK_REPOS>;
    listIssues: (owner: string, repo: string) => Promise<typeof MOCK_ISSUES>;
    __calls: { listReposCalls: number; listIssuesCalls: string[] };
  };
}

/* ------------------------------------------------------------------ */
/* Mock db: minimal Drizzle-like chain that records operations        */
/* ------------------------------------------------------------------ */

function createMockDb() {
  const repos: any[] = [];
  const issues: any[] = [];

  const selectResult = {
    from: () => ({
      where: () => ({
        limit: () => [],
      }),
    }),
  };

  const insertResult = {
    values: (data: any) => {
      // Push immediately so both .returning() and non-.returning() callers work
      if (data.name !== undefined) {
        repos.push(data);
      } else {
        issues.push(data);
      }
      return {
        returning: () => [data],
      };
    },
  };

  const updateResult = {
    set: () => ({
      where: () => {
        // no-op for tests
      },
    }),
  };

  return {
    select: () => selectResult,
    insert: () => insertResult,
    update: () => updateResult,
    get __repos() {
      return repos;
    },
    get __issues() {
      return issues;
    },
  } as any;
}

/* ------------------------------------------------------------------ */
/* Happy path                                                         */
/* ------------------------------------------------------------------ */

describe('index-github-issues happy path', () => {
  it('indexes public repos and their issues, skipping private repos and pull requests', async () => {
    const reader = createMockReader(MOCK_REPOS, MOCK_ISSUES);
    const db = createMockDb();
    const searchCalls: Array<{ issueNumber: number }> = [];

    const results = await indexGitHubIssues('postgresql://localhost:5432/pluto', {
      reader,
      db,
      org: 'Ajiet-DevNation',
      searchIndexer: {
        async indexGitHubIssue(issue) {
          searchCalls.push({ issueNumber: issue.issueNumber });
        },
      },
    });

    // Only the public repo (pluto) should be indexed, not private-repo
    assert.equal(reader.__calls.listReposCalls, 1);
    assert.equal(reader.__calls.listIssuesCalls.length, 1);
    assert.equal(reader.__calls.listIssuesCalls[0], 'pluto');

    // Only non-PR issue (#7) should be indexed, not #8 (pull request)
    assert.equal(results.length, 1);
    assert.equal(results[0].repositoryFullName, 'Ajiet-DevNation/pluto');
    assert.equal(results[0].issueNumber, 7);
    assert.equal(results[0].title, 'Index GitHub issues');
    assert.equal(results[0].state, 'open');

    // One repository + one issue inserted
    assert.equal(db.__repos.length, 1);
    assert.equal(db.__issues.length, 1);
    assert.equal(db.__repos[0].fullName, 'Ajiet-DevNation/pluto');
    assert.equal(db.__issues[0].title, 'Index GitHub issues');

    // The optional search hook receives the same non-PR issue.
    assert.deepEqual(searchCalls, [{ issueNumber: 7 }]);
  });
});

/* ------------------------------------------------------------------ */
/* Missing DATABASE_URL                                               */
/* ------------------------------------------------------------------ */

describe('main missing DATABASE_URL', () => {
  it('exits with code 1 when DATABASE_URL is not set', async () => {
    const originalEnv = process.env.DATABASE_URL;
    const originalExit = process.exit;
    let exitCode: number | undefined;

    delete process.env.DATABASE_URL;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    try {
      await assert.rejects(() => main(), /process.exit\(1\)/);
      assert.equal(exitCode, 1);
    } finally {
      process.exit = originalExit;
      if (originalEnv) {
        process.env.DATABASE_URL = originalEnv;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* No write path                                                      */
/* ------------------------------------------------------------------ */

describe('index-github-issues read-only', () => {
  it('only exposes GET methods on the reader (no write path)', async () => {
    const reader = createMockReader(MOCK_REPOS, MOCK_ISSUES);

    // The reader object should only have read methods
    const writeMethods = ['createIssue', 'deleteIssue', 'updateIssue', 'createRepo', 'deleteRepo', 'createComment', 'deleteComment', 'mergePullRequest'];
    for (const method of writeMethods) {
      assert.ok(!(method in reader), `${method} should not exist on the reader`);
    }

    // Calling listRepos and listIssues should work (GET)
    const repos = await reader.listRepos('Ajiet-DevNation');
    assert.equal(repos.length, 2);

    const issues = await reader.listIssues('Ajiet-DevNation', 'pluto');
    assert.equal(issues.length, 2);
  });
});
