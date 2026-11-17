/**
 * Grounded `/ask` orchestration.
 *
 * The retrieval gate decides whether the model may be called. If it returns no
 * evidence, `AskService` returns the standard no-evidence message directly and
 * never invokes the generation client.
 */

import { NO_EVIDENCE_MESSAGE, type EvidenceResult } from '../guardrails/evidence';
import { chunkSourceLabel, type RetrievalService } from './retrieval';
import {
  CONTRIBUTOR_CACHE_NOTE,
  ContributorLookupError,
  contributorsPageUrl,
  formatContributors,
  type ContributorCandidate,
} from './contributors';
import {
  ASK_PROMPT_INSTRUCTIONS,
  stripInternalPromptLeakage,
} from './prompt';
import type { AnswerGenerator, ScoredSearchChunk } from './types';
import { AnswerQuotaExceededError, EmbeddingQuotaExceededError } from './embedding-errors';
import { budgetLimitsFromEnv } from './budget';

export const READ_ONLY_MESSAGE =
  'Pluto is read-only. I can answer questions about the indexed GitHub, Discord, Miro, and meeting content, but I cannot change repositories, Discord history, or Miro.';

export const BUSY_MESSAGE =
  'Pluto has used its AI allowance for now and is paused. Please ask again later.';

export type AskFailureReason =
  | 'no-evidence'
  | 'read-only'
  | 'quota'
  | 'contributor-unavailable';

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
      /** The subset rendered in Discord; internal `sources` stays complete. */
      displaySources?: AskSource[];
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
  resolveRepositoryScopes?: (question: string) => Promise<string[]>;
  blockedChannelIds?: readonly string[];
  /** Preflight against the known public-repository allowlist before lookup. */
  isContributorRepositoryAllowed?: (
    repositoryFullName: string,
  ) => Promise<boolean>;
  /** On-demand read-only GitHub contributor lookup. */
  lookupGitHubContributors?: (
    repositoryFullName: string,
  ) => Promise<ContributorCandidate[]>;
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
  /\bi (?:cannot|can't|could not|couldn't|am unable to|am not able to) (?:find|locate|determine|confirm|answer|verify)\b/i,
  /^(?:there is |there's )?(?:no|not any) (?:relevant )?evidence(?:\s+(?:about|on|for|that|regarding|in)\b[^.!?]*)?[.!?]?\s*$/i,
  /\b(?:there is )?no (?:relevant )?(?:evidence|information) (?:about|on|for|that|regarding)\b/i,
  /\bnot (?:enough|sufficient) (?:evidence|information|context|detail)\b/i,
  /\binsufficient (?:evidence|information|context|detail)\b/i,
  /\bthe (?:provided |supplied |indexed |available )?evidence (?:does not|doesn't|did not|do not|don't) (?:answer|contain|mention|include|support|cover|specify)\b/i,
  /\b(?:the )?(?:indexed|available) (?:sources?|information|data) (?:does not|doesn't|do not|don't) (?:contain|include|mention|support|answer|cover|specify)\b/i,
  /\bi (?:don't|do not) have (?:any )?(?:evidence|information)\b/i,
  /\b(?:not|never) (?:mentioned|documented|specified|available) in (?:the )?(?:indexed|available|provided) (?:sources?|evidence|information)\b/i,
  /\bunable to (?:answer|determine|confirm|verify)\b/i,
];

const CONTRAST = /\b(?:but|however|although|yet|while)\b/i;

export function isNoEvidenceAnswer(answer: string): boolean {
  const text = answer.trim();
  if (!text) return true;
  if (!NO_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  // Do not collapse a partially grounded answer that contrasts a gap with a
  // supported fact ("...does not mention Slack, but PR #9 says...").
  return !CONTRAST.test(text);
}

/**
 * Answers that admit they are guessing are not grounded answers. Returning the
 * standard no-evidence message is safer than presenting an inference as a
 * project fact.
 */
const SPECULATIVE_ANSWER_PATTERNS = [
  /\beducated guess\b/i,
  /\b(?:i|we) (?:think|guess|assume|believe|suppose)\b/i,
  /\b(?:this|that|it) (?:is|was) (?:speculation|guesswork|a guess)\b/i,
  /\bmade[- ]up\b/i,
  /\bmy guess\b/i,
];

export function isSpeculativeAnswer(answer: string): boolean {
  return SPECULATIVE_ANSWER_PATTERNS.some((pattern) => pattern.test(answer));
}

/**
 * Version numbers are the easiest thing for a small model to invent. This
 * check compares named version claims against versions that appear near the
 * same technology in the retrieved evidence:
 *
 * - a dotted claim must match a complete evidence version;
 * - a major-only claim (16) is accepted when it matches the major component of
 *   an evidence version (16.4.2);
 * - a differently-major claim (4 vs 7) is rejected.
 *
 * It also checks unnamed "version is X" claims against versions near the word
 * "version" or a known technology name. This is a heuristic version check, not
 * a general factual-entailment verifier.
 */
const NAMED_VERSION_CLAIM = /\b(typescript|node(?:\.js)?|next(?:\.js)?|react|python|postgres(?:ql)?|pgvector|express|discord(?:\.js)?|drizzle(?:-orm)?|tsx|ts-node)\s*(?:version\s*)?v?(\d+(?:\.\d+){0,2})\b/gi;
const GENERIC_VERSION_CLAIM = /\bversion\s*(?:is|:)?\s*v?(\d+(?:\.\d+){0,2})\b/gi;

const KNOWN_TECHNOLOGY_PATTERNS = [
  'typescript',
  'node(?:\\.js)?',
  'next(?:\\.js)?',
  'react',
  'python',
  'postgres(?:ql)?',
  'pgvector',
  'express',
  'discord(?:\\.js)?',
  'drizzle(?:-orm)?',
  'tsx',
  'ts-node',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function evidenceNamePattern(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('node')) return 'node(?:\\.js)?';
  if (lower.startsWith('next')) return 'next(?:\\.js)?';
  if (lower.startsWith('postgres')) return 'postgres(?:ql)?';
  if (lower.startsWith('discord')) return 'discord(?:\\.js)?';
  if (lower.startsWith('drizzle')) return 'drizzle(?:-orm)?';
  return escapeRegExp(name);
}

/** Version tokens that appear within 40 characters of a context name. */
function versionsNear(evidence: string, contextPattern: string): string[] {
  const version = String.raw`(?<![\d.])v?(\d+(?:\.\d+){0,2})(?![\d])(?!\.\d)`;
  const versions = new Set<string>();
  const after = new RegExp(`${contextPattern}[^\\n]{0,40}?${version}`, 'gi');
  const before = new RegExp(`${version}[^\\n]{0,40}?${contextPattern}`, 'gi');
  for (const match of evidence.matchAll(after)) {
    if (match[1]) versions.add(match[1]);
  }
  for (const match of evidence.matchAll(before)) {
    if (match[1]) versions.add(match[1]);
  }
  return [...versions];
}

function majorOf(version: string): string {
  return version.split('.')[0] ?? version;
}

function evidenceSupportsClaim(claim: string, evidenceVersions: readonly string[]): boolean {
  if (claim.includes('.')) {
    return evidenceVersions.some((version) => version === claim);
  }
  return evidenceVersions.some((version) => majorOf(version) === claim);
}

export function hasUnsupportedVersionClaim(answer: string, evidence: string): boolean {
  const namedClaims = [...answer.matchAll(NAMED_VERSION_CLAIM)]
    .map((match) => ({ name: match[1], version: match[2] }))
    .filter((claim): claim is { name: string; version: string } =>
      Boolean(claim.name && claim.version));

  for (const claim of namedClaims) {
    const evidenceVersions = versionsNear(evidence, evidenceNamePattern(claim.name));
    if (!evidenceSupportsClaim(claim.version, evidenceVersions)) {
      return true;
    }
  }

  const contextVersions = new Set<string>();
  for (const context of ['version', ...KNOWN_TECHNOLOGY_PATTERNS]) {
    for (const version of versionsNear(evidence, context)) {
      contextVersions.add(version);
    }
  }

  for (const match of answer.matchAll(GENERIC_VERSION_CLAIM)) {
    const version = match[1];
    if (!version) continue;
    if (!evidenceSupportsClaim(version, [...contextVersions])) {
      return true;
    }
  }

  return false;
}

const CONTRIBUTOR_QUESTION = /\b(contributors?|maintainers?|who (?:has |have )?(?:contributed|contributes|works? on|worked on|built|wrote|maintains?)|who's (?:contributed|contributing))\b/i;

export function isContributorQuestion(question: string): boolean {
  return CONTRIBUTOR_QUESTION.test(question);
}

export const MAX_ANSWER_SOURCES = 3;
export const MAX_ANSWER_CHUNKS = 6;
export const MAX_ANSWER_SOURCES_REPOSITORY_LIST = 6;
/** Upper bound for a comparison; beyond this the prompt discloses omissions. */
export const MAX_REPOSITORY_LIST_SOURCES = 12;
const MAX_CHUNKS_PER_SOURCE = 2;

export const CONTRIBUTOR_SCOPE_MESSAGE =
  'Please include the repository as owner/repo so I can look up its contributors.';
export const CONTRIBUTOR_MULTIPLE_MESSAGE =
  'Please ask about one repository at a time so I can look up its contributors.';
export const CONTRIBUTOR_NOT_ALLOWED_MESSAGE =
  "I can only look up contributors for public repositories in Pluto's indexed organization corpus; that repository is unknown, private, or could not be verified.";
export const CONTRIBUTOR_EMPTY_MESSAGE =
  'GitHub returned no contributor data for that repository. It may be empty or have no public contributor records.';
export const CONTRIBUTOR_NOT_FOUND_MESSAGE =
  "I couldn't find a public GitHub repository with that owner/repo name.";
export const CONTRIBUTOR_RATE_LIMIT_MESSAGE =
  "GitHub's contributor API is rate-limited right now. Please try again later.";
export const CONTRIBUTOR_FORBIDDEN_MESSAGE =
  "GitHub denied access to that repository's contributor data. The repository may be private, restricted, or unavailable to Pluto's read-only GitHub identity.";
export const CONTRIBUTOR_UNAVAILABLE_MESSAGE =
  "I couldn't reach GitHub's contributor API right now. Please try again later.";

/**
 * Questions that ask for a set of repositories need evidence from more than
 * three sources; otherwise the first two repositories crowd out the rest.
 */
export function isRepositoryListQuestion(question: string): boolean {
  return /\b(?:which|what|list|name|identify)\b[\s\S]*\b(?:repositories|repos)\b/i.test(
    question,
  );
}

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

/**
 * One visible source by default. Direct PR/issue questions select the exact
 * source; general questions prefer README/documentation; comparisons select one
 * source per represented repository. Internal `sources` stay complete.
 */
export function selectDisplaySources(
  question: string,
  chunks: readonly ScoredSearchChunk[],
  sources: readonly AskSource[],
  repositoryScopes: readonly string[] = [],
): AskSource[] {
  if (sources.length === 0) return [];
  const documentationSources = sources.filter((source) =>
    chunks.some((chunk) => chunk.sourceUrl === source.url && isAuthoritativeDocumentationChunk(chunk)),
  );

  const pull = question.match(/\b(?:pull request|pr)\s*#?(\d+)\b/i);
  if (pull) {
    const exact = sources.find((source) =>
      new RegExp(`/pull/${pull[1]}(?:[/?#]|$)`).test(source.url),
    );
    if (exact) return [exact];
  }
  const issue = question.match(/\b(?:issue|bug)\s*#?(\d+)\b/i);
  if (issue) {
    const exact = sources.find((source) =>
      new RegExp(`/issues/${issue[1]}(?:[/?#]|$)`).test(source.url),
    );
    if (exact) return [exact];
  }

  if (repositoryScopes.length > 1) {
    const selected: AskSource[] = [];
    for (const scope of repositoryScopes) {
      const repositorySources = sources.filter(
        (source) => githubRepositoryFromUrl(source.url)?.toLowerCase() === scope.toLowerCase(),
      );
      if (repositorySources.length === 0) continue;
      const preferred = repositorySources.find((source) => documentationSources.includes(source))
        ?? repositorySources[0];
      if (!selected.some((source) => source.url === preferred.url)) selected.push(preferred);
    }
    if (selected.length > 0) return selected;
  }

  if (documentationSources.length > 0) return [documentationSources[0]];
  return [sources[0]];
}

function isAuthoritativeDocumentationChunk(chunk: ScoredSearchChunk): boolean {
  if (chunk.sourceType !== 'github') return false;
  try {
    const pathname = new URL(chunk.sourceUrl).pathname;
    return pathname.includes('/blob/') &&
      (/readme/i.test(pathname) || /\.(?:md|mdx|rst|adoc|txt)$/i.test(pathname) || /\/docs?\//i.test(pathname));
  } catch {
    return false;
  }
}

export function isComparisonQuestion(
  question: string,
  repositoryScopes: readonly string[] = [],
): boolean {
  return repositoryScopes.length > 1 ||
    /\b(?:compare|comparison|versus|vs\.?|difference|differ|across|both)\b/i.test(question);
}

export function isRepositoryPurposeQuestion(question: string): boolean {
  // A question about a specific PR, issue, bug, or commit is not a repository
  // overview. The old pattern only excluded numbered references, so "this pull
  // request" was incorrectly sent through the repository-purpose filter.
  if (/\b(?:pull request|pr|issue|bug|commit)\b/i.test(question)) {
    return false;
  }

  const repositoryContext =
    /\b(?:repositor(?:y|ies)|repo|codebase)\b/i.test(question) ||
    /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/.test(question);
  const purposeWording =
    /\b(?:purpose|overall goal)\b/i.test(question) ||
    /\b(?:what (?:is|was)|what's)\b[\s\S]*\b(?:for|about)\b/i.test(question);

  if (purposeWording) {
    return true;
  }

  // A generic "overview" question is not necessarily a repository overview.
  return repositoryContext && /\boverview\b/i.test(question);
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

export interface AnswerChunkSelectionOptions {
  /** Take one chunk per GitHub repository before filling remaining slots. */
  preferDistinctGithubRepositories?: boolean;
  /** Prefer current documentation over historical commits/PRs. */
  comparison?: boolean;
  /** Only authoritative README/documentation evidence may support purpose claims. */
  purpose?: boolean;
}

function githubRepositoryFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

export function selectAnswerChunks(
  chunks: readonly ScoredSearchChunk[],
  blockedChannelIds: readonly string[] = [],
  maxSources: number = MAX_ANSWER_SOURCES,
  maxChunks: number = MAX_ANSWER_CHUNKS,
  question = '',
  options: AnswerChunkSelectionOptions = {},
): ScoredSearchChunk[] {
  const blocked = new Set(blockedChannelIds);
  const sourceCounts = new Map<string, number>();
  const seenRepositories = new Set<string>();
  const selected: ScoredSearchChunk[] = [];
  let candidates = [...chunks];

  if (options.purpose) {
    candidates = candidates.filter(isAuthoritativeDocumentationChunk);
  }

  if (options.comparison ||
    /\b(stack|dependency|dependencies|version|current|currently|configured|built with)\b/i.test(question)) {
    candidates.sort((left, right) => {
      const freshness = currentFilePriority(right) - currentFilePriority(left);
      return freshness || right.score - left.score;
    });
  }

  const tryAdd = (chunk: ScoredSearchChunk, requireNewRepository: boolean): boolean => {
    if (!isHttpUrl(chunk.sourceUrl)) return false;
    const channelId = chunk.channelId ?? channelFromUrl(chunk.sourceUrl);
    if (channelId && blocked.has(channelId)) return false;

    const repository = chunk.sourceType === 'github'
      ? githubRepositoryFromUrl(chunk.sourceUrl)
      : null;
    if (requireNewRepository && repository && seenRepositories.has(repository)) {
      return false;
    }

    const sourceCount = sourceCounts.get(chunk.sourceUrl) ?? 0;
    if (sourceCount === 0 && sourceCounts.size >= maxSources) return false;
    if (sourceCount >= MAX_CHUNKS_PER_SOURCE) return false;

    selected.push(chunk);
    sourceCounts.set(chunk.sourceUrl, sourceCount + 1);
    if (repository) seenRepositories.add(repository);
    return true;
  };

  if (options.preferDistinctGithubRepositories) {
    for (const chunk of candidates) {
      if (selected.length >= maxChunks) break;
      tryAdd(chunk, true);
    }
  }
  for (const chunk of candidates) {
    if (selected.length >= maxChunks) break;
    if (selected.includes(chunk)) continue;
    tryAdd(chunk, false);
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
  return repositoryScopesFromQuestion(question, githubOrg, knownRepositoryFullNames)[0];
}

/**
 * Every repository explicitly named in the question. A comparison such as
 * "compare Ajiet-DevNation/pluto and Ajiet-DevNation/dn-orbit" must not silently
 * scope to only the first repository.
 */
export function repositoryScopesFromQuestion(
  question: string,
  githubOrg?: string,
  knownRepositoryFullNames: readonly string[] = [],
): string[] {
  if (!githubOrg) return [];

  const scopes = new Map<string, string>();
  const add = (fullName: string) => {
    const key = fullName.toLowerCase();
    if (!scopes.has(key)) scopes.set(key, fullName);
  };

  const escapedOrg = githubOrg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const explicit = new RegExp(`${escapedOrg}\\/([A-Za-z0-9._-]+)`, 'gi');
  for (const match of question.matchAll(explicit)) {
    const repositoryName = match[1].replace(/[.,;:!?]+$/, '');
    if (repositoryName) add(`${githubOrg}/${repositoryName}`);
  }

  for (const fullName of knownRepositoryFullNames) {
    if (!fullName.toLowerCase().startsWith(`${githubOrg.toLowerCase()}/`)) continue;
    const repoName = fullName.slice(fullName.indexOf('/') + 1);
    const escapedRepo = repoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9._-])${escapedRepo}($|[^A-Za-z0-9._-])`, 'i').test(question)) {
      add(fullName);
    }
  }

  return [...scopes.values()];
}

function githubEvidenceLabel(sourceUrl: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const repository = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : 'GitHub';
    if (pathname.includes('/blob/')) return `GitHub current file (${repository})`;
    if (pathname.includes('/commit/')) return `GitHub historical commit (${repository})`;
    if (pathname.includes('/issues/')) return `GitHub issue (${repository})`;
    if (pathname.includes('/pull/')) return `GitHub pull request (${repository})`;
  } catch {
    return 'GitHub';
  }
  return 'GitHub';
}

function evidenceLabel(chunk: ScoredSearchChunk): string {
  if (chunk.sourceType !== 'github') return chunkSourceLabel(chunk.sourceType);
  return githubEvidenceLabel(chunk.sourceUrl);
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
        `[${index + 1}] ${evidenceLabel(chunk)}`,
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
    ...ASK_PROMPT_INSTRUCTIONS,
  ].join('\n');
}

/**
 * Remove bare URLs and source-list lines from generated answer text. The
 * command appends the selected source footer separately, so the answer itself
 * must not carry URLs or a `Sources:` block. Evidence sometimes contains a URL
 * (for example, a README health-check example), and the generation model may
 * repeat it even when instructed not to.
 */
export function stripUrls(answer: string): string {
  return answer
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/gi, '$1')
    .replace(/<?https?:\/\/[^\s<>"')\]]+>?/gi, (matched) => {
      // Preserve sentence punctuation that was adjacent to the URL.
      return matched.match(/[.,;:!?]+$/)?.[0] ?? '';
    })
    .replace(/^\s*(?:sources?|citations?)\s*:.*$/gim, '')
    .replace(/\b(?:at|from|on|via|using|use|see|visit|open)\s+(?=[.,;:!?]|$)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[.,;:!?]+$/, '')
    .trim();
}

/**
 * Remove `[n]` citation markers from a rendered answer. Numeric arrays that
 * are part of code or configuration ("the array is [1, 2]") are preserved.
 */
export function stripCitationMarkers(answer: string): string {
  return stripUrls(answer)
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, _numbers, offset, whole) => {
      const before = whole.slice(0, offset);
      const clause = before.split(/[.\n]/).pop() ?? before;
      if (
        /(?:\bis|\bare|\bwas|\bwere|=|:)\s*$/i.test(clause) ||
        /\b(?:array|list|tuple|config|values?|args?|parameters?)\b/i.test(clause)
      ) {
        return match;
      }
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim();
}

export function renderAnswer(answer: string, _sources: readonly AskSource[] = []): string {
  return stripCitationMarkers(answer);
}

/**
 * Remove a standalone "I could not find evidence" sentence when the model also
 * produced a grounded partial answer. Without this, a mixed answer can say both
 * "PR #7 states ..." and "I couldn't find evidence ...", which is contradictory.
 * Caveats such as "The evidence does not mention X" are preserved.
 */
const STANDALONE_NO_EVIDENCE = /\bI (?:cannot|can't|could not|couldn't|am unable to) (?:find|locate|determine|confirm|answer|verify)\b/i;

export function stripStandaloneNoEvidence(answer: string): string {
  const sentences = answer.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => {
    if (/\b(?:but|however|although|yet)\b/i.test(sentence)) return true;
    return !STANDALONE_NO_EVIDENCE.test(sentence);
  });
  const result = kept.join(' ').replace(/\s+/g, ' ').trim();
  return result.length > 0 ? result : answer;
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

    const repositoryScopes = this.dependencies.resolveRepositoryScopes
      ? [...new Set(await this.dependencies.resolveRepositoryScopes(query))]
      : this.dependencies.resolveRepositoryScope
        ? [await this.dependencies.resolveRepositoryScope(query)].filter(
            (scope): scope is string => Boolean(scope),
          )
        : repositoryScopesFromQuestion(query, this.dependencies.githubOrg);
    const repositoryScope = repositoryScopes.length === 1 ? repositoryScopes[0] : undefined;

    const cacheKey = `${repositoryScopes.join(',')}\u0000${query.toLowerCase().replace(/\s+/g, ' ')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < answerCacheTtlMs()) {
      return cached.result;
    }

    // Contributor questions are answered from GitHub's read-only contributors
    // API. Never fall back to indexed commits, PRs, or guessed names.
    if (isContributorQuestion(query)) {
      if (repositoryScopes.length > 1) {
        return {
          ok: false,
          message: CONTRIBUTOR_MULTIPLE_MESSAGE,
          reason: 'contributor-unavailable',
        };
      }
      if (!repositoryScope) {
        return {
          ok: false,
          message: CONTRIBUTOR_SCOPE_MESSAGE,
          reason: 'contributor-unavailable',
        };
      }
      if (this.dependencies.isContributorRepositoryAllowed) {
        let allowed = false;
        try {
          allowed = await this.dependencies.isContributorRepositoryAllowed(repositoryScope);
        } catch {
          return {
            ok: false,
            message: CONTRIBUTOR_UNAVAILABLE_MESSAGE,
            reason: 'contributor-unavailable',
          };
        }
        if (!allowed) {
          return {
            ok: false,
            message: CONTRIBUTOR_NOT_ALLOWED_MESSAGE,
            reason: 'contributor-unavailable',
          };
        }
      }
      if (!this.dependencies.lookupGitHubContributors) {
        return {
          ok: false,
          message: CONTRIBUTOR_UNAVAILABLE_MESSAGE,
          reason: 'contributor-unavailable',
        };
      }
      try {
        const contributors = await this.dependencies.lookupGitHubContributors(repositoryScope);
        if (contributors.length === 0) {
          return {
            ok: false,
            message: CONTRIBUTOR_EMPTY_MESSAGE,
            reason: 'contributor-unavailable',
          };
        }
        const source: AskSource = {
          label: `${repositoryScope} contributors`,
          url: contributorsPageUrl(repositoryScope),
          references: [],
        };
        const result: Extract<AskResult, { ok: true }> = {
          ok: true,
          answer: [
            formatContributors(repositoryScope, contributors),
            answerCacheTtlMs() > 0 ? CONTRIBUTOR_CACHE_NOTE : '',
          ].filter(Boolean).join(' '),
          sources: [source],
          displaySources: [source],
          chunks: [],
        };
        this.remember(cacheKey, result);
        return result;
      } catch (error) {
        const kind = error instanceof ContributorLookupError ? error.kind : 'unavailable';
        const message = kind === 'not-found'
          ? CONTRIBUTOR_NOT_FOUND_MESSAGE
          : kind === 'rate-limited'
            ? CONTRIBUTOR_RATE_LIMIT_MESSAGE
            : kind === 'forbidden'
              ? CONTRIBUTOR_FORBIDDEN_MESSAGE
              : kind === 'not-allowed'
                ? CONTRIBUTOR_NOT_ALLOWED_MESSAGE
                : kind === 'empty'
                  ? CONTRIBUTOR_EMPTY_MESSAGE
                  : CONTRIBUTOR_UNAVAILABLE_MESSAGE;
        return { ok: false, message, reason: 'contributor-unavailable' };
      }
    }

    let evidence: EvidenceResult<ScoredSearchChunk>;
    let missingScopes: string[] = [];
    let scopesWithEvidence: string[] = [];
    try {
      if (repositoryScopes.length > 1) {
        const scoped = await Promise.all(
          repositoryScopes.map((scope) => this.dependencies.retrieval.retrieve(query, scope)),
        );
        const chunks = scoped
          .flatMap((result) => (result.ok ? result.chunks : []))
          .sort((left, right) => right.score - left.score);
        missingScopes = repositoryScopes.filter((_, index) => !scoped[index].ok);
        scopesWithEvidence = repositoryScopes.filter((_, index) => scoped[index].ok);
        evidence = chunks.length > 0
          ? { ok: true, chunks }
          : { ok: false, message: NO_EVIDENCE_MESSAGE };
      } else {
        evidence = await this.dependencies.retrieval.retrieve(query, repositoryScope);
        if (repositoryScope && evidence.ok) scopesWithEvidence = [repositoryScope];
      }
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

    const repositoryList = repositoryScopes.length > 1 ||
      (!repositoryScope && isRepositoryListQuestion(query));
    const comparison = isComparisonQuestion(query, repositoryScopes);
    const purpose = isRepositoryPurposeQuestion(query);
    const maxSources = repositoryList
      ? Math.min(
          MAX_REPOSITORY_LIST_SOURCES,
          Math.max(MAX_ANSWER_SOURCES_REPOSITORY_LIST, repositoryScopes.length),
        )
      : MAX_ANSWER_SOURCES;
    const maxChunks = repositoryList ? Math.max(MAX_ANSWER_CHUNKS, maxSources) : MAX_ANSWER_CHUNKS;
    const answerChunks = selectAnswerChunks(
      evidence.chunks,
      this.dependencies.blockedChannelIds,
      maxSources,
      maxChunks,
      query,
      { preferDistinctGithubRepositories: repositoryList, comparison, purpose },
    );
    if (answerChunks.length === 0) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE, reason: 'no-evidence' };
    }
    const representedScopes = new Set(
      answerChunks
        .filter((chunk) => chunk.sourceType === 'github')
        .map((chunk) => githubRepositoryFromUrl(chunk.sourceUrl)?.toLowerCase())
        .filter((repository): repository is string => Boolean(repository)),
    );
    const authoritativeScopes = new Set(
      repositoryScopes.filter((scope) =>
        evidence.chunks.some(
          (chunk) =>
            githubRepositoryFromUrl(chunk.sourceUrl)?.toLowerCase() === scope.toLowerCase() &&
            isAuthoritativeDocumentationChunk(chunk),
        ),
      ),
    );
    const limitedScopes = (comparison || purpose)
      ? scopesWithEvidence.filter((scope) => !authoritativeScopes.has(scope))
      : [];
    const omittedScopes = repositoryScopes.filter(
      (scope) =>
        scopesWithEvidence.includes(scope) &&
        !missingScopes.includes(scope) &&
        !limitedScopes.includes(scope) &&
        !representedScopes.has(scope.toLowerCase()),
    );
    const sources = sourcesFromChunks(
      answerChunks,
      this.dependencies.blockedChannelIds,
      maxSources,
    );
    const displaySources = selectDisplaySources(
      query,
      answerChunks,
      sources,
      repositoryScopes,
    );

    if (this.dependencies.reserveAnswerBudget) {
      const resumeAt = await this.dependencies.reserveAnswerBudget(
        budgetLimitsFromEnv().answerPerQuestion,
      );
      if (resumeAt) {
        return { ok: false, message: BUSY_MESSAGE, reason: 'quota' };
      }
    }

    let prompt = buildAskPrompt(query, answerChunks);
    if (missingScopes.length > 0) {
      prompt += [
        '',
        `No evidence was retrieved for: ${missingScopes.join(', ')}.`,
        'State that the comparison is incomplete for those repositories.',
      ].join('\n');
    }
    if (limitedScopes.length > 0) {
      prompt += [
        '',
        `Only incidental or non-documentation evidence (for example commits, pull requests, Discord messages, or meeting transcripts) was retrieved for: ${limitedScopes.join(', ')}.`,
        'Do not describe their overall purpose or goals from that evidence. State explicitly that authoritative README or documentation evidence is missing for them.',
      ].join('\n');
    }
    if (omittedScopes.length > 0) {
      prompt += [
        '',
        `Evidence for these repositories was omitted to keep the answer within the context limit: ${omittedScopes.join(', ')}.`,
        'Do not claim to have compared them.',
      ].join('\n');
    }

    let generated: string;
    try {
      generated = await this.dependencies.generator.generate(prompt);
    } catch (error) {
      if (error instanceof AnswerQuotaExceededError) {
        return { ok: false, message: BUSY_MESSAGE, reason: 'quota' };
      }
      throw error;
    }

    const answer = stripStandaloneNoEvidence(
      stripInternalPromptLeakage(stripCitationMarkers(generated)),
    );
    const evidenceText = answerChunks.map((chunk) => chunk.content).join('\n');
    if (
      isNoEvidenceAnswer(answer) ||
      isSpeculativeAnswer(answer) ||
      hasUnsupportedVersionClaim(answer, evidenceText)
    ) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE, reason: 'no-evidence' };
    }

    const result: Extract<AskResult, { ok: true }> = {
      ok: true,
      answer: renderAnswer(answer, sources),
      sources,
      displaySources,
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
