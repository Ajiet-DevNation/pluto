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
 * Full-text ranks are not comparable to cosine values. A chunk that matches
 * every term (`strict`) is strong evidence; a chunk that matches only one
 * common term is not. The mapping below therefore takes term coverage into
 * account instead of admitting every non-zero `ts_rank_cd` hit:
 *
 * - strict AND match             → at least 0.60
 * - coverage ≥60% (IDF-weighted) → at least 0.40
 * - 50% coverage with high rank  → at least 0.40
 * - one broad term (parts only)  → capped below the gate
 * - anything weaker              → capped below the gate
 *
 * Coverage is weighted by inverse document frequency in the store, so a match
 * on a rare identifier (`tsvector`) outweighs a match on a common word
 * (`migration`). A broad-only single term is capped because it is usually a
 * piece of a compound identifier (`next` from `next.js`), not evidence on its
 * own. The cap is also what stops "capital of France" from becoming evidence
 * merely because one unrelated chunk contains the word "capital".
 */

const VECTOR_BASELINE = 0.5;
const FTS_STRICT_FLOOR = 0.6;
const FTS_COVERAGE_FLOOR = 0.4;
const FTS_WEAK_CAP = 0.39;
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

/**
 * Convert a `ts_rank_cd` score into calibrated relevance.
 *
 * `coverage` is the IDF-weighted share of the question's full terms that the
 * chunk matches (0..1). `termCount` is used only to keep broad-only matches on
 * a single compound token from passing the gate. Coverage defaults to 1 for
 * callers that only have a rank.
 */
export function fullTextToRelevance(
  rank: number,
  coverage = 1,
  termCount = 1,
  strict = false,
): number {
  if (!Number.isFinite(rank) || rank <= 0) {
    return 0;
  }

  if (strict) {
    return clampRelevance(FTS_STRICT_FLOOR + rank * FTS_SCALE);
  }

  if (!Number.isFinite(termCount) || termCount <= 0) {
    return 0;
  }
  const normalizedCoverage = Number.isFinite(coverage)
    ? Math.min(1, Math.max(0, coverage))
    : 0;

  if (termCount <= 1) {
    // A broad-only single term is normally a part of a compound token.
    return clampRelevance(Math.min(FTS_WEAK_CAP, rank * FTS_SCALE));
  }
  if (normalizedCoverage >= 0.6) {
    return clampRelevance(FTS_COVERAGE_FLOOR + rank * FTS_SCALE);
  }
  if (normalizedCoverage >= 0.5 && rank >= 0.5) {
    return clampRelevance(FTS_COVERAGE_FLOOR + rank);
  }
  return clampRelevance(Math.min(FTS_WEAK_CAP, rank * FTS_SCALE));
}
