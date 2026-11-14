/**
 * Runtime composition for P2.
 *
 * Search is optional at the module level (unit tests never need credentials),
 * but if any part of the configuration is present, all required parts must be
 * present. A partially configured search backend must not silently disable
 * `/ask`.
 */

import { createDb, type Db } from '../db/index';
import { repositories } from '../db/schema';
import { getDiscordGuildId, getDiscordOutputChannelId, getGitHubOrg } from '../config';
import type { DiscordIndexRecord } from '../discord/types';
import {
  createDefaultStore,
  type JsonDiscordStore,
} from '../discord/store';
import { evidenceThresholdFromEnv } from '../guardrails/evidence';
import { AskService, repositoryScopeFromQuestion } from './ask';
import {
  CloudflareAnswerGenerator,
  CloudflareEmbeddingClient,
} from './cloudflare';
import { SearchBackedDiscordStore, SearchIndexer } from './indexer';
import { PostgresSearchStore } from './postgres';
import { RetrievalService } from './retrieval';
import { budgetLimitsFromEnv } from './budget';

export const DEFAULT_EVIDENCE_MIN_SCORE = 0.4;

export interface SearchRuntime {
  db: Db;
  store: SearchBackedDiscordStore;
  baseStore: JsonDiscordStore;
  searchStore: PostgresSearchStore;
  indexer: SearchIndexer;
  askService: AskService;
  /** Index records already persisted by P1 before `search_chunks` existed. */
  syncDiscord(records: readonly DiscordIndexRecord[]): Promise<void>;
}

function resolveMinScore(env: NodeJS.ProcessEnv): number {
  if (!env.EVIDENCE_MIN_SCORE?.trim()) {
    return DEFAULT_EVIDENCE_MIN_SCORE;
  }
  return evidenceThresholdFromEnv(env);
}

export function createSearchRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SearchRuntime | null {
  const databaseUrl = env.DATABASE_URL?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_AI_TOKEN?.trim();

  if (!databaseUrl && !accountId && !token) {
    return null;
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required when search credentials are configured');
  }
  if (!accountId || !token) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN are required when search is configured',
    );
  }

  const db = createDb(databaseUrl);
  const searchStore = new PostgresSearchStore(db);
  const embeddingClient = new CloudflareEmbeddingClient({ accountId, token });
  const generator = new CloudflareAnswerGenerator({ accountId, token });
  const baseStore = createDefaultStore(env);
  const indexer = new SearchIndexer(searchStore, embeddingClient);
  const store = new SearchBackedDiscordStore(baseStore, indexer);
  const outputChannelId = getDiscordOutputChannelId();
  const retrieval = new RetrievalService({
    embeddingClient,
    searchStore,
    optOutStore: baseStore,
    guildId: getDiscordGuildId(),
    minScore: resolveMinScore(env),
    blockedChannelIds: [outputChannelId],
  });
  const askService = new AskService({
    retrieval,
    generator,
    githubOrg: getGitHubOrg(),
    async resolveRepositoryScope(question) {
      const knownRepositories = await db.select({ fullName: repositories.fullName }).from(repositories);
      return repositoryScopeFromQuestion(
        question,
        getGitHubOrg(),
        knownRepositories.map((repository) => repository.fullName),
      );
    },
    async listContributors(repositoryFullName) {
      return searchStore.listContributors(repositoryFullName);
    },
    async reserveAnswerBudget(units) {
      return searchStore.reserveAnswerBudget(units, budgetLimitsFromEnv(env).totalDaily);
    },
    blockedChannelIds: [outputChannelId],
  });

  return {
    db,
    store,
    baseStore,
    searchStore,
    indexer,
    askService,
    async syncDiscord(records) {
      await indexer.indexDiscordRecords(records);
    },
  };
}
