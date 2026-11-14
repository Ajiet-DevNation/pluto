import test from 'node:test';
import assert from 'node:assert/strict';
import { indexGithubSearchSources } from '../../src/search/github-sources';

test('indexes PRs and commits from public repositories only', async () => {
  const calls: Array<{ kind: string; repo: string }> = [];
  const reader = {
    async listRepos() {
      return [
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
          name: 'secret',
          fullName: 'Ajiet-DevNation/secret',
          private: true,
          htmlUrl: 'https://github.com/Ajiet-DevNation/secret',
          description: null,
          defaultBranch: 'main',
        },
      ];
    },
    async listPullRequests(owner: string, repo: string) {
      assert.equal(`${owner}/${repo}`, 'Ajiet-DevNation/pluto');
      return [
        {
          id: 1,
          number: 9,
          title: 'P1',
          body: null,
          state: 'closed',
          htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/pull/9',
          author: null,
          createdAt: '2026-11-14T00:00:00Z',
          updatedAt: '2026-11-14T00:00:00Z',
          mergedAt: '2026-11-14T07:25:17Z',
        },
      ];
    },
    async listCommits(owner: string, repo: string) {
      assert.equal(`${owner}/${repo}`, 'Ajiet-DevNation/pluto');
      return [
        {
          sha: '823d07c1a3e',
          message: 'feat(p2): add /ask',
          author: null,
          date: '2026-11-14T08:00:00Z',
          htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/commit/823d07c1a3e',
        },
      ];
    },
  };
  const indexer = {
    async indexGitHubPullRequest(pullRequest: { repositoryFullName: string }) {
      calls.push({ kind: 'pr', repo: pullRequest.repositoryFullName });
    },
    async indexGitHubCommit(commit: { repositoryFullName: string }) {
      calls.push({ kind: 'commit', repo: commit.repositoryFullName });
    },
  };

  const result = await indexGithubSearchSources(
    reader,
    'Ajiet-DevNation',
    indexer,
  );

  assert.deepEqual(result, { repositories: 1, pullRequests: 1, commits: 1 });
  assert.deepEqual(calls, [
    { kind: 'pr', repo: 'Ajiet-DevNation/pluto' },
    { kind: 'commit', repo: 'Ajiet-DevNation/pluto' },
  ]);
});
