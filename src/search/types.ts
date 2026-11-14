/**
 * Search/retrieval shared types.
 *
 * The search contract is the source of truth for chunk shape, embedding model,
 * and retrieval order. These types keep the database, embedding provider and
 * `/ask` handler independently testable.
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

export interface ScoredSearchChunk extends SearchChunkInput {
  id?: string;
  /** Higher is more relevant. Vector scores are cosine similarity. */
  score: number;
}

export interface SearchStore {
  upsertChunks(chunks: readonly SearchChunkInput[]): Promise<void>;
  /** Returns the subset of identities already stored with the same content hash. */
  unchangedKeys?(identities: readonly ChunkIdentity[]): Promise<Set<string>>;
  /** Finds stored vectors by content hash, allowing duplicate content to reuse embeddings. */
  cachedEmbeddings?(contentHashes: readonly string[]): Promise<Map<string, readonly number[]>>;
  /** Atomically reserves estimated daily embedding units; returns a retry time when deferred. */
  reserveEmbeddingBudget?(units: number, dailyLimit: number): Promise<Date | null>;
  /** Reserves answering units from the shared daily ledger; returns a retry time when refused. */
  reserveAnswerBudget?(units: number, dailyLimit: number): Promise<Date | null>;
  /** Contributor logins and contribution counts already indexed for a repository. */
  listContributors?(
    repositoryFullName: string,
  ): Promise<Array<{ login: string; contributions: number }>>;
  /** Persist provider quota deferral so other workers stop sending embedding requests. */
  deferEmbeddingUntil?(resumeAt: Date): Promise<void>;
  vectorSearch(
    embedding: readonly number[],
    limit: number,
    repositoryFullName?: string,
  ): Promise<ScoredSearchChunk[]>;
  fullTextSearch(
    query: string,
    limit: number,
    repositoryFullName?: string,
  ): Promise<ScoredSearchChunk[]>;
  /** Remove every indexed chunk for a Discord author. Returns rows affected. */
  deleteDiscordAuthor(authorId: string): Promise<number>;
}

export interface EmbeddingClient {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface AnswerGenerator {
  generate(prompt: string): Promise<string>;
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
