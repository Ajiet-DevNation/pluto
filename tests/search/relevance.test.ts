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

test('any non-zero full-text rank clears the v1 threshold', () => {
  assert.equal(fullTextToRelevance(0), 0);
  assert.ok(fullTextToRelevance(0.001) >= 0.4);
  assert.equal(fullTextToRelevance(0.2), 0.8);
  assert.equal(fullTextToRelevance(1), 1);
  assert.equal(fullTextToRelevance(Number.NaN), 0);
});

test('clampRelevance always returns a finite 0..1 value', () => {
  assert.equal(clampRelevance(-0.2), 0);
  assert.equal(clampRelevance(0.5), 0.5);
  assert.equal(clampRelevance(2), 1);
  assert.equal(clampRelevance(Number.NaN), 0);
});
