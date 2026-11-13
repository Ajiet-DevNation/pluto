/**
 * Evidence-only gate.
 *
 * `/ask` may answer only from retrieved indexed chunks. If nothing meets the
 * relevance threshold, the answer is the standard no-evidence message, and the
 * model is never called to fill the gap from general knowledge.
 *
 * The threshold is supplied by configuration. The search contract owns its
 * value; this module does not choose one.
 */

export const NO_EVIDENCE_MESSAGE =
  "I couldn't find evidence for that in the indexed sources (GitHub, Discord, Miro, meeting transcripts).";

export interface ScoredChunk {
  score: number;
}

export type EvidenceResult<T extends ScoredChunk> =
  | { ok: true; chunks: T[] }
  | { ok: false; message: typeof NO_EVIDENCE_MESSAGE };

export class EvidenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceConfigError';
  }
}

/**
 * Keep chunks at or above `minScore`. Return the no-evidence result when none remain.
 */
export function gateEvidence<T extends ScoredChunk>(
  chunks: readonly T[],
  minScore: number,
): EvidenceResult<T> {
  if (!Number.isFinite(minScore)) {
    throw new EvidenceConfigError(`Relevance threshold must be a finite number, got ${minScore}`);
  }

  const relevant = chunks.filter((chunk) => Number.isFinite(chunk.score) && chunk.score >= minScore);

  if (relevant.length === 0) {
    return { ok: false, message: NO_EVIDENCE_MESSAGE };
  }

  return { ok: true, chunks: relevant };
}

/**
 * Read the threshold from the environment. Missing config throws, so the bot
 * cannot silently run with no gate.
 */
export function evidenceThresholdFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.EVIDENCE_MIN_SCORE?.trim();
  if (!raw) {
    throw new EvidenceConfigError('EVIDENCE_MIN_SCORE is not set; the evidence gate needs a threshold');
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new EvidenceConfigError(`EVIDENCE_MIN_SCORE must be a number, got "${raw}"`);
  }
  return value;
}
