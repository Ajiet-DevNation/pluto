/**
 * Index public GitHub pull requests and commits as search chunks.
 *
 * L1 stores issues in the `issues` table. PRs and commits have no table of
 * their own, but P2 can still cite them because `search_chunks` only needs a
 * stable source id and URL. This path is used by the manual reindex command and
 * can be called by a future scheduled job.
 */

import type { GitHubReader } from '../github/reader';
import type { SourceIndexer } from './types';

export interface GitHubSourceIndexResult {
  repositories: number;
  pullRequests: number;
  commits: number;
}

export async function indexGithubSearchSources(
  reader: Pick<GitHubReader, 'listRepos' | 'listPullRequests' | 'listCommits'>,
  org: string,
  indexer: Pick<SourceIndexer, 'indexGitHubPullRequest' | 'indexGitHubCommit'>,
): Promise<GitHubSourceIndexResult> {
  const repos = (await reader.listRepos(org)).filter((repo) => !repo.private);
  let pullRequests = 0;
  let commits = 0;

  for (const repo of repos) {
    const [owner, name] = repo.fullName.split('/');
    if (!owner || !name) {
      continue;
    }

    for (const pullRequest of await reader.listPullRequests(owner, name)) {
      await indexer.indexGitHubPullRequest({
        repositoryFullName: repo.fullName,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        state: pullRequest.state,
        htmlUrl: pullRequest.htmlUrl,
        mergedAt: pullRequest.mergedAt,
      });
      pullRequests += 1;
    }

    for (const commit of await reader.listCommits(owner, name)) {
      await indexer.indexGitHubCommit({
        repositoryFullName: repo.fullName,
        sha: commit.sha,
        message: commit.message,
        htmlUrl: commit.htmlUrl,
        date: commit.date,
      });
      commits += 1;
    }
  }

  return { repositories: repos.length, pullRequests, commits };
}
