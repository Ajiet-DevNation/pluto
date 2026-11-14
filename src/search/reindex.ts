#!/usr/bin/env tsx
/**
 * Backfill `search_chunks` from sources that were indexed before P2.
 *
 * This is intentionally a manual/operational command: embedding 366 GitHub
 * issues plus the existing Discord records is not something to repeat on every
 * bot startup. The normal incremental paths keep both sides in sync afterwards.
 */

import dotenv from 'dotenv';
dotenv.config();

import { eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { issues, repositories } from '../db/schema';
import { getGitHubOrg } from '../config';
import { resolveGitHubToken } from '../github/app';
import { createGitHubReader } from '../github/reader';
import { indexGithubSearchSources } from './github-sources';
import type { SourceIndexer } from './types';
import { createSearchRuntimeFromEnv } from './runtime';

export async function reindexGithubIssues(
  db: Db,
  indexer: Pick<SourceIndexer, 'indexGitHubIssue'>,
): Promise<number> {
  const rows = await db
    .select({
      repositoryFullName: repositories.fullName,
      issueNumber: issues.number,
      title: issues.title,
      body: issues.body,
      state: issues.state,
      htmlUrl: issues.htmlUrl,
    })
    .from(issues)
    .innerJoin(repositories, eq(issues.repositoryId, repositories.id));

  for (const row of rows) {
    await indexer.indexGitHubIssue(row);
  }
  return rows.length;
}

export async function main(): Promise<void> {
  const runtime = createSearchRuntimeFromEnv();
  if (!runtime) {
    throw new Error(
      'Search is not configured; set DATABASE_URL, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN',
    );
  }

  const issuesIndexed = await reindexGithubIssues(runtime.db, runtime.indexer);
  const discordRecords = await runtime.baseStore.listRecords();
  await runtime.syncDiscord(discordRecords);

  let githubExtras = { repositories: 0, pullRequests: 0, commits: 0 };
  try {
    const reader = createGitHubReader({ token: resolveGitHubToken() });
    githubExtras = await indexGithubSearchSources(
      reader,
      getGitHubOrg(),
      runtime.indexer,
    );
  } catch (error) {
    console.warn(
      'Skipping GitHub PR/commit search indexing (GitHub credential unavailable):',
      error instanceof Error ? error.message : String(error),
    );
  }

  console.log(
    `Search reindex complete: ${issuesIndexed} GitHub issues, ` +
      `${githubExtras.pullRequests} PRs, ${githubExtras.commits} commits, ` +
      `${discordRecords.length} Discord records`,
  );
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error: unknown) => {
    console.error('Search reindex failed:', error);
    process.exitCode = 1;
  });
}
