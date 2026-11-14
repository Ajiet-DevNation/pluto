/**
 * Read-only verification for the GitHub credential.
 *
 * Proves two things:
 *   1. The credential can read the target repository.
 *   2. The credential cannot write to it.
 *
 * The write probe is opt-in because it issues a real POST that must be rejected.
 * Only run it with a credential you believe is read-only.
 *
 *   npx tsx scripts/verify-github-readonly.ts
 *   npx tsx scripts/verify-github-readonly.ts --probe-write
 */
import 'dotenv/config';
import { createGitHubTokenProvider } from '../src/github/app';
import { createGitHubReader } from '../src/github/reader';

const OWNER = process.env.VERIFY_GITHUB_OWNER ?? 'Ajiet-DevNation';
const REPO = process.env.VERIFY_GITHUB_REPO ?? 'pluto';
const BASE = 'https://api.github.com';

async function main(): Promise<void> {
  const tokenProvider = createGitHubTokenProvider();
  const reader = createGitHubReader({ tokenProvider });

  const repo = await reader.getRepo(OWNER, REPO);
  console.log(`read: 200 — ${repo.fullName} (private=${repo.private})`);

  const issues = await reader.listIssues(OWNER, REPO);
  console.log(`issues read: 200 — ${issues.length} issue(s) returned`);

  if (!process.argv.includes('--probe-write')) {
    console.log('write probe: skipped (pass --probe-write to attempt a rejected write)');
    return;
  }

  const token = await tokenProvider();
  console.log(`write probe: POST ${BASE}/repos/${OWNER}/${REPO}/issues`);
  const response = await fetch(`${BASE}/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'pluto-readonly-verify',
    },
    body: JSON.stringify({ title: 'read-only boundary probe — must be rejected' }),
  });

  console.log(`write attempt: ${response.status}`);

  if (response.status === 201) {
    console.error('FAIL: the credential can write. Revoke it and issue a read-only credential.');
    process.exitCode = 1;
    return;
  }

  if (response.status !== 403 && response.status !== 404) {
    console.error(`UNEXPECTED: expected 403 or 404, got ${response.status}`);
    process.exitCode = 1;
    return;
  }

  console.log('PASS: write rejected, credential is read-only');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
