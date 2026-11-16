import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDisclosedUncertainty,
  hasSatisfyingVersionClaim,
} from '../../src/search/evaluation';

test('confident current-version claims are not accepted as uncertainty', () => {
  assert.equal(
    hasDisclosedUncertainty('The current Next.js version is 16, based on commit history.'),
    false,
  );
  assert.equal(
    hasDisclosedUncertainty('Based on historical commits, the current version is 16.'),
    false,
  );
});

test('explicit uncertainty and historical-vs-current distinction are accepted', () => {
  assert.equal(
    hasDisclosedUncertainty(
      'Historical commits mention Next.js 16, but I cannot confirm the current version.',
    ),
    true,
  );
  assert.equal(
    hasDisclosedUncertainty(
      'Historical commits mention Next.js 16; the current version is not stated in the indexed files.',
    ),
    true,
  );
  assert.equal(hasDisclosedUncertainty('Only historical commits are available.'), true);
});

test('major-only version expectations accept matching majors and full versions', () => {
  const expectation = { technology: 'typescript', major: 7 };
  assert.equal(hasSatisfyingVersionClaim('TypeScript 7 is used.', expectation), true);
  assert.equal(hasSatisfyingVersionClaim('TypeScript 7 is not 4.', expectation), true);
  assert.equal(hasSatisfyingVersionClaim('TypeScript 7.0.2 is used.', expectation), true);
  assert.equal(hasSatisfyingVersionClaim('The current TypeScript version is 7.0.2.', expectation), true);
});

test('version-aware matching rejects wrong and negated versions', () => {
  const expectation = { technology: 'typescript', major: 7 };
  assert.equal(hasSatisfyingVersionClaim('TypeScript 4 is used.', expectation), false);
  assert.equal(hasSatisfyingVersionClaim('TypeScript 4, not 7.', expectation), false);
  assert.equal(
    hasSatisfyingVersionClaim('TypeScript 7 is not used; TypeScript 4 is current.', expectation),
    false,
  );
  assert.equal(
    hasSatisfyingVersionClaim('TypeScript 7.0.2 is not current; TypeScript 4 is current.', expectation),
    false,
  );
});

test('full version expectations require the same full version', () => {
  assert.equal(
    hasSatisfyingVersionClaim('TypeScript 7.0.2 is used.', {
      technology: 'typescript',
      version: '7.0.2',
    }),
    true,
  );
  assert.equal(
    hasSatisfyingVersionClaim('TypeScript 7.1 is used.', {
      technology: 'typescript',
      version: '7.0.2',
    }),
    false,
  );
});
