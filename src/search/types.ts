/**
 * Search/indexing shared types.
 *
 * These types keep the database, embedding provider and source indexers
 * independent. The `/ask` retrieval/answer contracts were removed from active
 * v1 on 2026-11-18.
 */

export const SEARCH_SOURCE_TYPES = ['github', 'discord', 'meeting', 'miro'] as const;

export type SearchSourceType = (typeof SEARCH_SOURCE_TYPES)[number];

export interface SearchChunkInput {
  sourceType: SearchSourceType;
  sourceId: string;
  chunkIndex: number;
  sourceUrl: string;
  channelId?: string | null;
  authorId?: string | null;
  content: string;
  contentHash?: string;
  embedding?: readonly number[] | null;
  indexedAt?: string;
}

export interface ChunkIdentity {
  sourceType: SearchSourceType;
  sourceId: string;
  chunkIndex: number;
  contentHash: string;
}

export interface SearchStore {
  upsertChunks(chunks: readonly SearchChunkInput[]): Promise<void>;
  /** Returns the subset of identities already stored with the same content hash. */
  unchangedKeys?(identities: readonly ChunkIdentity[]): Promise<Set<string>>;
  /** Finds stored vectors by content hash, allowing duplicate content to reuse embeddings. */
  cachedEmbeddings?(contentHashes: readonly string[]): Promise<Map<string, readonly number[]>>;
  /** Atomically reserves estimated daily embedding units; returns a retry time when deferred. */
  reserveEmbeddingBudget?(units: number, dailyLimit: number): Promise<Date | null>;
  /** Persist provider quota deferral so other workers stop sending embedding requests. */
  deferEmbeddingUntil?(resumeAt: Date): Promise<void>;
  /** Remove every indexed chunk for a Discord author. Returns rows affected. */
  deleteDiscordAuthor(authorId: string): Promise<number>;
}

export interface EmbeddingClient {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface IndexGitHubIssue {
  repositoryFullName: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
}

export interface IndexGitHubPullRequest {
  repositoryFullName: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  mergedAt?: string | null;
}

export interface IndexGitHubCommit {
  repositoryFullName: string;
  sha: string;
  message: string;
  htmlUrl: string;
  date?: string | null;
}

export interface IndexGitHubReadme {
  repositoryFullName: string;
  path: string;
  content: string;
  htmlUrl: string;
  description?: string | null;
}

export interface IndexGitHubFile {
  repositoryFullName: string;
  path: string;
  content: string;
  htmlUrl: string;
}

export interface IndexGitHubContributor {
  repositoryFullName: string;
  login: string;
  contributions: number;
  sourceUrl: string;
}

export interface SourceIndexer {
  beginEmbeddingRun?(): void;
  indexDiscordRecords(
    records: readonly import('../discord/types').DiscordIndexRecord[],
  ): Promise<void>;
  removeDiscordAuthor(authorId: string): Promise<number>;
  indexGitHubIssue(issue: IndexGitHubIssue): Promise<void>;
  indexGitHubPullRequest(pullRequest: IndexGitHubPullRequest): Promise<void>;
  indexGitHubCommit(commit: IndexGitHubCommit): Promise<void>;
  indexGitHubReadme(readme: IndexGitHubReadme): Promise<void>;
  indexGitHubFile(file: IndexGitHubFile): Promise<void>;
  indexGitHubFiles(files: readonly IndexGitHubFile[]): Promise<void>;
  indexGitHubContributor(contributor: IndexGitHubContributor): Promise<void>;
}
