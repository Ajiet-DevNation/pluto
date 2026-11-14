import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class GitHubCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubCredentialError';
  }
}

export type GitHubCredential =
  | { kind: 'token'; token: string }
  | {
      kind: 'app';
      appId: number;
      installationId: number;
      privateKey?: string;
      privateKeyPath?: string;
    };

type Env = Record<string, string | undefined>;

export interface InstallationOctokit {
  auth(...args: unknown[]): Promise<unknown>;
}

export interface GitHubAppClient {
  getInstallationOctokit(installationId: number): Promise<InstallationOctokit>;
}

export interface GitHubTokenProviderDependencies {
  createApp?: (options: { appId: number; privateKey: string }) =>
    | GitHubAppClient
    | Promise<GitHubAppClient>;
  readPrivateKey?: (path: string) => string;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GitHubCredentialError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveGitHubCredential(env: Env = process.env): GitHubCredential {
  const mode = env.GITHUB_AUTH_MODE?.trim().toLowerCase() ?? '';
  if (mode && mode !== 'app' && mode !== 'pat' && mode !== 'auto') {
    throw new GitHubCredentialError('GITHUB_AUTH_MODE must be app, pat, or auto');
  }

  const token = env.GITHUB_TOKEN?.trim();
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_PRIVATE_KEY?.trim();
  const privateKeyPath = env.GITHUB_PRIVATE_KEY_PATH?.trim();
  const hasAnyAppSetting = Boolean(appId || installationId || privateKey || privateKeyPath);
  const hasCompleteAppSettings = Boolean(appId && installationId && (privateKey || privateKeyPath));

  if (mode === 'pat') {
    if (!token) {
      throw new GitHubCredentialError('GITHUB_AUTH_MODE=pat requires GITHUB_TOKEN');
    }
    return { kind: 'token', token };
  }

  if (mode === 'app' || hasCompleteAppSettings) {
    if (!hasCompleteAppSettings) {
      throw new GitHubCredentialError(
        'GitHub App auth requires GITHUB_APP_ID, GITHUB_INSTALLATION_ID, and either ' +
          'GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY',
      );
    }
    return {
      kind: 'app',
      appId: positiveInteger(appId, 'GITHUB_APP_ID'),
      installationId: positiveInteger(installationId, 'GITHUB_INSTALLATION_ID'),
      ...(privateKeyPath ? { privateKeyPath } : { privateKey }),
    };
  }

  if (token && (mode === 'auto' || !mode)) {
    return { kind: 'token', token };
  }

  if (hasAnyAppSetting) {
    throw new GitHubCredentialError(
      'GitHub App configuration is incomplete; set the App ID, installation ID, and private key path',
    );
  }
  throw new GitHubCredentialError(
    'GitHub credentials missing: configure GITHUB_TOKEN or complete GitHub App credentials',
  );
}

type OctokitAppConstructor = new (options: {
  appId: number;
  privateKey: string;
}) => GitHubAppClient;

async function createOctokitApp(options: {
  appId: number;
  privateKey: string;
}): Promise<GitHubAppClient> {
  // @octokit/app is ESM-only; use native dynamic import from this CommonJS project.
  const nativeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ App: OctokitAppConstructor }>;
  const { App } = await nativeImport('@octokit/app');
  return new App(options);
}

/**
 * Produces a fresh bearer token for each read. Octokit's installation client
 * caches the token and refreshes it as it nears expiry.
 */
export function createGitHubTokenProvider(
  env: Env = process.env,
  dependencies: GitHubTokenProviderDependencies = {},
): () => Promise<string> {
  const credential = resolveGitHubCredential(env);
  if (credential.kind === 'token') {
    return async () => credential.token;
  }

  let privateKey: string;
  try {
    privateKey = credential.privateKeyPath
      ? (dependencies.readPrivateKey ?? ((path: string) => readFileSync(resolve(path), 'utf8')))(
          credential.privateKeyPath,
        )
      : credential.privateKey ?? '';
  } catch {
    throw new GitHubCredentialError('Could not read the configured GitHub App private-key file');
  }
  if (!privateKey.trim()) {
    throw new GitHubCredentialError('GitHub App private key is empty or unreadable');
  }

  let installationClient: Promise<InstallationOctokit> | undefined;
  return async () => {
    installationClient ??= Promise.resolve(
      (dependencies.createApp ?? createOctokitApp)({
        appId: credential.appId,
        privateKey,
      }),
    ).then((app) => app.getInstallationOctokit(credential.installationId));
    const octokit = await installationClient;
    const auth = await octokit.auth();
    if (!auth || typeof auth !== 'object' || !('token' in auth)) {
      throw new GitHubCredentialError('GitHub App did not return an installation token');
    }
    const token = (auth as { token?: unknown }).token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new GitHubCredentialError('GitHub App returned an empty installation token');
    }
    return token;
  };
}

/** Legacy synchronous helper for PAT-only scripts. */
export function resolveGitHubToken(env: Env = process.env): string {
  const credential = resolveGitHubCredential(env);
  if (credential.kind !== 'token') {
    throw new GitHubCredentialError(
      'This operation needs an asynchronous token provider for GitHub App credentials',
    );
  }
  return credential.token;
}
