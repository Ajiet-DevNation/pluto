/**
 * Indexing runtime composition.
 *
 * Search indexing is optional at the module level (unit tests never need
 * credentials), but if any part of the configuration is present, all required
 * parts must be present. The `/ask` answer runtime was removed from active v1
 * on 2026-11-18; this runtime now composes indexing and Discord persistence
 * only.
 */

import { createDb, type Db } from '../db/index';
import type { DiscordIndexRecord } from '../discord/types';
import {
  createDefaultStore,
  type JsonDiscordStore,
} from '../discord/store';
import { CloudflareEmbeddingClient } from './cloudflare';
import { SearchBackedDiscordStore, SearchIndexer } from './indexer';
import { PostgresSearchStore } from './postgres';

export interface SearchRuntime {
  db: Db;
  store: SearchBackedDiscordStore;
  baseStore: JsonDiscordStore;
  searchStore: PostgresSearchStore;
  indexer: SearchIndexer;
  /** Index records already persisted by P1 before `search_chunks` existed. */
  syncDiscord(records: readonly DiscordIndexRecord[]): Promise<void>;
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
    throw new Error('DATABASE_URL is required when indexing credentials are configured');
  }
  if (!accountId || !token) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN are required when indexing is configured',
    );
  }

  const db = createDb(databaseUrl);
  const searchStore = new PostgresSearchStore(db);
  const embeddingClient = new CloudflareEmbeddingClient({ accountId, token });
  const baseStore = createDefaultStore(env);
  const indexer = new SearchIndexer(searchStore, embeddingClient);
  const store = new SearchBackedDiscordStore(baseStore, indexer);

  return {
    db,
    store,
    baseStore,
    searchStore,
    indexer,
    async syncDiscord(records) {
      await indexer.indexDiscordRecords(records);
    },
  };
}
