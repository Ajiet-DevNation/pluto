/**
 * Chunk construction for retrieval.
 *
 * Chunks are the unit of retrieval and citation (search contract §Chunk
 * format). Discord messages are small enough to remain one chunk. Longer
 * documents are split on word/line boundaries with a small overlap.
 */

import type { DiscordIndexRecord } from '../discord/types';
import { createHash } from 'node:crypto';
import type {
  IndexGitHubCommit,
  IndexGitHubContributor,
  IndexGitHubIssue,
  IndexGitHubFile,
  IndexGitHubPullRequest,
  IndexGitHubReadme,
  SearchChunkInput,
} from './types';

export const DEFAULT_CHUNK_CHARS = 2000;
export const DEFAULT_OVERLAP_CHARS = 200;

function lastWhitespaceAtOrBefore(text: string, index: number, floor: number): number {
  for (let cursor = index; cursor > floor; cursor -= 1) {
    if (/\s/.test(text[cursor - 1])) {
      return cursor;
    }
  }
  return index;
}

/**
 * Split on whitespace, never in the middle of a word. Empty input produces no
 * chunks rather than a blank citation.
 */
export function chunkText(
  text: string,
  maxChars: number = DEFAULT_CHUNK_CHARS,
  overlapChars: number = DEFAULT_OVERLAP_CHARS,
): string[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error(`maxChars must be a positive integer, got ${maxChars}`);
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error(
      `overlapChars must be a non-negative integer below maxChars, got ${overlapChars}`,
    );
  }

  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const remaining = normalized.length - start;
    if (remaining <= maxChars) {
      const tail = normalized.slice(start).trim();
      if (tail) {
        chunks.push(tail);
      }
      break;
    }

    const hardEnd = start + maxChars;
    const end = lastWhitespaceAtOrBefore(
      normalized,
      hardEnd,
      start + Math.floor(maxChars * 0.6),
    );
    const piece = normalized.slice(start, end).trim();
    if (piece) {
      chunks.push(piece);
    }

    let nextStart = Math.max(start + 1, end - overlapChars);
    while (nextStart < normalized.length && !/\s/.test(normalized[nextStart - 1])) {
      nextStart += 1;
    }
    start = nextStart;
  }

  return chunks;
}

export function buildDiscordSearchChunk(record: DiscordIndexRecord): SearchChunkInput {
  if (record.authorIsBot) {
    throw new Error(`Refusing to build a search chunk for bot message ${record.messageId}`);
  }
  return {
    sourceType: 'discord',
    sourceId: record.messageId,
    chunkIndex: 0,
    sourceUrl: record.sourceUrl,
    channelId: record.channelId,
    authorId: record.authorId,
    content: record.content.trim(),
    indexedAt: record.indexedAt,
  };
}

function githubChunks(
  sourceId: string,
  sourceUrl: string,
  content: string,
): SearchChunkInput[] {
  return chunkText(content).map((text, chunkIndex) => ({
    sourceType: 'github' as const,
    sourceId,
    chunkIndex,
    sourceUrl,
    channelId: null,
    authorId: null,
    content: text,
  }));
}

export function buildGithubIssueChunks(issue: IndexGitHubIssue): SearchChunkInput[] {
  const content = [`# ${issue.title}`, `State: ${issue.state}`, issue.body ?? '']
    .join('\n\n')
    .trim();
  return githubChunks(
    `${issue.repositoryFullName}#${issue.issueNumber}`,
    issue.htmlUrl,
    content,
  );
}

export function buildGithubPullRequestChunks(
  pullRequest: IndexGitHubPullRequest,
): SearchChunkInput[] {
  const merged = pullRequest.mergedAt ? `Merged: ${pullRequest.mergedAt}` : 'Not merged';
  const content = [
    `# PR #${pullRequest.number}: ${pullRequest.title}`,
    `State: ${pullRequest.state}`,
    merged,
    pullRequest.body ?? '',
  ]
    .join('\n\n')
    .trim();
  return githubChunks(
    `${pullRequest.repositoryFullName}#pr-${pullRequest.number}`,
    pullRequest.htmlUrl,
    content,
  );
}

export function buildGithubCommitChunks(commit: IndexGitHubCommit): SearchChunkInput[] {
  const date = commit.date ? `Date: ${commit.date}\n\n` : '';
  return githubChunks(
    `${commit.repositoryFullName}@${commit.sha}`,
    commit.htmlUrl,
    `${date}${commit.message}`,
  );
}

export function buildGithubReadmeChunks(readme: IndexGitHubReadme): SearchChunkInput[] {
  const description = readme.description?.trim();
  const content = [
    `# ${readme.repositoryFullName} README`,
    `Path: ${readme.path}`,
    description ? `Repository description: ${description}` : '',
    readme.content,
  ].filter(Boolean).join('\n\n');
  return githubChunks(
    `${readme.repositoryFullName}#readme`,
    readme.htmlUrl,
    content,
  );
}

export function buildGithubFileChunks(file: IndexGitHubFile): SearchChunkInput[] {
  const content = [
    `# ${file.repositoryFullName}/${file.path}`,
    `Repository file: ${file.path}`,
    file.content,
  ].join('\n\n');
  return githubChunks(
    `${file.repositoryFullName}#file:${createHash('sha256').update(file.path).digest('hex')}`,
    file.htmlUrl,
    content,
  );
}

export function buildGithubContributorChunks(
  contributor: IndexGitHubContributor,
): SearchChunkInput[] {
  return githubChunks(
    `${contributor.repositoryFullName}#contributor:${contributor.login}`,
    contributor.sourceUrl,
    [
      `Contributor: ${contributor.login}`,
      `Repository: ${contributor.repositoryFullName}`,
      `Contributions: ${contributor.contributions}`,
    ].join('\n'),
  );
}
