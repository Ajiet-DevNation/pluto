import dotenv from 'dotenv';
dotenv.config();

import { eq } from 'drizzle-orm';
import { resolveGitHubToken } from '../github/app.js';
import { createDb, type Db } from '../db/index.js';
import { createGitHubReader, type GitHubReader } from '../github/reader.js';
import { getGitHubOrg } from '../config.js';
import { issues, repositories } from '../db/schema.js';
import type { SourceIndexer } from '../search/types.js';

export interface IndexedIssue {
  repositoryFullName: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
}

export interface IndexGitHubIssuesOptions {
  reader?: GitHubReader;
  db?: Db;
  org?: string;
  /** Optional search indexing hook; keeps `search_chunks` in sync with `issues`. */
  searchIndexer?: Pick<SourceIndexer, 'indexGitHubIssue'>;
}

export async function indexGitHubIssues(
  connectionString: string,
  options: IndexGitHubIssuesOptions = {}
): Promise<IndexedIssue[]> {
  const reader =
    options.reader ?? createGitHubReader({ token: resolveGitHubToken() });
  const db = options.db ?? createDb(connectionString);
  const GITHUB_ORG = options.org ?? getGitHubOrg();
  const results: IndexedIssue[] = [];

  const repos = await reader.listRepos(GITHUB_ORG);
  const publicRepos = repos.filter((r) => !r.private);

  for (const repo of publicRepos) {
    let existingRepo = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubId, repo.id))
      .limit(1);

    if (existingRepo.length === 0) {
      const [inserted] = await db
        .insert(repositories)
        .values({
          githubId: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          owner: repo.fullName.split('/')[0],
          htmlUrl: repo.htmlUrl,
        })
        .returning();
      existingRepo = [inserted];
    }

    const repoRow = existingRepo[0];

    const repoIssues = await reader.listIssues(repo.fullName.split('/')[0], repo.name);

    for (const issue of repoIssues) {
      if (issue.pullRequest) continue;

      const existing = await db
        .select()
        .from(issues)
        .where(eq(issues.githubId, issue.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(issues)
          .set({
            title: issue.title,
            body: issue.body,
            state: issue.state,
            updatedAt: new Date(issue.updatedAt),
          })
          .where(eq(issues.githubId, issue.id));
      } else {
        await db.insert(issues).values({
          githubId: issue.id,
          repositoryId: repoRow.id,
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          htmlUrl: issue.htmlUrl,
          createdAt: new Date(issue.createdAt),
          updatedAt: new Date(issue.updatedAt),
        });
      }

      if (options.searchIndexer) {
        await options.searchIndexer.indexGitHubIssue({
          repositoryFullName: repo.fullName,
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          htmlUrl: issue.htmlUrl,
        });
      }

      results.push({
        repositoryFullName: repo.fullName,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        htmlUrl: issue.htmlUrl,
      });
    }
  }

  return results;
}

export async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  try {
    const results = await indexGitHubIssues(connectionString);
    console.log(`Indexed ${results.length} issues from ${getGitHubOrg()} public repos`);
  } catch (error) {
    console.error('Indexing failed:', error);
    process.exit(1);
  }
}

// Only run when this file is the entry point, not when imported.
if (typeof require !== 'undefined' && require.main === module) {
  main();
}
