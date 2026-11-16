import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRelevance,
  cosineToRelevance,
  fullTextToRelevance,
} from '../../src/search/relevance';

test('cosine relevance maps the bge baseline to zero and the v1 threshold to 0.4', () => {
  assert.equal(cosineToRelevance(0.5), 0);
  assert.ok(Math.abs(cosineToRelevance(0.7) - 0.4) < 1e-9);
  assert.ok(Math.abs(cosineToRelevance(0.8) - 0.6) < 1e-9);
  assert.equal(cosineToRelevance(1), 1);
});

test('cosine relevance clamps unrelated and malformed values', () => {
  assert.equal(cosineToRelevance(0.4), 0);
  assert.equal(cosineToRelevance(-1), 0);
  assert.equal(cosineToRelevance(Number.NaN), 0);
  assert.equal(cosineToRelevance(1.2), 1);
});

test('a strict full-text match clears the v1 threshold', () => {
  assert.equal(fullTextToRelevance(0), 0);
  assert.ok(fullTextToRelevance(0.001, 1, 3, true) >= 0.6);
  assert.equal(fullTextToRelevance(Number.NaN, 1, 1, true), 0);
});

test('a broad-only single term never clears the threshold', () => {
  assert.ok(fullTextToRelevance(0.1, 1, 1) < 0.4);
  assert.ok(fullTextToRelevance(1, 1, 1) < 0.4);
  assert.ok(fullTextToRelevance(0.1, 1, 1, true) >= 0.6);
});

test('full-text coverage decides whether a partial match is evidence', () => {
  // 60% weighted coverage is strong enough.
  assert.ok(fullTextToRelevance(0.1, 0.6, 5) >= 0.4);
  // 50% coverage does not pass with a weak rank ("capital of France").
  assert.ok(fullTextToRelevance(0.2, 0.5, 2) < 0.4);
  // 33% coverage is not enough even with a huge rank.
  assert.ok(fullTextToRelevance(1, 0.33, 3) < 0.4);
  // 50% coverage only passes with a strong rank.
  assert.ok(fullTextToRelevance(0.5, 0.5, 2) >= 0.4);
});

test('clampRelevance always returns a finite 0..1 value', () => {
  assert.equal(clampRelevance(-0.2), 0);
  assert.equal(clampRelevance(0.5), 0.5);
  assert.equal(clampRelevance(2), 1);
  assert.equal(clampRelevance(Number.NaN), 0);
});
