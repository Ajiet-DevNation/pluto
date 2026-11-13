import { requirePattern, requirePositiveInt } from './validate';
import type {
  GitHubCommitCitation,
  GitHubIssueCitation,
  GitHubPullRequestCitation,
} from './types';

const OWNER_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function repoBase(owner: string, repo: string): string {
  const safeOwner = requirePattern(owner, OWNER_PATTERN, 'owner');
  const safeRepo = requirePattern(repo, OWNER_PATTERN, 'repo');
  return `https://github.com/${safeOwner}/${safeRepo}`;
}

export function githubCommitUrl(citation: GitHubCommitCitation): string {
  const sha = requirePattern(citation.sha, SHA_PATTERN, 'commit sha');
  return `${repoBase(citation.owner, citation.repo)}/commit/${sha}`;
}

export function githubPullRequestUrl(citation: GitHubPullRequestCitation): string {
  const number = requirePositiveInt(citation.number, 'pull request number');
  return `${repoBase(citation.owner, citation.repo)}/pull/${number}`;
}

export function githubIssueUrl(citation: GitHubIssueCitation): string {
  const number = requirePositiveInt(citation.number, 'issue number');
  return `${repoBase(citation.owner, citation.repo)}/issues/${number}`;
}
