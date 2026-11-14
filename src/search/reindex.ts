#!/usr/bin/env tsx
/**
 * Manual full refresh of `search_chunks` from every public GitHub source and the
 * Discord JSON store. The scheduled job runs the same refresh; see corpus-refresh.ts.
 */

import dotenv from 'dotenv';
dotenv.config();

import { refreshGithubCorpus } from './corpus-refresh';
import { createSearchRuntimeFromEnv } from './runtime';
import { EmbeddingDeferredError } from './embedding-errors';

export async function main(): Promise<void> {
  const runtime = createSearchRuntimeFromEnv();
  if (!runtime) {
    throw new Error(
      'Search is not configured; set DATABASE_URL, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to index all public GitHub sources');
  }

  const discordRecords = await runtime.baseStore.listRecords();
  await runtime.syncDiscord(discordRecords);

  const github = await refreshGithubCorpus({
    connectionString: databaseUrl,
    db: runtime.db,
    indexer: runtime.indexer,
  });

  console.log(
    `Search reindex complete: ${github.sources.repositories} public repositories, ` +
      `${github.issuesRefreshed} issues, ${github.sources.readmes} READMEs, ` +
      `${github.sources.repositoryFiles} repository files, ${github.sources.contributors} contributors, ` +
      `${github.sources.pullRequests} PRs, ${github.sources.commits} commits, ` +
      `${discordRecords.length} Discord records`,
  );
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof EmbeddingDeferredError) {
      console.warn(
        `Search reindex paused (${error.reason}); progress is saved and the next run can resume after ${error.resumeAt.toISOString()}.`,
      );
      return;
    }
    console.error('Search reindex failed:', error);
    process.exitCode = 1;
  });
}
