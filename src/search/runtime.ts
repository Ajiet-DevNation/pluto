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
import { createGitHubTokenProvider } from '../github/app';
import { createGitHubReader, GitHubReadError, type GitHubContributor, type GitHubReader } from '../github/reader';
import { AskService, repositoryScopesFromQuestion } from './ask';
import { ContributorLookupError } from './contributors';
import {
  CloudflareAnswerGenerator,
  CloudflareEmbeddingClient,
} from './cloudflare';
import { SearchBackedDiscordStore, SearchIndexer } from './indexer';
import { PostgresSearchStore, ivfflatProbesFromEnv } from './postgres';
import { RetrievalService } from './retrieval';
import { budgetLimitsFromEnv } from './budget';

export const DEFAULT_EVIDENCE_MIN_SCORE = 0.4;

export interface SearchRuntime {
  db: Db;
  store: SearchBackedDiscordStore;
  baseStore: JsonDiscordStore;
  searchStore: PostgresSearchStore;
  indexer: SearchIndexer;
  /** Retained for a future ASK-01 re-enable; no `/ask` command is registered. */
  askService: AskService;
  /** Index records already persisted by P1 before `search_chunks` existed. */
  syncDiscord(records: readonly DiscordIndexRecord[]): Promise<void>;
}

export type ContributorRepositoryDecision =
  | { ok: true }
  | {
      ok: false;
      reason: 'not-allowed' | 'not-found' | 'rate-limited' | 'forbidden' | 'unavailable';
    };

/**
 * Contributor lookups must target a repository already known from the public
 * index AND still report `private === false`. A successful contributors call is
 * never treated as proof of visibility.
 */
export async function verifyContributorRepository(
  repositoryFullName: string,
  knownRepositoryFullNames: readonly string[],
  reader: Pick<GitHubReader, 'getRepo'>,
): Promise<ContributorRepositoryDecision> {
  const normalized = repositoryFullName.trim().toLowerCase();
  const parts = repositoryFullName.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'not-allowed' };
  }
  const known = knownRepositoryFullNames.some(
    (fullName) => fullName.trim().toLowerCase() === normalized,
  );
  if (!known) {
    return { ok: false, reason: 'not-allowed' };
  }

  try {
    const repository = await reader.getRepo(parts[0], parts[1]);
    return repository.private === false
      ? { ok: true }
      : { ok: false, reason: 'not-allowed' };
  } catch (error) {
    if (error instanceof GitHubReadError) {
      if (error.status === 404) return { ok: false, reason: 'not-found' };
      if (error.status === 429 || error.rateLimited) return { ok: false, reason: 'rate-limited' };
      if (error.status === 403) return { ok: false, reason: 'forbidden' };
    }
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Validate the public repository allowlist and visibility before the
 * contributors endpoint is called. Unknown repositories are rejected without
 * even a GitHub metadata request; known private/unverified repositories are
 * rejected after the `private === false` check.
 */
export async function lookupContributorsForRepository(
  repositoryFullName: string,
  knownRepositoryFullNames: readonly string[],
  reader: Pick<GitHubReader, 'getRepo' | 'listContributors'>,
): Promise<GitHubContributor[]> {
  const decision = await verifyContributorRepository(
    repositoryFullName,
    knownRepositoryFullNames,
    reader,
  );
  if (!decision.ok) {
    throw new ContributorLookupError(
      decision.reason,
      `Contributor lookup refused for ${repositoryFullName}: ${decision.reason}`,
    );
  }

  const [owner, repo] = repositoryFullName.split('/');
  if (!owner || !repo) {
    throw new ContributorLookupError('not-allowed', `Invalid repository: ${repositoryFullName}`);
  }
  return reader.listContributors(owner, repo);
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
  const searchStore = new PostgresSearchStore(db, {
    ivfflatProbes: ivfflatProbesFromEnv(env),
    organizationName: getGitHubOrg(),
  });
  const embeddingClient = new CloudflareEmbeddingClient({ accountId, token });
  const generator = new CloudflareAnswerGenerator({ accountId, token });
  const baseStore = createDefaultStore(env);
  const indexer = new SearchIndexer(searchStore, embeddingClient);
  const store = new SearchBackedDiscordStore(baseStore, indexer);
  const outputChannelId = getDiscordOutputChannelId();
  // Built on first contributor question only. Ordinary /ask questions must not
  // touch GitHub, and missing GitHub credentials must not disable search.
  let contributorReader: GitHubReader | undefined;
  function githubReader(): GitHubReader {
    contributorReader ??= createGitHubReader({
      tokenProvider: createGitHubTokenProvider(env),
      userAgent: 'pluto-readonly-ask',
    });
    return contributorReader;
  }
  const retrieval = new RetrievalService({
    embeddingClient,
    searchStore,
    optOutStore: baseStore,
    guildId: getDiscordGuildId(),
    minScore: resolveMinScore(env),
    blockedChannelIds: [outputChannelId],
    organizationName: getGitHubOrg(),
  });
  const askService = new AskService({
    retrieval,
    generator,
    githubOrg: getGitHubOrg(),
    async resolveRepositoryScopes(question) {
      const knownRepositories = await db.select({ fullName: repositories.fullName }).from(repositories);
      return repositoryScopesFromQuestion(
        question,
        getGitHubOrg(),
        knownRepositories.map((repository) => repository.fullName),
      );
    },
    async isContributorRepositoryAllowed(repositoryFullName) {
      const knownRepositories = await db
        .select({ fullName: repositories.fullName })
        .from(repositories);
      const normalized = repositoryFullName.trim().toLowerCase();
      return knownRepositories.some(
        (repository) => repository.fullName.trim().toLowerCase() === normalized,
      );
    },
    async lookupGitHubContributors(repositoryFullName) {
      const knownRepositories = await db
        .select({ fullName: repositories.fullName })
        .from(repositories);
      try {
        const contributors = await lookupContributorsForRepository(
          repositoryFullName,
          knownRepositories.map((repository) => repository.fullName),
          githubReader(),
        );
        return contributors.map((contributor) => ({
          login: contributor.login,
          contributions: contributor.contributions,
        }));
      } catch (error) {
        if (error instanceof ContributorLookupError) {
          throw error;
        }
        if (error instanceof GitHubReadError) {
          if (error.status === 404) {
            throw new ContributorLookupError('not-found', error.message);
          }
          if (error.status === 429 || error.rateLimited) {
            throw new ContributorLookupError('rate-limited', error.message);
          }
          if (error.status === 403) {
            throw new ContributorLookupError('forbidden', error.message);
          }
        }
        throw new ContributorLookupError('unavailable', error instanceof Error ? error.message : String(error));
      }
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
