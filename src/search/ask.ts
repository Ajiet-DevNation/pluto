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
  blockedChannelIds?: readonly string[];
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
): AskSource[] {
  const blocked = new Set(blockedChannelIds);
  const seen = new Set<string>();
  const sources: AskSource[] = [];

  for (const chunk of chunks) {
    if (!isHttpUrl(chunk.sourceUrl)) {
      continue;
    }
    const channelId = chunk.channelId ?? channelFromUrl(chunk.sourceUrl);
    if (channelId && blocked.has(channelId)) {
      continue;
    }
    if (seen.has(chunk.sourceUrl)) {
      continue;
    }
    seen.add(chunk.sourceUrl);
    sources.push({
      label: chunkSourceLabel(chunk.sourceType),
      url: chunk.sourceUrl,
    });
  }

  return sources;
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
    .map((source) => `- [${source.label}](${source.url})`)
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

    const evidence: EvidenceResult<ScoredSearchChunk> =
      await this.dependencies.retrieval.retrieve(query);
    if (!evidence.ok) {
      return evidence;
    }

    const sources = sourcesFromChunks(
      evidence.chunks,
      this.dependencies.blockedChannelIds,
    );
    const generated = await this.dependencies.generator.generate(
      buildAskPrompt(query, evidence.chunks),
    );
    const answer = stripUnverifiedCitationMarkers(
      generated,
      evidence.chunks.length,
    );

    return {
      ok: true,
      answer: renderAnswer(answer, sources),
      sources,
      chunks: evidence.chunks,
    };
  }
}
