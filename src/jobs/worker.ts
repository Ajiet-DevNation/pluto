import { PgBoss } from 'pg-boss';
import { createJobQueue, ensureJobQueue } from './index.js';
import { indexGitHubIssues } from '../db/index-github-issues.js';
import { getGitHubOrg } from '../config.js';

const QUEUE_NAME = 'index-github-issues';
const SCHEDULE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Singleton lock: prevents overlapping index runs within this process.
let isIndexing = false;

/**
 * Start background jobs for the Pluto backend.
 *
 * Called once at process startup (wired by Pragathi in src/cmd/pluto/index.ts).
 * Connects to pg-boss in polling mode, creates the index-github-issues queue,
 * runs an initial indexing pass, then reschedules every 30 minutes.
 *
 * @param connectionString - Neon PostgreSQL connection string (DATABASE_URL)
 */
export async function startBackgroundJobs(connectionString: string): Promise<void> {
  const boss = createJobQueue(connectionString);
  await ensureJobQueue(boss);

  // Create the queue explicitly at startup before any send/schedule call.
  await boss.createQueue(QUEUE_NAME, {
    retryLimit: 3,
    retryBackoff: true,
  });

  // Run on startup.
  void runIndexingJob(boss, connectionString);

  // Reschedule every 30 minutes.
  setInterval(() => {
    void runIndexingJob(boss, connectionString);
  }, SCHEDULE_INTERVAL_MS);
}

/**
 * Run a single indexing pass. Guards with an in-memory singleton lock so
 * no two index runs overlap within this process.
 */
async function runIndexingJob(boss: PgBoss, connectionString: string): Promise<void> {
  if (isIndexing) {
    console.log('Indexing job already running, skipping (singleton).');
    return;
  }

  isIndexing = true;
  try {
    const GITHUB_ORG = getGitHubOrg();
    const results = await indexGitHubIssues(connectionString, { org: GITHUB_ORG });
    console.log(`Background job: indexed ${results.length} issues from ${GITHUB_ORG}`);
  } catch (error) {
    console.error('Background indexing job failed:', error);
  } finally {
    isIndexing = false;
  }
}
