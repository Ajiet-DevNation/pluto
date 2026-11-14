import { PgBoss } from 'pg-boss';
import { createJobQueue, ensureJobQueue } from './index.js';
import { indexGitHubIssues } from '../db/index-github-issues.js';
import { indexMeetingTranscript } from '../db/index-meeting-transcripts.js';
import { getGitHubOrg } from '../config.js';
import type { SourceIndexer } from '../search/types.js';

const GITHUB_ISSUES_QUEUE = 'index-github-issues';
const TRANSCRIPT_INDEX_QUEUE = 'index-transcript';
const SCHEDULE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Singleton locks: prevents overlapping runs within this process.
let isIndexingGitHubIssues = false;
let isIndexingTranscript = false;

/**
 * Start background jobs for the Pluto backend.
 *
 * Called once at process startup. Connects to pg-boss in polling mode,
 * creates both queues, runs an initial GitHub issues indexing pass, then
 * reschedules every 30 minutes.
 */
export async function startBackgroundJobs(
  connectionString: string,
  searchIndexer?: Pick<SourceIndexer, 'indexGitHubIssue'>,
): Promise<void> {
  const boss = createJobQueue(connectionString);
  await ensureJobQueue(boss);

  await boss.createQueue(GITHUB_ISSUES_QUEUE, {
    retryLimit: 3,
    retryBackoff: true,
  });
  await boss.createQueue(TRANSCRIPT_INDEX_QUEUE, {
    retryLimit: 3,
    retryBackoff: true,
  });

  void runGitHubIssuesJob(boss, connectionString, searchIndexer);
  setInterval(() => {
    void runGitHubIssuesJob(boss, connectionString, searchIndexer);
  }, SCHEDULE_INTERVAL_MS);
}

async function runGitHubIssuesJob(
  boss: PgBoss,
  connectionString: string,
  searchIndexer?: Pick<SourceIndexer, 'indexGitHubIssue'>,
): Promise<void> {
  if (isIndexingGitHubIssues) {
    console.log('GitHub issues indexing already running, skipping (singleton).');
    return;
  }

  isIndexingGitHubIssues = true;
  try {
    const org = getGitHubOrg();
    const results = await indexGitHubIssues(connectionString, { org, searchIndexer });
    console.log(`Background job: indexed ${results.length} issues from ${org}`);
  } catch (error) {
    console.error('Background GitHub issues indexing job failed:', error);
  } finally {
    isIndexingGitHubIssues = false;
  }
}

/**
 * Process a transcript indexing job: chunk, embed, store chunks in search_chunks.
 * Payload: { meetingId, title, content, source, sourceUrl?, audioFilename?, audioDurationSeconds?, language?, transcribedAt? }
 */
export async function processIndexTranscriptJob(
  boss: PgBoss,
  payload: {
    meetingId: string;
    title: string;
    content: string;
    source: string;
    sourceUrl?: string;
    audioFilename?: string;
    audioDurationSeconds?: number;
    language?: string;
    transcribedAt?: Date;
  },
): Promise<void> {
  if (isIndexingTranscript) {
    console.log('Transcript indexing already running, skipping (singleton).');
    return;
  }

  isIndexingTranscript = true;
  try {
    const result = await indexMeetingTranscript({
      title: payload.title,
      content: payload.content,
      source: payload.source,
      sourceUrl: payload.sourceUrl,
      audioFilename: payload.audioFilename,
      audioDurationSeconds: payload.audioDurationSeconds,
      language: payload.language,
      transcribedAt: payload.transcribedAt,
    });
    console.log(`Background job: indexed ${result.chunks} chunks from meeting "${result.title}"`);
  } catch (error) {
    console.error('Background transcript indexing job failed:', error);
    throw error;
  } finally {
    isIndexingTranscript = false;
  }
}
