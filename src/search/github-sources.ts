/**
 * Index public GitHub repository context as search chunks.
 *
 * L1 stores issues in the `issues` table. README, file, PR, and commit chunks
 * use stable source ids and original GitHub URLs. This path is used by the
 * manual reindex command and can be called by a future scheduled job.
 */

import type { GitHubReader } from '../github/reader';
import type { SourceIndexer } from './types';

export interface GitHubSourceIndexResult {
  repositories: number;
  readmes: number;
  repositoryFiles: number;
  pullRequests: number;
  commits: number;
}

export const MAX_INDEXABLE_GITHUB_FILE_BYTES = 128 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc', '.asciidoc',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.kt', '.kts', '.cs', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.php', '.rb', '.swift', '.sh', '.bash', '.zsh', '.sql', '.html',
  '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.json', '.jsonc',
  '.yaml', '.yml', '.toml', '.xml', '.gradle', '.tf', '.graphql', '.gql',
]);

const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'justfile', 'procfile', 'license', 'notice',
  'cmakelists.txt', '.gitignore', '.gitattributes', '.editorconfig',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'build',
  'coverage', 'dist', 'generated', 'node_modules', 'out', 'target',
  'third_party', 'vendor', '.terraform', '.cache',
]);

const LOCK_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'cargo.lock',
  'poetry.lock', 'composer.lock', 'gemfile.lock', 'bun.lockb',
]);

/** Conservative path filter for public repository text/code ingestion. */
export function isIndexableGitHubFile(path: string, size: number): boolean {
  if (!Number.isInteger(size) || size <= 0 || size > MAX_INDEXABLE_GITHUB_FILE_BYTES) {
    return false;
  }

  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const basename = (segments.at(-1) ?? '').toLowerCase();
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment.toLowerCase()))) {
    return false;
  }
  if (segments.some((segment) =>
    /^\.env(?:\.|$)/i.test(segment) ||
    /(^|[-_.])(secret|secrets|credential|credentials)([-_.]|$)/i.test(segment),
  )) {
    return false;
  }
  if (LOCK_FILES.has(basename) || /^readme(?:\.|$)/i.test(basename)) {
    return false;
  }
  if (/^(?:id_rsa|id_ed25519|authorized_keys)$/i.test(basename)) {
    return false;
  }
  if (/\.(?:pem|key|p12|pfx|p7b|p7c|crt|cer|der|jks|keystore)$/i.test(basename)) {
    return false;
  }

  const dot = basename.lastIndexOf('.');
  const extension = dot >= 0 ? basename.slice(dot) : '';
  return TEXT_BASENAMES.has(basename) || TEXT_EXTENSIONS.has(extension);
}

function looksLikeSensitiveContent(content: string): boolean {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ].some((pattern) => pattern.test(content));
}

function looksLikeText(content: string): boolean {
  if (content.includes('\u0000')) return false;
  const replacements = (content.match(/\uFFFD/g) ?? []).length;
  return replacements / Math.max(content.length, 1) < 0.01;
}

function githubFileUrl(repositoryFullName: string, branch: string, path: string): string {
  const encodedBranch = encodeURIComponent(branch);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repositoryFullName}/blob/${encodedBranch}/${encodedPath}`;
}

export async function indexGithubSearchSources(
  reader: Pick<GitHubReader,
    'listRepos' | 'getReadme' | 'listRepositoryFiles' | 'getFileContent' |
    'listPullRequests' | 'listCommits'>,
  org: string,
  indexer: Pick<SourceIndexer,
    'indexGitHubReadme' | 'indexGitHubFile' | 'indexGitHubPullRequest' | 'indexGitHubCommit'>,
): Promise<GitHubSourceIndexResult> {
  const repos = (await reader.listRepos(org)).filter((repo) => !repo.private);
  let readmes = 0;
  let repositoryFiles = 0;
  let pullRequests = 0;
  let commits = 0;

  for (const repo of repos) {
    const [owner, name] = repo.fullName.split('/');
    if (!owner || !name) {
      continue;
    }

    const readme = await reader.getReadme(owner, name);
    if (readme) {
      await indexer.indexGitHubReadme({
        repositoryFullName: repo.fullName,
        path: readme.path,
        content: readme.content,
        htmlUrl: readme.htmlUrl,
        description: repo.description,
      });
      readmes += 1;
    }

    if (repo.defaultBranch) {
      const tree = await reader.listRepositoryFiles(owner, name, repo.defaultBranch);
      for (const file of tree) {
        if (!isIndexableGitHubFile(file.path, file.size)) continue;
        const content = await reader.getFileContent(owner, name, file.sha);
        if (!looksLikeText(content) || looksLikeSensitiveContent(content)) continue;
        await indexer.indexGitHubFile({
          repositoryFullName: repo.fullName,
          path: file.path,
          content,
          htmlUrl: githubFileUrl(repo.fullName, repo.defaultBranch, file.path),
        });
        repositoryFiles += 1;
      }
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

  return { repositories: repos.length, readmes, repositoryFiles, pullRequests, commits };
}
