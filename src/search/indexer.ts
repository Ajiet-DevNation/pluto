/**
 * Write-side search integration.
 *
 * Discord's P1 JSON store remains the source of raw records; this layer keeps
 * `search_chunks` in sync with it. The composite store lets the bot keep its
 * existing interfaces while `/optout` purges both stores.
 */

import { createHash } from 'node:crypto';
import type {
  DiscordIndexRecord,
  DiscordIndexStore,
  OptOutStore,
} from '../discord/types';
import {
  buildDiscordSearchChunk,
  buildGithubCommitChunks,
  buildGithubContributorChunks,
  buildGithubFileChunks,
  buildGithubIssueChunks,
  buildGithubPullRequestChunks,
  buildGithubReadmeChunks,
} from './chunk';
import { EmbeddingDeferredError, EmbeddingQuotaExceededError } from './embedding-errors';
import type {
  EmbeddingClient,
  IndexGitHubCommit,
  IndexGitHubContributor,
  IndexGitHubFile,
  IndexGitHubIssue,
  IndexGitHubPullRequest,
  IndexGitHubReadme,
  SearchChunkInput,
  SearchStore,
  SourceIndexer,
} from './types';

const EMBED_BATCH_SIZE = 32;
const EMBEDDING_CACHE_MODEL = '@cf/baai/bge-base-en-v1.5:768';
const DEFAULT_DAILY_EMBEDDING_BUDGET = 7_000;
const DEFAULT_RUN_EMBEDDING_BUDGET = 1_800;

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function estimatedEmbeddingUnits(text: string): number {
  // Conservative character-based estimate; keep headroom below Cloudflare's
  // 10,000-neuron free daily allowance, which can also be used by other calls.
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 2));
}

async function persistInBatches(
  store: SearchStore,
  chunks: readonly SearchChunkInput[],
): Promise<void> {
  for (let start = 0; start < chunks.length; start += 200) {
    await store.upsertChunks(chunks.slice(start, start + 200));
  }
}

export class SearchIndexer implements SourceIndexer {
  private runEmbeddingUnits = 0;

  constructor(
    private readonly searchStore: SearchStore,
    private readonly embeddingClient: EmbeddingClient,
  ) {}

  beginEmbeddingRun(): void {
    this.runEmbeddingUnits = 0;
  }

  async indexDiscordRecords(records: readonly DiscordIndexRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const chunks = records
      .filter((record) => !record.authorIsBot)
      .map(buildDiscordSearchChunk);
    if (chunks.length === 0) {
      return;
    }
    this.beginEmbeddingRun();
    await this.upsertEmbedded(chunks);
  }

  async removeDiscordAuthor(authorId: string): Promise<number> {
    return this.searchStore.deleteDiscordAuthor(authorId);
  }

  async indexGitHubIssue(issue: IndexGitHubIssue): Promise<void> {
    await this.upsertEmbedded(buildGithubIssueChunks(issue));
  }

  async indexGitHubPullRequest(pullRequest: IndexGitHubPullRequest): Promise<void> {
    await this.upsertEmbedded(buildGithubPullRequestChunks(pullRequest));
  }

  async indexGitHubCommit(commit: IndexGitHubCommit): Promise<void> {
    await this.upsertEmbedded(buildGithubCommitChunks(commit));
  }

  async indexGitHubReadme(readme: IndexGitHubReadme): Promise<void> {
    await this.upsertEmbedded(buildGithubReadmeChunks(readme));
  }

  async indexGitHubFile(file: IndexGitHubFile): Promise<void> {
    await this.indexGitHubFiles([file]);
  }

  async indexGitHubFiles(files: readonly IndexGitHubFile[]): Promise<void> {
    if (files.length === 0) return;
    await this.upsertEmbedded(files.flatMap(buildGithubFileChunks));
  }

  async indexGitHubContributor(contributor: IndexGitHubContributor): Promise<void> {
    await this.upsertEmbedded(buildGithubContributorChunks(contributor));
  }

  private async upsertEmbedded(chunks: SearchChunkInput[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    const hashed = chunks.map((chunk) => ({
      ...chunk,
      contentHash: createHash('sha256')
        .update(`${EMBEDDING_CACHE_MODEL}\0${chunk.content}`)
        .digest('hex'),
    }));
    const unchanged = this.searchStore.unchangedKeys
      ? await this.searchStore.unchangedKeys(
          hashed.map((chunk) => ({
            sourceType: chunk.sourceType,
            sourceId: chunk.sourceId,
            chunkIndex: chunk.chunkIndex,
            contentHash: chunk.contentHash,
          })),
        )
      : new Set<string>();
    const changed = hashed.filter(
      (chunk) => !unchanged.has(
        `${chunk.sourceType}:${chunk.sourceId}:${chunk.chunkIndex}:${chunk.contentHash}`,
      ),
    );
    if (changed.length === 0) {
      return;
    }

    // Reuse vectors across different sources that contain identical text.
    const cached = this.searchStore.cachedEmbeddings
      ? await this.searchStore.cachedEmbeddings([...new Set(changed.map((chunk) => chunk.contentHash))])
      : new Map<string, readonly number[]>();
    const needsEmbedding = new Map<string, typeof changed>();
    const cachedChunks: SearchChunkInput[] = [];
    for (const chunk of changed) {
      const vector = cached.get(chunk.contentHash);
      if (vector) {
        cachedChunks.push({ ...chunk, embedding: vector });
      } else {
        const group = needsEmbedding.get(chunk.contentHash) ?? [];
        group.push(chunk);
        needsEmbedding.set(chunk.contentHash, group);
      }
    }
    if (cachedChunks.length > 0) {
      await persistInBatches(this.searchStore, cachedChunks);
    }

    const groups = [...needsEmbedding.entries()].map(([contentHash, groupedChunks]) => ({
      contentHash,
      chunks: groupedChunks,
      content: groupedChunks[0].content,
      units: estimatedEmbeddingUnits(groupedChunks[0].content),
    }));
    const dailyBudget = positiveIntegerEnv('INDEX_EMBEDDING_DAILY_BUDGET', DEFAULT_DAILY_EMBEDDING_BUDGET);
    const runBudget = positiveIntegerEnv('INDEX_EMBEDDING_RUN_BUDGET', DEFAULT_RUN_EMBEDDING_BUDGET);

    for (let start = 0; start < groups.length;) {
      const remainingRun = runBudget - this.runEmbeddingUnits;
      if (remainingRun <= 0) {
        throw new EmbeddingDeferredError(
          `Per-run embedding budget reached (${runBudget} estimated units); saved progress is reusable on the next run.`,
          new Date(Date.now() + 6 * 60 * 60 * 1000),
          'run-budget',
        );
      }

      const batch = [] as typeof groups;
      let batchUnits = 0;
      while (start < groups.length && batch.length < EMBED_BATCH_SIZE) {
        const next = groups[start];
        if (batch.length > 0 && batchUnits + next.units > remainingRun) break;
        if (batch.length === 0 && next.units > remainingRun) {
          throw new EmbeddingDeferredError(
            'The next content item exceeds the remaining per-run embedding budget.',
            new Date(Date.now() + 6 * 60 * 60 * 1000),
            'run-budget',
          );
        }
        batch.push(next);
        batchUnits += next.units;
        start += 1;
      }

      const resumeAt = this.searchStore.reserveEmbeddingBudget
        ? await this.searchStore.reserveEmbeddingBudget(batchUnits, dailyBudget)
        : null;
      if (resumeAt) {
        throw new EmbeddingDeferredError(
          `Daily embedding budget reached; saved progress will resume after ${resumeAt.toISOString()}.`,
          resumeAt,
          'daily-budget',
        );
      }

      let vectors: number[][];
      try {
        vectors = await this.embeddingClient.embed(batch.map((group) => group.content));
      } catch (error) {
        if (error instanceof EmbeddingQuotaExceededError) {
          await this.searchStore.deferEmbeddingUntil?.(error.resumeAt);
          throw new EmbeddingDeferredError(error.message, error.resumeAt, 'provider-quota');
        }
        throw error;
      }
      if (vectors.length !== batch.length) {
        throw new Error('Embedding provider returned the wrong number of vectors');
      }

      this.runEmbeddingUnits += batchUnits;
      const embeddedChunks = batch.flatMap((group, index) =>
        group.chunks.map((chunk) => ({ ...chunk, embedding: vectors[index] })),
      );
      // Persist each successful batch immediately. These rows are the durable
      // checkpoint: subsequent runs skip matching source/hash pairs and reuse
      // vectors for duplicate content elsewhere in the corpus.
      await persistInBatches(this.searchStore, embeddedChunks);
    }
  }
}

export class SearchBackedDiscordStore implements DiscordIndexStore, OptOutStore {
  constructor(
    private readonly base: DiscordIndexStore & OptOutStore,
    private readonly indexer: SourceIndexer,
  ) {}

  async upsert(record: DiscordIndexRecord): Promise<void> {
    await this.base.upsert(record);
    this.indexer.beginEmbeddingRun?.();
    await this.indexer.indexDiscordRecords([record]);
  }

  async removeAuthor(guildId: string, authorId: string): Promise<number> {
    const removed = await this.base.removeAuthor(guildId, authorId);
    await this.indexer.removeDiscordAuthor(authorId);
    return removed;
  }

  async getLastMessageId(guildId: string, channelId: string): Promise<string | null> {
    return this.base.getLastMessageId(guildId, channelId);
  }

  async setLastMessageId(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    return this.base.setLastMessageId(guildId, channelId, messageId);
  }

  async listRecords(): Promise<DiscordIndexRecord[]> {
    return this.base.listRecords();
  }

  async isOptedOut(guildId: string, userId: string): Promise<boolean> {
    return this.base.isOptedOut(guildId, userId);
  }

  async optOut(guildId: string, userId: string, optedOutBy: string): Promise<void> {
    return this.base.optOut(guildId, userId, optedOutBy);
  }

  async optIn(guildId: string, userId: string): Promise<void> {
    return this.base.optIn(guildId, userId);
  }
}
