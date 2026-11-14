/**
 * Hybrid retrieval for `/ask`.
 *
 * Order follows the approved search contract:
 * embed → vector top-N + full-text top-N → merge → evidence gate.
 * Channel and opt-out filtering happen before the gate so an excluded chunk can
 * never become evidence or a citation.
 */

import type { OptOutStore } from '../discord/types';
import { gateEvidence, type EvidenceResult } from '../guardrails/evidence';
import type {
  EmbeddingClient,
  ScoredSearchChunk,
  SearchStore,
  SearchSourceType,
} from './types';

export const DEFAULT_CANDIDATE_LIMIT = 20;

export interface RetrievalDependencies {
  embeddingClient: EmbeddingClient;
  searchStore: SearchStore;
  optOutStore?: Pick<OptOutStore, 'isOptedOut'>;
  guildId: string;
  minScore: number;
  blockedChannelIds?: readonly string[];
  candidateLimit?: number;
}

function chunkKey(chunk: ScoredSearchChunk): string {
  return `${chunk.sourceType}:${chunk.sourceId}:${chunk.chunkIndex}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Merge the two candidate lists by chunk identity, keeping the best score.
 * This is deterministic and deliberately does not depend on database order.
 */
export function mergeCandidates(
  vectorCandidates: readonly ScoredSearchChunk[],
  fullTextCandidates: readonly ScoredSearchChunk[],
): ScoredSearchChunk[] {
  const merged = new Map<string, ScoredSearchChunk>();

  for (const candidate of [...vectorCandidates, ...fullTextCandidates]) {
    if (!Number.isFinite(candidate.score)) {
      continue;
    }
    const key = chunkKey(candidate);
    const existing = merged.get(key);
    if (!existing || candidate.score > existing.score) {
      merged.set(key, { ...candidate });
    }
  }

  return [...merged.values()].sort((left, right) => right.score - left.score);
}

function channelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/channels\/\d+\/(\d+)\/\d+$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function filterRetrievedChunks(
  chunks: readonly ScoredSearchChunk[],
  dependencies: Pick<
    RetrievalDependencies,
    'optOutStore' | 'guildId' | 'blockedChannelIds'
  >,
): Promise<ScoredSearchChunk[]> {
  const blocked = new Set(dependencies.blockedChannelIds ?? []);
  const optOutCache = new Map<string, boolean>();
  const filtered: ScoredSearchChunk[] = [];

  for (const chunk of chunks) {
    if (!isHttpUrl(chunk.sourceUrl)) {
      continue;
    }

    const channelId = chunk.channelId ?? channelFromUrl(chunk.sourceUrl);
    if (channelId && blocked.has(channelId)) {
      continue;
    }

    if (
      chunk.sourceType === 'discord' &&
      chunk.authorId &&
      dependencies.optOutStore
    ) {
      let optedOut = optOutCache.get(chunk.authorId);
      if (optedOut === undefined) {
        optedOut = await dependencies.optOutStore.isOptedOut(
          dependencies.guildId,
          chunk.authorId,
        );
        optOutCache.set(chunk.authorId, optedOut);
      }
      if (optedOut) {
        continue;
      }
    }

    filtered.push(chunk);
  }

  return filtered;
}

export class RetrievalService {
  constructor(private readonly dependencies: RetrievalDependencies) {}

  async retrieve(question: string): Promise<EvidenceResult<ScoredSearchChunk>> {
    const query = question.trim();
    if (!query) {
      return gateEvidence([], this.dependencies.minScore);
    }

    const [embedding] = await this.dependencies.embeddingClient.embed([query]);
    if (!embedding) {
      return gateEvidence([], this.dependencies.minScore);
    }

    const limit = this.dependencies.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
    const [vectorCandidates, fullTextCandidates] = await Promise.all([
      this.dependencies.searchStore.vectorSearch(embedding, limit),
      this.dependencies.searchStore.fullTextSearch(query, limit),
    ]);

    const merged = mergeCandidates(vectorCandidates, fullTextCandidates).slice(0, limit);
    const safe = await filterRetrievedChunks(merged, this.dependencies);
    return gateEvidence(safe, this.dependencies.minScore);
  }
}

export function chunkSourceLabel(sourceType: SearchSourceType): string {
  switch (sourceType) {
    case 'github':
      return 'GitHub';
    case 'discord':
      return 'Discord message';
    case 'meeting':
      return 'Meeting transcript';
    case 'miro':
      return 'Miro board';
  }
}
