/**
 * GitHub credential resolution.
 *
 * Two credential shapes exist:
 *   - GITHUB_TOKEN: a read-only fine-grained PAT. Supported today.
 *   - GITHUB_APP_ID + GITHUB_PRIVATE_KEY: a read-only GitHub App. The App does
 *     not exist yet (requires an Ajiet-DevNation org owner), so the token path
 *     is what runs in K2 and L1. App wiring lands when the App is created.
 *
 * Missing credentials throw. Never fall back to an unauthenticated client or an
 * empty result: a silent empty result is indistinguishable from a successful
 * query that found nothing.
 */

export class GitHubCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubCredentialError';
  }
}

export type GitHubCredential =
  | { kind: 'token'; token: string }
  | { kind: 'app'; appId: number; privateKey: string };

type Env = Record<string, string | undefined>;

export function resolveGitHubCredential(env: Env = process.env): GitHubCredential {
  const token = env.GITHUB_TOKEN?.trim();
  if (token) {
    return { kind: 'token', token };
  }

  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_PRIVATE_KEY?.trim();

  if (appId && privateKey) {
    throw new GitHubCredentialError(
      'GitHub App credentials are present but App auth is not wired in this package yet. ' +
        'Set GITHUB_TOKEN (read-only fine-grained PAT) until the App is created.',
    );
  }

  throw new GitHubCredentialError(
    'GitHub credentials missing: set GITHUB_TOKEN (read-only fine-grained PAT) ' +
      'or GITHUB_APP_ID + GITHUB_PRIVATE_KEY once the App exists.',
  );
}

/**
 * Resolve a bearer token for GitHub REST reads.
 */
export function resolveGitHubToken(env: Env = process.env): string {
  const credential = resolveGitHubCredential(env);
  if (credential.kind !== 'token') {
    throw new GitHubCredentialError('Expected a token credential');
  }
  return credential.token;
}
