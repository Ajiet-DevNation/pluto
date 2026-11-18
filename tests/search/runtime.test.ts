import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchRuntimeFromEnv } from '../../src/search/runtime';

test('indexing runtime is optional when no indexing credentials are present', () => {
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

test('partial indexing configuration fails closed', () => {
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
