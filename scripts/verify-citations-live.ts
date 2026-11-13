/**
 * Live check that citation URLs resolve to real GitHub pages.
 *
 * Reads one real commit, one pull request and one issue from the target repo,
 * builds the citation URL for each with the same builders the bot uses, and
 * fetches it. Every request is a GET.
 *
 *   npx tsx scripts/verify-citations-live.ts
 */
import 'dotenv/config';
import { resolveGitHubToken } from '../src/github/app';
import { createGitHubReader } from '../src/github/reader';
import { githubCommitUrl, githubIssueUrl, githubPullRequestUrl } from '../src/citations';

const OWNER = process.env.VERIFY_GITHUB_OWNER ?? 'Ajiet-DevNation';
const REPO = process.env.VERIFY_GITHUB_REPO ?? 'pluto';

interface CheckResult {
  kind: string;
  url: string;
  status: number | string;
  ok: boolean;
}

async function checkUrl(kind: string, url: string): Promise<CheckResult> {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    return { kind, url, status: response.status, ok: response.status === 200 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind, url, status: message, ok: false };
  }
}

async function main(): Promise<void> {
  const reader = createGitHubReader({ token: resolveGitHubToken() });

  const [commit] = await reader.listCommits(OWNER, REPO);
  const pulls = await reader.listPullRequests(OWNER, REPO);

  let issueRepo = REPO;
  let issue = (await reader.listIssues(OWNER, REPO)).find((item) => !item.pullRequest);
  if (!issue) {
    for (const candidate of (await reader.listRepos(OWNER)).slice(0, 10)) {
      const found = (await reader.listIssues(OWNER, candidate.name)).find((item) => !item.pullRequest);
      if (found) {
        issueRepo = candidate.name;
        issue = found;
        break;
      }
    }
  }

  const checks: CheckResult[] = [];

  if (commit) {
    checks.push(await checkUrl('github-commit', githubCommitUrl({ kind: 'github-commit', owner: OWNER, repo: REPO, sha: commit.sha })));
  } else {
    checks.push({ kind: 'github-commit', url: '-', status: 'no commits found', ok: false });
  }

  if (pulls[0]) {
    checks.push(await checkUrl('github-pull-request', githubPullRequestUrl({ kind: 'github-pull-request', owner: OWNER, repo: REPO, number: pulls[0].number })));
  } else {
    checks.push({ kind: 'github-pull-request', url: '-', status: 'no pull requests found', ok: false });
  }

  if (issue) {
    checks.push(await checkUrl('github-issue', githubIssueUrl({ kind: 'github-issue', owner: OWNER, repo: issueRepo, number: issue.number })));
  } else {
    checks.push({ kind: 'github-issue', url: '-', status: 'no plain issues found in the first 10 org repos', ok: false });
  }

  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.kind}: ${check.status} ${check.url}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
