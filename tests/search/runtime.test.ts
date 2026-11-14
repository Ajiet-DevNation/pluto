import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchRuntimeFromEnv,
  DEFAULT_EVIDENCE_MIN_SCORE,
} from '../../src/search/runtime';

test('search runtime is optional when no search credentials are present', () => {
  assert.equal(createSearchRuntimeFromEnv({}), null);
  assert.equal(
    createSearchRuntimeFromEnv({
      DATABASE_URL: '',
      CLOUDFLARE_ACCOUNT_ID: ' ',
      CLOUDFLARE_AI_TOKEN: '',
    }),
    null,
  );
});

test('partial search configuration fails closed', () => {
  assert.throws(
    () =>
      createSearchRuntimeFromEnv({
        DATABASE_URL: 'postgresql://localhost:5432/pluto',
      }),
    /CLOUDFLARE_ACCOUNT_ID/,
  );
  assert.throws(
    () =>
      createSearchRuntimeFromEnv({
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_AI_TOKEN: 'token',
      }),
    /DATABASE_URL/,
  );
});

test('the documented v1 evidence threshold is the runtime default', () => {
  assert.equal(DEFAULT_EVIDENCE_MIN_SCORE, 0.4);
});
