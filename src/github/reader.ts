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

export interface GitHubReadme {
  repositoryFullName: string;
  path: string;
  htmlUrl: string;
  content: string;
}

export interface GitHubRepositoryFile {
  path: string;
  sha: string;
  size: number;
}

export interface GitHubReader {
  listRepos(org: string): Promise<GitHubRepo[]>;
  getRepo(owner: string, repo: string): Promise<GitHubRepo>;
  listIssues(owner: string, repo: string): Promise<GitHubIssue[]>;
  getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue>;
  listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest>;
  listCommits(owner: string, repo: string): Promise<GitHubCommit[]>;
  getReadme(owner: string, repo: string): Promise<GitHubReadme | null>;
  listRepositoryFiles(owner: string, repo: string, ref: string): Promise<GitHubRepositoryFile[]>;
  getFileContent(owner: string, repo: string, sha: string): Promise<string>;
}

export const GITHUB_READ_METHODS = [
  'listRepos',
  'getRepo',
  'listIssues',
  'getIssue',
  'listPullRequests',
  'getPullRequest',
  'listCommits',
  'getReadme',
  'listRepositoryFiles',
  'getFileContent',
] as const;

export interface GitHubReaderOptions {
  /** Static PAT for compatibility and tests. */
  token?: string;
  /** Async token source for expiring GitHub App installation tokens. */
  tokenProvider?: () => Promise<string>;
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

interface RawReadme {
  path: string;
  html_url: string;
  encoding: string;
  content: string;
}

interface RawTree {
  truncated: boolean;
  tree: Array<{ path: string; type: string; sha: string; size?: number }>;
}

interface RawBlob {
  encoding: string;
  content: string;
}

const PER_PAGE = 100;
const MAX_PAGES = 1_000;

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
  if (!options.token && !options.tokenProvider) {
    throw new GitHubReadError('A GitHub token or token provider is required');
  }

  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'pluto-readonly';
  const apiVersion = options.apiVersion ?? '2022-11-28';

  /**
   * The only outbound call in this module. Method is fixed to GET.
   */
  async function getJson<T>(path: string): Promise<T> {
    const token = options.tokenProvider ? await options.tokenProvider() : options.token;
    if (!token?.trim()) {
      throw new GitHubReadError('GitHub token provider returned an empty token');
    }
    const response = await doFetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
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

  async function getAllPages<T>(pathForPage: (page: number) => string): Promise<T[]> {
    const results: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await getJson<T[]>(pathForPage(page));
      if (!Array.isArray(batch)) {
        throw new GitHubReadError('GitHub list endpoint returned a non-array response');
      }
      results.push(...batch);
      if (batch.length < PER_PAGE) {
        return results;
      }
    }
    throw new GitHubReadError(`GitHub pagination exceeded the ${MAX_PAGES}-page safety limit`);
  }

  function repoPath(owner: string, repo: string): string {
    return `/repos/${encodeSegment(owner, 'owner')}/${encodeSegment(repo, 'repo')}`;
  }

  const reader: GitHubReader = {
    async listRepos(org: string): Promise<GitHubRepo[]> {
      const owner = encodeSegment(org, 'org');
      const raw = await getAllPages<RawRepo>(
        (page) => `/orgs/${owner}/repos?type=public&per_page=${PER_PAGE}&page=${page}`,
      );
      return raw.map(toRepo);
    },

    async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
      return toRepo(await getJson<RawRepo>(repoPath(owner, repo)));
    },

    async listIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
      const path = `${repoPath(owner, repo)}/issues?state=all&per_page=${PER_PAGE}`;
      const raw = await getAllPages<RawIssue>((page) => `${path}&page=${page}`);
      return raw.map(toIssue);
    },

    async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue> {
      if (!Number.isInteger(number) || number <= 0) {
        throw new GitHubReadError(`Invalid issue number: ${number}`);
      }
      const path = `${repoPath(owner, repo)}/issues/${number}`;
      return toIssue(await getJson<RawIssue>(path));
    },

    async listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]> {
      const path = `${repoPath(owner, repo)}/pulls?state=all&per_page=${PER_PAGE}`;
      const raw = await getAllPages<RawPullRequest>((page) => `${path}&page=${page}`);
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
      const path = `${repoPath(owner, repo)}/pulls/${number}`;
      return toPullRequest(await getJson<RawPullRequest>(path));
    },

    async listCommits(owner: string, repo: string): Promise<GitHubCommit[]> {
      const path = `${repoPath(owner, repo)}/commits?per_page=${PER_PAGE}`;
      const raw = await getAllPages<RawCommit>((page) => `${path}&page=${page}`);
      return raw.map(toCommit);
    },

    async getReadme(owner: string, repo: string): Promise<GitHubReadme | null> {
      try {
        const raw = await getJson<RawReadme>(`${repoPath(owner, repo)}/readme`);
        if (raw.encoding !== 'base64') {
          throw new GitHubReadError(`Unsupported README encoding: ${raw.encoding}`);
        }
        return {
          repositoryFullName: `${owner}/${repo}`,
          path: raw.path,
          htmlUrl: raw.html_url,
          content: Buffer.from(raw.content, 'base64').toString('utf8'),
        };
      } catch (error) {
        if (error instanceof GitHubReadError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async listRepositoryFiles(
      owner: string,
      repo: string,
      ref: string,
    ): Promise<GitHubRepositoryFile[]> {
      const encodedRef = encodeSegment(ref, 'ref');
      const tree = await getJson<RawTree>(`${repoPath(owner, repo)}/git/trees/${encodedRef}?recursive=1`);
      if (tree.truncated) {
        throw new GitHubReadError(
          `GitHub returned a truncated file tree for ${owner}/${repo}; refusing a partial repository index`,
        );
      }
      return tree.tree
        .filter((entry) => entry.type === 'blob' && typeof entry.size === 'number')
        .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size as number }));
    },

    async getFileContent(owner: string, repo: string, sha: string): Promise<string> {
      const raw = await getJson<RawBlob>(`${repoPath(owner, repo)}/git/blobs/${encodeSegment(sha, 'blob sha')}`);
      if (raw.encoding !== 'base64') {
        throw new GitHubReadError(`Unsupported GitHub blob encoding: ${raw.encoding}`);
      }
      return Buffer.from(raw.content, 'base64').toString('utf8');
    },
  };

  return createReadOnlyGuard<GitHubReader>(GITHUB_READ_METHODS, {
    context: 'GitHubReader',
  })(reader);
}
