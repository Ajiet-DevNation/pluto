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
      message: typeof NO_EVIDENCE_MESSAGE;
    };

export interface AskDependencies {
  retrieval: Pick<RetrievalService, 'retrieve'>;
  generator: AnswerGenerator;
  githubOrg?: string;
  resolveRepositoryScope?: (question: string) => Promise<string | undefined>;
  blockedChannelIds?: readonly string[];
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
    'Answer using only the evidence above. Cite each claim with its bracket number,',
    'for example [1]. If the evidence is insufficient, say so explicitly.',
    'For current configuration, dependency, or version questions, prefer current default-branch file URLs (/blob/) over historical commit messages.',
    'Treat commit messages as history, not proof of the current state. If only historical evidence exists, say that it cannot confirm the current value.',
  ].join('\n');
}

/**
 * Remove `[n]` markers that do not correspond to a retrieved evidence chunk.
 * Models occasionally invent a citation number; the rendered answer must only
 * reference evidence that actually passed the gate.
 */
export function stripUnverifiedCitationMarkers(
  answer: string,
  evidenceCount: number,
): string {
  return answer
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, group: string) => {
      const valid = group
        .split(',')
        .map((part) => Number(part.trim()))
        .filter(
          (number) =>
            Number.isInteger(number) && number >= 1 && number <= evidenceCount,
        );
      return valid.length > 0 ? `[${valid.join(', ')}]` : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function renderAnswer(answer: string, sources: readonly AskSource[]): string {
  const trimmed = answer.trim();
  if (sources.length === 0) {
    return trimmed;
  }
  const links = sources
    .map((source) => `- ${source.references.map((reference) => `[${reference}]`).join(', ')} [${source.label}](${source.url})`)
    .join('\n');
  return `${trimmed}\n\nSources:\n${links}`;
}

export class AskService {
  constructor(private readonly dependencies: AskDependencies) {}

  async ask(question: string): Promise<AskResult> {
    const query = question.trim();
    if (!query) {
      return { ok: false, message: NO_EVIDENCE_MESSAGE };
    }

    const repositoryScope = this.dependencies.resolveRepositoryScope
      ? await this.dependencies.resolveRepositoryScope(query)
      : repositoryScopeFromQuestion(query, this.dependencies.githubOrg);
    const evidence: EvidenceResult<ScoredSearchChunk> = await this.dependencies.retrieval.retrieve(
      query,
      repositoryScope,
    );
    if (!evidence.ok) {
      return evidence;
    }

    const answerChunks = selectAnswerChunks(
      evidence.chunks,
      this.dependencies.blockedChannelIds,
      MAX_ANSWER_SOURCES,
      MAX_ANSWER_CHUNKS,
      query,
    );
    const sources = sourcesFromChunks(answerChunks, this.dependencies.blockedChannelIds);
    const generated = await this.dependencies.generator.generate(
      buildAskPrompt(query, answerChunks),
    );
    const answer = stripUnverifiedCitationMarkers(
      generated,
      answerChunks.length,
    );

    return {
      ok: true,
      answer: renderAnswer(answer, sources),
      sources,
      chunks: answerChunks,
    };
  }
}
