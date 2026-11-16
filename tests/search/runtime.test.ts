import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchRuntimeFromEnv,
  DEFAULT_EVIDENCE_MIN_SCORE,
  lookupContributorsForRepository,
} from '../../src/search/runtime';
import { ContributorLookupError } from '../../src/search/contributors';
import {
  GitHubReadError,
  type GitHubContributor,
  type GitHubRepo,
} from '../../src/github/reader';

function repository(privateValue: boolean): GitHubRepo {
  return {
    id: 1,
    name: 'pluto',
    fullName: 'Ajiet-DevNation/pluto',
    private: privateValue,
    htmlUrl: 'https://github.com/Ajiet-DevNation/pluto',
    description: null,
    defaultBranch: 'main',
  };
}

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

test('unknown contributor repositories are rejected before any GitHub call', async () => {
  let getRepoCalls = 0;
  let listContributorCalls = 0;
  const reader = {
    async getRepo(): Promise<GitHubRepo> {
      getRepoCalls += 1;
      return repository(false);
    },
    async listContributors(): Promise<GitHubContributor[]> {
      listContributorCalls += 1;
      return [];
    },
  };

  await assert.rejects(
    () => lookupContributorsForRepository(
      'Ajiet-DevNation/core-secrets',
      ['Ajiet-DevNation/pluto'],
      reader,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ContributorLookupError);
      assert.equal(error.kind, 'not-allowed');
      return true;
    },
  );
  assert.equal(getRepoCalls, 0);
  assert.equal(listContributorCalls, 0);
});

test('private or unverified contributor repositories never reach listContributors', async () => {
  let listContributorCalls = 0;
  const reader = {
    async getRepo(): Promise<GitHubRepo> {
      return repository(true);
    },
    async listContributors(): Promise<GitHubContributor[]> {
      listContributorCalls += 1;
      return [{ login: 'private-user', contributions: 1, htmlUrl: null }];
    },
  };

  await assert.rejects(
    () => lookupContributorsForRepository(
      'Ajiet-DevNation/pluto',
      ['Ajiet-DevNation/pluto'],
      reader,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ContributorLookupError);
      assert.equal(error.kind, 'not-allowed');
      return true;
    },
  );
  assert.equal(listContributorCalls, 0);
});

test('known public repositories can reach the contributor endpoint', async () => {
  let listContributorCalls = 0;
  const reader = {
    async getRepo(): Promise<GitHubRepo> {
      return repository(false);
    },
    async listContributors(): Promise<GitHubContributor[]> {
      listContributorCalls += 1;
      return [{ login: 'khushi', contributions: 12, htmlUrl: 'https://github.com/khushi' }];
    },
  };

  const contributors = await lookupContributorsForRepository(
    'Ajiet-DevNation/pluto',
    ['Ajiet-DevNation/pluto'],
    reader,
  );
  assert.deepEqual(contributors, [
    { login: 'khushi', contributions: 12, htmlUrl: 'https://github.com/khushi' },
  ]);
  assert.equal(listContributorCalls, 1);
});

test('visibility-check failures preserve not-found and rate-limit reasons', async () => {
  for (const [error, reason] of [
    [new GitHubReadError('missing', 404), 'not-found'],
    [new GitHubReadError('limited', 429), 'rate-limited'],
    [new GitHubReadError('limited', 403, { rateLimited: true }), 'rate-limited'],
    [new GitHubReadError('forbidden', 403), 'forbidden'],
  ] as const) {
    let listContributorCalls = 0;
    const reader = {
      async getRepo(): Promise<GitHubRepo> {
        throw error;
      },
      async listContributors(): Promise<GitHubContributor[]> {
        listContributorCalls += 1;
        return [];
      },
    };

    await assert.rejects(
      () => lookupContributorsForRepository(
        'Ajiet-DevNation/pluto',
        ['Ajiet-DevNation/pluto'],
        reader,
      ),
      (caught: unknown) => {
        assert.ok(caught instanceof ContributorLookupError);
        assert.equal(caught.kind, reason);
        return true;
      },
    );
    assert.equal(listContributorCalls, 0);
  }
});
