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

export class SearchIndexer implements SourceIndexer {
  constructor(
    private readonly searchStore: SearchStore,
    private readonly embeddingClient: EmbeddingClient,
  ) {}

  private async embedChunks(chunks: SearchChunkInput[]): Promise<SearchChunkInput[]> {
    const embedded: SearchChunkInput[] = [];
    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      const vectors = await this.embeddingClient.embed(batch.map((chunk) => chunk.content));
      if (vectors.length !== batch.length) {
        throw new Error('Embedding provider returned the wrong number of vectors');
      }
      batch.forEach((chunk, index) => {
        embedded.push({ ...chunk, embedding: vectors[index] });
      });
    }
    return embedded;
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
    await this.searchStore.upsertChunks(await this.embedChunks(chunks));
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
      contentHash: createHash('sha256').update(chunk.content).digest('hex'),
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
    await this.searchStore.upsertChunks(await this.embedChunks(changed));
  }
}

export class SearchBackedDiscordStore implements DiscordIndexStore, OptOutStore {
  constructor(
    private readonly base: DiscordIndexStore & OptOutStore,
    private readonly indexer: SourceIndexer,
  ) {}

  async upsert(record: DiscordIndexRecord): Promise<void> {
    await this.base.upsert(record);
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
