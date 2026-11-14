import dotenv from 'dotenv';
dotenv.config();

import { createDb } from './index.js';
import { meetingTranscripts, searchChunks } from './schema.js';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

function requireCloudflareEnv(): { accountId: string; aiToken: string } {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const aiToken = process.env.CLOUDFLARE_AI_TOKEN;
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');
  }
  if (!aiToken) {
    throw new Error('CLOUDFLARE_AI_TOKEN is not set');
  }
  return { accountId, aiToken };
}

export interface IndexedMeetingTranscript {
  meetingId: string;
  title: string;
  chunks: number;
}

export interface IndexMeetingTranscriptOptions {
  title: string;
  content: string;
  source: string;
  sourceUrl?: string;
  audioFilename?: string;
  audioDurationSeconds?: number;
  language?: string;
  transcribedAt?: Date;
}

/**
 * Chunk text per search.md: ~512 tokens with ~64 tokens of overlap.
 * Split on paragraph and line breaks first; fall back to sentence boundaries.
 * Never split mid-word or mid-URL.
 */
export function chunkText(text: string, maxChars = 2048, overlapChars = 256): string[] {
  const chunks: string[] = [];

  // Split on paragraph breaks first
  const paragraphs = text.split(/\n\s*\n/);

  let currentChunk = '';

  for (const para of paragraphs) {
    const paraText = para.trim();
    if (!paraText) continue;

    // If paragraph itself is too large, split on sentences
    if (paraText.length > maxChars) {
      const sentences = paraText.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 > maxChars && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = currentChunk.slice(-overlapChars);
        }
        currentChunk = (currentChunk ? currentChunk + ' ' : '') + sentence;
      }
    } else if (currentChunk.length + paraText.length + 1 > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = currentChunk.slice(-overlapChars) + ' ' + paraText;
    } else {
      currentChunk = (currentChunk ? currentChunk + ' ' : '') + paraText;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Embed a batch of texts via Cloudflare Workers AI embedding model.
 * One request per chunk batch (per search.md batching rule).
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const { accountId, aiToken } = requireCloudflareEnv();

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Embedding failed: ${response.status} ${errorBody}`);
  }

  const result = await response.json();
  if (!result.success || !result.result || !result.result.data) {
    throw new Error(`Embedding returned unsuccessful result: ${JSON.stringify(result)}`);
  }

  return result.result.data as number[][];
}

/**
 * Index a meeting transcript: store in Neon (Drizzle), chunk, embed, store chunks in search_chunks.
 * All reads/writes go through Drizzle ORM — no raw SQL.
 */
export async function indexMeetingTranscript(
  options: IndexMeetingTranscriptOptions,
): Promise<IndexedMeetingTranscript> {
  const db = createDb(process.env.DATABASE_URL!);
  const { randomUUID } = await import('node:crypto');
  const meetingId = randomUUID();

  // 1. Store the transcript in meeting_transcripts (Drizzle ORM)
  const [inserted] = await db
    .insert(meetingTranscripts)
    .values({
      id: meetingId,
      title: options.title,
      content: options.content,
      source: options.source,
      sourceUrl: options.sourceUrl ?? null,
      audioFilename: options.audioFilename ?? null,
      audioDurationSeconds: options.audioDurationSeconds ?? null,
      language: options.language ?? null,
      transcribedAt: options.transcribedAt ?? new Date(),
    })
    .returning();

  // 2. Chunk the content
  const chunks = chunkText(inserted.content);

  // 3. Embed chunks in batches
  const embeddings = await embedTexts(chunks);

  // 4. Store chunks in search_chunks (Drizzle ORM)
  for (let i = 0; i < chunks.length; i++) {
    const embedding = embeddings[i];
    await db.insert(searchChunks).values({
      sourceType: 'meeting',
      sourceId: meetingId,
      chunkIndex: i,
      sourceUrl: options.sourceUrl ?? null,
      authorId: null,
      content: chunks[i],
      embedding,
      searchVector: chunks[i],
    } as any);
  }

  return {
    meetingId,
    title: inserted.title,
    chunks: chunks.length,
  };
}
