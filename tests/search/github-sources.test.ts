import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexGithubSearchSources,
  isIndexableGitHubFile,
  MAX_INDEXABLE_GITHUB_FILE_BYTES,
} from '../../src/search/github-sources';

test('repository file policy admits relevant text/source and rejects sensitive, generated, and oversized files', () => {
  assert.equal(isIndexableGitHubFile('src/search.ts', 100), true);
  assert.equal(isIndexableGitHubFile('docs/guide.md', 100), true);
  assert.equal(isIndexableGitHubFile('.env.production', 100), false);
  assert.equal(isIndexableGitHubFile('config/private.pem', 100), false);
  assert.equal(isIndexableGitHubFile('node_modules/pkg/index.js', 100), false);
  assert.equal(isIndexableGitHubFile('dist/bundle.js', 100), false);
  assert.equal(isIndexableGitHubFile('large.ts', MAX_INDEXABLE_GITHUB_FILE_BYTES + 1), false);
  assert.equal(isIndexableGitHubFile('image.png', 100), false);
});

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
    async getReadme(owner: string, repo: string) {
      assert.equal(`${owner}/${repo}`, 'Ajiet-DevNation/pluto');
      return {
        repositoryFullName: 'Ajiet-DevNation/pluto',
        path: 'README.md',
        htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/blob/main/README.md',
        content: '# Pluto',
      };
    },
    async listRepositoryFiles(owner: string, repo: string, ref: string) {
      assert.equal(`${owner}/${repo}@${ref}`, 'Ajiet-DevNation/pluto@main');
      return [{ path: 'src/index.ts', sha: 'blob-sha', size: 20 }];
    },
    async getFileContent(_owner: string, _repo: string, sha: string) {
      assert.equal(sha, 'blob-sha');
      return 'export const answer = 42;';
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
    async indexGitHubReadme(readme: { repositoryFullName: string }) {
      calls.push({ kind: 'readme', repo: readme.repositoryFullName });
    },
    async indexGitHubFile(file: { repositoryFullName: string }) {
      calls.push({ kind: 'file', repo: file.repositoryFullName });
    },
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

  assert.deepEqual(result, { repositories: 1, readmes: 1, repositoryFiles: 1, pullRequests: 1, commits: 1 });
  assert.deepEqual(calls, [
    { kind: 'readme', repo: 'Ajiet-DevNation/pluto' },
    { kind: 'file', repo: 'Ajiet-DevNation/pluto' },
    { kind: 'pr', repo: 'Ajiet-DevNation/pluto' },
    { kind: 'commit', repo: 'Ajiet-DevNation/pluto' },
  ]);
});

test('indexes eligible text files but skips credential-like file paths and content', async () => {
  const indexed: string[] = [];
  const reader = {
    async listRepos() {
      return [{
        id: 3,
        name: 'sample',
        fullName: 'Ajiet-DevNation/sample',
        private: false,
        htmlUrl: 'https://github.com/Ajiet-DevNation/sample',
        description: null,
        defaultBranch: 'main',
      }];
    },
    async getReadme() { return null; },
    async listRepositoryFiles() {
      return [
        { path: 'src/app.ts', sha: 'safe', size: 10 },
        { path: 'config/keys.ts', sha: 'credential', size: 20 },
        { path: 'src/.env.production', sha: 'env', size: 15 },
      ];
    },
    async getFileContent(_owner: string, _repo: string, sha: string) {
      if (sha === 'credential') {
        const fakeToken = ['ghp', '_', 'A'.repeat(24)].join('');
        return `const token = "${fakeToken}";`;
      }
      if (sha === 'env') return 'CLOUDFLARE_TOKEN=hidden';
      return 'export const value = 1;';
    },
    async listPullRequests() { return []; },
    async listCommits() { return []; },
  };
  const indexer = {
    async indexGitHubReadme() {},
    async indexGitHubFile(file: { path: string }) { indexed.push(file.path); },
    async indexGitHubPullRequest() {},
    async indexGitHubCommit() {},
  };

  const result = await indexGithubSearchSources(reader, 'Ajiet-DevNation', indexer);
  assert.equal(result.repositoryFiles, 1);
  assert.deepEqual(indexed, ['src/app.ts']);
});
