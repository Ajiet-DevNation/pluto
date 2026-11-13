import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceConfigError,
  NO_EVIDENCE_MESSAGE,
  evidenceThresholdFromEnv,
  gateEvidence,
} from '../../src/guardrails/evidence';

const chunk = (id: string, score: number) => ({ id, score });

test('no-evidence message matches the security contract exactly', () => {
  assert.equal(
    NO_EVIDENCE_MESSAGE,
    "I couldn't find evidence for that in the indexed sources (GitHub, Discord, Miro, meeting transcripts).",
  );
});

test('empty retrieval returns the no-evidence result', () => {
  const result = gateEvidence([], 0.5);
  assert.deepEqual(result, { ok: false, message: NO_EVIDENCE_MESSAGE });
});

test('chunks entirely below the threshold return the no-evidence result', () => {
  const result = gateEvidence([chunk('a', 0.1), chunk('b', 0.49)], 0.5);
  assert.deepEqual(result, { ok: false, message: NO_EVIDENCE_MESSAGE });
});

test('chunks at or above the threshold pass through, below-threshold ones are dropped', () => {
  const result = gateEvidence([chunk('a', 0.1), chunk('b', 0.5), chunk('c', 0.9)], 0.5);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.chunks.map((c) => c.id), ['b', 'c']);
  }
});

test('non-finite scores are never treated as evidence', () => {
  const result = gateEvidence([chunk('a', Number.NaN), chunk('b', Number.POSITIVE_INFINITY)], 0);
  assert.deepEqual(result, { ok: false, message: NO_EVIDENCE_MESSAGE });
});

test('a non-finite threshold throws instead of passing everything', () => {
  assert.throws(() => gateEvidence([chunk('a', 1)], Number.NaN), EvidenceConfigError);
});

test('threshold is read from EVIDENCE_MIN_SCORE', () => {
  assert.equal(evidenceThresholdFromEnv({ EVIDENCE_MIN_SCORE: '0.42' }), 0.42);
});

test('missing or malformed threshold config throws', () => {
  assert.throws(() => evidenceThresholdFromEnv({}), EvidenceConfigError);
  assert.throws(() => evidenceThresholdFromEnv({ EVIDENCE_MIN_SCORE: '  ' }), EvidenceConfigError);
  assert.throws(() => evidenceThresholdFromEnv({ EVIDENCE_MIN_SCORE: 'high' }), EvidenceConfigError);
});
