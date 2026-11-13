import { App } from '@octokit/app';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { issues, repositories } from '../db/schema.js';

const GITHUB_ORG = 'Ajiet-DevNation';

export interface IndexedIssue {
  repositoryFullName: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
}

type GitHubOctokit = {
  paginate: (endpoint: any, params?: any) => Promise<any[]>;
  rest: {
    repos: {
      listForOrg: (params: any) => any;
    };
    issues: {
      listForRepo: (params: any) => any;
    };
  };
};

export async function indexGitHubIssues(
  githubApp: App,
  connectionString: string
): Promise<IndexedIssue[]> {
  const db = createDb(connectionString);
  const results: IndexedIssue[] = [];

  let foundOrg = false;

  for await (const { octokit, installation } of githubApp.eachInstallation.iterator()) {
    if (!installation || !installation.account || installation.account.login !== GITHUB_ORG) {
      continue;
    }
    foundOrg = true;

    const gitHubOctokit = octokit as unknown as GitHubOctokit;

    const repos = await gitHubOctokit.paginate(
      gitHubOctokit.rest.repos.listForOrg,
      { org: GITHUB_ORG, type: 'public', per_page: 100 }
    );

    for (const repo of repos) {
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
            fullName: repo.full_name,
            owner: repo.owner.login,
            htmlUrl: repo.html_url,
          })
          .returning();
        existingRepo = [inserted];
      }

      const repoRow = existingRepo[0];

      const repoIssues = await gitHubOctokit.paginate(
        gitHubOctokit.rest.issues.listForRepo,
        { owner: repo.owner.login, repo: repo.name, state: 'all', per_page: 100 }
      );

      for (const issue of repoIssues) {
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
              body: issue.body ?? null,
              state: issue.state,
              updatedAt: new Date(issue.updated_at),
            })
            .where(eq(issues.githubId, issue.id));
        } else {
          await db.insert(issues).values({
            githubId: issue.id,
            repositoryId: repoRow.id,
            number: issue.number,
            title: issue.title,
            body: issue.body ?? null,
            state: issue.state,
            htmlUrl: issue.html_url,
            createdAt: new Date(issue.created_at),
            updatedAt: new Date(issue.updated_at),
          });
        }

        results.push({
          repositoryFullName: repo.full_name,
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          state: issue.state,
          htmlUrl: issue.html_url,
        });
      }
    }
  }

  if (!foundOrg) {
    throw new Error(`No GitHub App installation found for org ${GITHUB_ORG}`);
  }

  return results;
}
