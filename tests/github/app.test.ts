import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubTokenProvider,
  GitHubCredentialError,
  resolveGitHubCredential,
} from '../../src/github/app';

test('resolves PAT mode', () => {
  assert.deepEqual(
    resolveGitHubCredential({ GITHUB_AUTH_MODE: 'pat', GITHUB_TOKEN: ' pat-value ' }),
    { kind: 'token', token: 'pat-value' },
  );
});

test('requires complete credentials for explicit App mode', () => {
  assert.throws(
    () => resolveGitHubCredential({ GITHUB_AUTH_MODE: 'app', GITHUB_APP_ID: '5756762' }),
    GitHubCredentialError,
  );
});

test('prefers a complete App setup over PAT in auto mode', () => {
  assert.deepEqual(
    resolveGitHubCredential({
      GITHUB_TOKEN: 'pat-value',
      GITHUB_APP_ID: '5756762',
      GITHUB_INSTALLATION_ID: '181868637',
      GITHUB_PRIVATE_KEY_PATH: '/secure/pluto.pem',
    }),
    {
      kind: 'app',
      appId: 5756762,
      installationId: 181868637,
      privateKeyPath: '/secure/pluto.pem',
    },
  );
});

test('App provider uses Octokit installation auth and reuses its client', async () => {
  const observed: Record<string, unknown> = {};
  let clientCreations = 0;
  let authCalls = 0;
  const provider = createGitHubTokenProvider(
    {
      GITHUB_AUTH_MODE: 'app',
      GITHUB_APP_ID: '5756762',
      GITHUB_INSTALLATION_ID: '181868637',
      GITHUB_PRIVATE_KEY_PATH: '/secure/pluto.pem',
    },
    {
      readPrivateKey(path) {
        assert.equal(path, '/secure/pluto.pem');
        return 'test-private-key';
      },
      createApp(options) {
        observed.appId = options.appId;
        observed.privateKey = options.privateKey;
        return {
          async getInstallationOctokit(installationId) {
            clientCreations += 1;
            observed.installationId = installationId;
            return {
              async auth() {
                authCalls += 1;
                return { token: `installation-token-${authCalls}` };
              },
            };
          },
        };
      },
    },
  );

  assert.equal(await provider(), 'installation-token-1');
  assert.equal(await provider(), 'installation-token-2');
  assert.deepEqual(observed, {
    appId: 5756762,
    installationId: 181868637,
    privateKey: 'test-private-key',
  });
  assert.equal(clientCreations, 1);
});

test('key file failures never include or log key contents', () => {
  assert.throws(
    () => createGitHubTokenProvider({
      GITHUB_AUTH_MODE: 'app',
      GITHUB_APP_ID: '5756762',
      GITHUB_INSTALLATION_ID: '181868637',
      GITHUB_PRIVATE_KEY_PATH: '/missing/key.pem',
    }, { readPrivateKey: () => { throw new Error('unreadable'); } }),
    /Could not read the configured GitHub App private-key file/,
  );
});
