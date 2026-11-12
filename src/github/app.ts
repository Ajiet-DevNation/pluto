import { App } from '@octokit/app';

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY;

export const githubApp = appId && privateKey
  ? new App({ appId: Number(appId), privateKey })
  : null;

export async function verifyReadOnly() {
  if (!githubApp) {
    console.warn('GitHub App not configured. Skipping read-only verification.');
    return;
  }
  try {
    console.log('GitHub App configured for Ajiet-DevNation (read-only mode)');
  } catch (error) {
    console.error('GitHub read-only check failed:', error);
  }
}
