/**
 * One full pass over every public Ajiet-DevNation source used by `/ask`.
 *
 * Shared by the manual `npm run index:search` command and the scheduled job, so
 * both produce identical coverage. Unchanged chunks are skipped by content hash.
 */

import type { Db } from '../db/index';
import { indexGitHubIssues } from '../db/index-github-issues';
import { getGitHubOrg } from '../config';
import { createGitHubTokenProvider } from '../github/app';
import { createGitHubReader } from '../github/reader';
import { indexGithubSearchSources, type GitHubSourceIndexResult } from './github-sources';
import type { SourceIndexer } from './types';

export interface CorpusRefreshResult {
  issuesRefreshed: number;
  sources: GitHubSourceIndexResult;
}

export interface CorpusRefreshOptions {
  connectionString: string;
  db: Db;
  indexer: SourceIndexer;
  org?: string;
}

export async function refreshGithubCorpus(
  options: CorpusRefreshOptions,
): Promise<CorpusRefreshResult> {
  const org = options.org ?? getGitHubOrg();
  const reader = createGitHubReader({ tokenProvider: createGitHubTokenProvider() });

  const issues = await indexGitHubIssues(options.connectionString, {
    reader,
    db: options.db,
    org,
    searchIndexer: options.indexer,
  });
  const sources = await indexGithubSearchSources(reader, org, options.indexer);

  return { issuesRefreshed: issues.length, sources };
}
