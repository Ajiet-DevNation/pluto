import { createReadOnlyGuard } from '../guardrails/read-only';

/**
 * Read-only GitHub client.
 *
 * The request helper takes no HTTP method parameter: GET is hardcoded, so a
 * write cannot be expressed through this module. The returned reader is wrapped
 * in the read-only guard, so accessing any method outside the allowlist throws
 * ReadOnlyViolation.
 */

export class GitHubReadError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubReadError';
    this.status = status;
  }
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string | null;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  pullRequest: boolean;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string | null;
  date: string | null;
  htmlUrl: string;
}

export interface GitHubReader {
  listRepos(org: string): Promise<GitHubRepo[]>;
  getRepo(owner: string, repo: string): Promise<GitHubRepo>;
  listIssues(owner: string, repo: string): Promise<GitHubIssue[]>;
  getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue>;
  listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest>;
  listCommits(owner: string, repo: string): Promise<GitHubCommit[]>;
}

export const GITHUB_READ_METHODS = [
  'listRepos',
  'getRepo',
  'listIssues',
  'getIssue',
  'listPullRequests',
  'getPullRequest',
  'listCommits',
] as const;

export interface GitHubReaderOptions {
  token: string;
  /** Override for tests. Defaults to https://api.github.com */
  baseUrl?: string;
  /** Inject for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  userAgent?: string;
  apiVersion?: string;
}

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch?: string | null;
}

interface RawIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface RawPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

function toRepo(raw: RawRepo): GitHubRepo {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private,
    htmlUrl: raw.html_url,
    description: raw.description,
    defaultBranch: raw.default_branch ?? null,
  };
}

function toIssue(raw: RawIssue): GitHubIssue {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    htmlUrl: raw.html_url,
    author: raw.user?.login ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    pullRequest: raw.pull_request !== undefined,
  };
}

function toPullRequest(raw: RawPullRequest): GitHubPullRequest {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    htmlUrl: raw.html_url,
    author: raw.user?.login ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    mergedAt: raw.merged_at,
  };
}

function toCommit(raw: RawCommit): GitHubCommit {
  return {
    sha: raw.sha,
    message: raw.commit.message,
    author: raw.commit.author?.name ?? null,
    date: raw.commit.author?.date ?? null,
    htmlUrl: raw.html_url,
  };
}

function encodeSegment(value: string, label: string): string {
  if (!value || !value.trim()) {
    throw new GitHubReadError(`Invalid ${label}: value is empty`);
  }
  return encodeURIComponent(value.trim());
}

export function createGitHubReader(options: GitHubReaderOptions): GitHubReader {
  if (!options.token) {
    throw new GitHubReadError('GitHub token is required');
  }

  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'pluto-readonly';
  const apiVersion = options.apiVersion ?? '2022-11-28';

  /**
   * The only outbound call in this module. Method is fixed to GET.
   */
  async function getJson<T>(path: string): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': apiVersion,
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      throw new GitHubReadError(
        `GitHub read failed: ${path} returned ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  const reader: GitHubReader = {
    async listRepos(org: string): Promise<GitHubRepo[]> {
      const owner = encodeSegment(org, 'org');
      const raw = await getJson<RawRepo[]>(`/orgs/${owner}/repos?per_page=100`);
      return raw.map(toRepo);
    },

    async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
      const path = `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}`;
      return toRepo(await getJson<RawRepo>(path));
    },

    async listIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
      const path =
        `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}` +
        '/issues?state=all&per_page=100';
      const raw = await getJson<RawIssue[]>(path);
      return raw.map(toIssue);
    },

    async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue> {
      if (!Number.isInteger(number) || number <= 0) {
        throw new GitHubReadError(`Invalid issue number: ${number}`);
      }
      const path =
        `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}` +
        `/issues/${number}`;
      return toIssue(await getJson<RawIssue>(path));
    },

    async listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]> {
      const path =
        `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}` +
        '/pulls?state=all&per_page=100';
      const raw = await getJson<RawPullRequest[]>(path);
      return raw.map(toPullRequest);
    },

    async getPullRequest(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitHubPullRequest> {
      if (!Number.isInteger(number) || number <= 0) {
        throw new GitHubReadError(`Invalid pull request number: ${number}`);
      }
      const path =
        `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}` +
        `/pulls/${number}`;
      return toPullRequest(await getJson<RawPullRequest>(path));
    },

    async listCommits(owner: string, repo: string): Promise<GitHubCommit[]> {
      const path =
        `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}` +
        '/commits?per_page=100';
      const raw = await getJson<RawCommit[]>(path);
      return raw.map(toCommit);
    },
  };

  return createReadOnlyGuard<GitHubReader>(GITHUB_READ_METHODS, {
    context: 'GitHubReader',
  })(reader);
}
