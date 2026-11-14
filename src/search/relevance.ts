/**
 * Relevance calibration for the hybrid retriever.
 *
 * bge-base-en-v1.5 cosine similarities have a high baseline: unrelated project
 * text commonly scores ~0.6. The contract threshold (`EVIDENCE_MIN_SCORE=0.4`)
 * was written against a meaningful 0..1 relevance score, so the store maps raw
 * cosine into that range before the gate runs.
 *
 * - vector 0.50 → relevance 0.00
 * - vector 0.70 → relevance 0.40 (the v1 threshold)
 * - vector 0.80 → relevance 0.60
 *
 * Full-text ranks are smaller; any non-zero `ts_rank_cd` hit starts at 0.4 so a
 * lexical match is never discarded merely because the corpus is small.
 */

const VECTOR_BASELINE = 0.5;
const FTS_FLOOR = 0.4;
const FTS_SCALE = 2;

export function clampRelevance(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function cosineToRelevance(cosine: number): number {
  if (!Number.isFinite(cosine)) {
    return 0;
  }
  return clampRelevance((cosine - VECTOR_BASELINE) / (1 - VECTOR_BASELINE));
}

export function fullTextToRelevance(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) {
    return 0;
  }
  return clampRelevance(FTS_FLOOR + rank * FTS_SCALE);
}
