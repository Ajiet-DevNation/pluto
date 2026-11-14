/**
 * Grounded `/ask` orchestration.
 *
 * The retrieval gate decides whether the model may be called. If it returns no
 * evidence, `AskService` returns the standard no-evidence message directly and
 * never invokes the generation client.
 */

import { NO_EVIDENCE_MESSAGE, type EvidenceResult } from '../guardrails/evidence';
import { chunkSourceLabel, type RetrievalService } from './retrieval';
import type { AnswerGenerator, ScoredSearchChunk } from './types';
import { AnswerQuotaExceededError, EmbeddingQuotaExceededError } from './embedding-errors';
import { budgetLimitsFromEnv } from './budget';

export const READ_ONLY_MESSAGE =
  'Pluto is read-only. I can answer questions about the indexed GitHub, Discord, Miro, and meeting content, but I cannot change repositories, Discord history, or Miro.';

export const BUSY_MESSAGE =
  'Pluto has used its AI allowance for now and is paused. Please ask again later.';

export type AskFailureReason = 'no-evidence' | 'read-only' | 'quota';

export interface AskSource {
  label: string;
  url: string;
  references: number[];
}

export type AskResult =
  | {
      ok: true;
      answer: string;
      sources: AskSource[];
      chunks: ScoredSearchChunk[];
    }
  | {
      ok: false;
      message: string;
      reason: AskFailureReason;
    };

export interface AskDependencies {
  retrieval: Pick<RetrievalService, 'retrieve'>;
  generator: AnswerGenerator;
  githubOrg?: string;
  resolveRepositoryScope?: (question: string) => Promise<string | undefined>;
  blockedChannelIds?: readonly string[];
  /** Indexed contributor logins/counts for a repository, when available. */
  listContributors?: (
    repositoryFullName: string,
  ) => Promise<Array<{ login: string; contributions: number }>>;
  /** Reserve answering units from the shared daily budget. */
  reserveAnswerBudget?: (units: number) => Promise<Date | null>;
}

const DEFAULT_ANSWER_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_ANSWERS = 200;

function answerCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.ANSWER_CACHE_TTL_MS);
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_ANSWER_CACHE_TTL_MS;
}

/**
 * Requests that would require a write. The bot is read-only, so these are
 * refused before retrieval, which also avoids spending generation quota.
 */
const WRITE_INTENT_PATTERNS = [
  /^\s*(?:please\s+|pls\s+)?(?:edit|change|update|modify|rewrite|delete|remove|rename|move|create|add|commit|push|merge|revert|close|reopen|assign|label)\b/i,
  /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:edit|change|update|modify|rewrite|delete|remove|rename|move|create|add|commit|push|merge|revert|close|reopen)\b/i,
  /\b(?:please|pls)\s+(?:edit|change|update|modify|rewrite|delete|remove|rename|move|create|add|commit|push|merge|revert)\b/i,
  /\b(?:i want|i need|i'd like)\s+(?:you\s+)?to\s+(?:edit|change|update|modify|rewrite|delete|remove|rename|move|create|add|commit|push|merge)\b/i,
];

export function isReadOnlyRequest(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  // "Update me on ...", "change log" and similar read-only phrasings are not writes.
  if (/^(?:update|inform)\s+(?:me|us)\b/i.test(text)) return false;
  return WRITE_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The model sometimes answers "I cannot find evidence ..." instead of returning
 * the standard message. Normalise that so `/ask` always uses one wording.
 */
const NO_EVIDENCE_PATTERNS = [
  /\bi (?:cannot|can't|could not|couldn't|am unable to) (?:find|locate|determine|confirm|answer)\b/i,
  /\bno (?:relevant )?(?:evidence|information|data)\b/i,
  /\bnot (?:enough|sufficient) (?:evidence|information|context)\b/i,
  /\bthe (?:provided |supplied )?evidence (?:does not|doesn't|did not) (?:answer|contain|mention|include|support|cover)\b/i,
  /\bi (?:don't|do not) have (?:any )?(?:evidence|information)\b/i,
  /\bthere is no (?:evidence|information) (?:about|on|for)\b/i,
];

export function isNoEvidenceAnswer(answer: string): boolean {
  const text = answer.trim();
  if (!text) return true;
  return NO_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

const CONTRIBUTOR_QUESTION = /\b(contributors?|maintainers?|who (?:contributed|works? on|worked on|built|wrote|maintains?))\b/i;

export function isContributorQuestion(question: string): boolean {
  return CONTRIBUTOR_QUESTION.test(question);
}

export function formatContributors(
  repositoryFullName: string,
  contributors: ReadonlyArray<{ login: string; contributions: number }>,
): string {
  const top = contributors.slice(0, 25);
  const listed = top
    .map((contributor) =>
      contributor.contributions > 0
        ? `${contributor.login} (${contributor.contributions} contributions)`
        : contributor.login,
    )
    .join(', ');
  const suffix = contributors.length > top.length
    ? `, and ${contributors.length - top.length} more`
    : '';
  return `Contributors to ${repositoryFullName}: ${listed}${suffix}.`;
}

export const MAX_ANSWER_SOURCES = 3;
export const MAX_ANSWER_CHUNKS = 6;
const MAX_CHUNKS_PER_SOURCE = 2;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function channelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/^\/channels\/\d+\/(\d+)\/\d+$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function sourcesFromChunks(
  chunks: readonly ScoredSearchChunk[],
  blockedChannelIds: readonly string[] = [],
  maxSources: number = MAX_ANSWER_SOURCES,
): AskSource[] {
  const blocked = new Set(blockedChannelIds);
  const sources: AskSource[] = [];
  const byUrl = new Map<string, AskSource>();

  for (const [index, chunk] of chunks.entries()) {
    if (!isHttpUrl(chunk.sourceUrl)) {
      continue;
    }
    const channelId = chunk.channelId ?? channelFromUrl(chunk.sourceUrl);
    if (channelId && blocked.has(channelId)) {
      continue;
    }
    const existing = byUrl.get(chunk.sourceUrl);
    if (existing) {
      existing.references.push(index + 1);
      continue;
    }
    if (sources.length >= maxSources) continue;
    const source = {
      label: sourceLabel(chunk.sourceType, chunk.sourceUrl),
      url: chunk.sourceUrl,
      references: [index + 1],
    };
    byUrl.set(chunk.sourceUrl, source);
    sources.push(source);
  }

  return sources;
}

function sourceLabel(sourceType: ScoredSearchChunk['sourceType'], sourceUrl: string): string {
  if (sourceType !== 'github') return chunkSourceLabel(sourceType);
  try {
    const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean);
    if (parts.length < 2) return 'GitHub source';
    const repository = `${parts[0]}/${parts[1]}`;
    if (parts[2] === 'blob' && parts.length > 4) {
      return `${repository}: ${decodeURIComponent(parts.slice(4).join('/'))}`;
    }
    if (parts[2] === 'issues' || parts[2] === 'pull') {
      return `${repository} #${parts[3]}`;
    }
    if (parts[2] === 'commit') return `${repository} @${parts[3]?.slice(0, 7) ?? ''}`;
    return repository;
  } catch {
    return 'GitHub source';
  }
}

export function selectAnswerChunks(
  chunks: readonly ScoredSearchChunk[],
  blockedChannelIds: readonly string[] = [],
  maxSources: number = MAX_ANSWER_SOURCES,
  maxChunks: number = MAX_ANSWER_CHUNKS,
  question = '',
): ScoredSearchChunk[] {
  const blocked = new Set(blockedChannelIds);
  const sourceCounts = new Map<string, number>();
  const selected: ScoredSearchChunk[] = [];
  const candidates = [...chunks];

  if (/\b(stack|dependency|dependencies|version|current|currently|configured|built with)\b/i.test(question)) {
    candidates.sort((left, right) => {
      const freshness = currentFilePriority(right) - currentFilePriority(left);
      return freshness || right.score - left.score;
    });
  }

  for (const chunk of candidates) {
    if (!isHttpUrl(chunk.sourceUrl)) continue;
    const channelId = chunk.channelId ?? channelFromUrl(chunk.sourceUrl);
    if (channelId && blocked.has(channelId)) continue;

    const sourceCount = sourceCounts.get(chunk.sourceUrl) ?? 0;
    if (sourceCount === 0 && sourceCounts.size >= maxSources) continue;
    if (sourceCount >= MAX_CHUNKS_PER_SOURCE) continue;

    selected.push(chunk);
    sourceCounts.set(chunk.sourceUrl, sourceCount + 1);
    if (selected.length >= maxChunks) break;
  }

  return selected;
}

function currentFilePriority(chunk: ScoredSearchChunk): number {
  if (chunk.sourceType !== 'github') return 1;
  try {
    const pathname = new URL(chunk.sourceUrl).pathname;
    if (pathname.includes('/blob/')) return 3;
    if (pathname.includes('/issues/') || pathname.includes('/pull/')) return 2;
    if (pathname.includes('/commit/')) return 0;
  } catch {
    return 1;
  }
  return 1;
}

export function repositoryScopeFromQuestion(
  question: string,
  githubOrg?: string,
  knownRepositoryFullNames: readonly string[] = [],
): string | undefined {
  if (!githubOrg) return undefined;
  const escapedOrg = githubOrg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = question.match(new RegExp(`${escapedOrg}\\/([A-Za-z0-9._-]+)`, 'i'));
  if (match) return `${githubOrg}/${match[1]}`;

  const mentioned = knownRepositoryFullNames.filter((fullName) => {
    if (!fullName.toLowerCase().startsWith(`${githubOrg.toLowerCase()}/`)) return false;
    const repoName = fullName.slice(fullName.indexOf('/') + 1);
    const escapedRepo = repoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9._-])${escapedRepo}($|[^A-Za-z0-9._-])`, 'i').test(question);
  });
  return mentioned.length === 1 ? mentioned[0] : undefined;
}

export function buildAskPrompt(
  question: string,
  chunks: readonly ScoredSearchChunk[],
): string {
  const evidence = chunks
    .map((chunk, index) => {
      const body = chunk.content.length > 1500
        ? `${chunk.content.slice(0, 1500)}…`
        : chunk.content;
      return [
        `[${index + 1}] ${chunkSourceLabel(chunk.sourceType)}`,
        `URL: ${chunk.sourceUrl}`,
        body,
      ].join('\n');
    })
    .join('\n\n');

  return [
    `Question: ${question}`,
    '',
    'Evidence:',
    evidence,
    '',
    'Answer directly using only the evidence above. Do not include URLs, source lists, or bracketed citation numbers.',
    'If the evidence is insufficient, say so explicitly; never fill gaps from outside knowledge.',
    'For current configuration, dependency, or version questions, prefer current default-branch file URLs (/blob/) over historical commit messages.',
    'Treat commit messages as history, not proof of the current state. If only historical evidence exists, say that it cannot confirm the current value.',
  ].join('\n');
}

/**
 * Remove `[n]` markers that do not correspond to a retrieved evidence chunk.
 * Models occasionally invent a citation number; the rendered answer must only
 * reference evidence that actually passed the gate.
 */
export function stripCitationMarkers(answer: string): string {
  return answer
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim();
}

export function renderAnswer(answer: string, _sources: readonly AskSource[] = []): string {
  return stripCitationMarkers(answer);
}

export class AskService {
  private readonly cache = new Map<
    string,
    { at: number; result: Extract<AskResult, { ok: true }> }
  >();

  constructor(private readonly dependencies: AskDependencies) {}

  /** Drop cached answers, e.g. after a reindex changes the corpus. */
  clearCache(): void {
    this.cache.clear();
  }

  async ask(question: string): Promise<AskResult> {
    const query = question.trim();
    if (!query) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE, reason: 'no-evidence' };
    }

    // Read-only boundary: refuse write requests before spending any quota.
    if (isReadOnlyRequest(query)) {
      return { ok: false, message: READ_ONLY_MESSAGE, reason: 'read-only' };
    }

    const repositoryScope = this.dependencies.resolveRepositoryScope
      ? await this.dependencies.resolveRepositoryScope(query)
      : repositoryScopeFromQuestion(query, this.dependencies.githubOrg);

    const cacheKey = `${repositoryScope ?? ''}\u0000${query.toLowerCase().replace(/\s+/g, ' ')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < answerCacheTtlMs()) {
      return cached.result;
    }

    // Contributor questions are answered from the structured contributor index
    // instead of top-N retrieval, which cannot aggregate a full contributor list.
    if (repositoryScope && this.dependencies.listContributors && isContributorQuestion(query)) {
      const contributors = await this.dependencies.listContributors(repositoryScope);
      if (contributors.length > 0) {
        const result: Extract<AskResult, { ok: true }> = {
          ok: true,
          answer: formatContributors(repositoryScope, contributors),
          sources: [],
          chunks: [],
        };
        this.remember(cacheKey, result);
        return result;
      }
    }

    let evidence: EvidenceResult<ScoredSearchChunk>;
    try {
      evidence = await this.dependencies.retrieval.retrieve(query, repositoryScope);
    } catch (error) {
      // Query embedding draws from the same pool as answering.
      if (error instanceof EmbeddingQuotaExceededError) {
        return { ok: false, message: BUSY_MESSAGE, reason: 'quota' };
      }
      throw error;
    }
    if (!evidence.ok) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE, reason: 'no-evidence' };
    }

    const answerChunks = selectAnswerChunks(
      evidence.chunks,
      this.dependencies.blockedChannelIds,
      MAX_ANSWER_SOURCES,
      MAX_ANSWER_CHUNKS,
      query,
    );
    const sources = sourcesFromChunks(answerChunks, this.dependencies.blockedChannelIds);

    if (this.dependencies.reserveAnswerBudget) {
      const resumeAt = await this.dependencies.reserveAnswerBudget(
        budgetLimitsFromEnv().answerPerQuestion,
      );
      if (resumeAt) {
        return { ok: false, message: BUSY_MESSAGE, reason: 'quota' };
      }
    }

    let generated: string;
    try {
      generated = await this.dependencies.generator.generate(buildAskPrompt(query, answerChunks));
    } catch (error) {
      if (error instanceof AnswerQuotaExceededError) {
        return { ok: false, message: BUSY_MESSAGE, reason: 'quota' };
      }
      throw error;
    }

    const answer = stripCitationMarkers(generated);
    if (isNoEvidenceAnswer(answer)) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE, reason: 'no-evidence' };
    }

    const result: Extract<AskResult, { ok: true }> = {
      ok: true,
      answer: renderAnswer(answer, sources),
      sources,
      chunks: answerChunks,
    };
    this.remember(cacheKey, result);
    return result;
  }

  private remember(cacheKey: string, result: Extract<AskResult, { ok: true }>): void {
    if (this.cache.size >= MAX_CACHED_ANSWERS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { at: Date.now(), result });
  }
}
