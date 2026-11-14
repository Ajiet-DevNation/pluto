import express from 'express';
import dotenv from 'dotenv';
import { startDiscordBot } from '../../discord/bot';
import { createDefaultStore } from '../../discord/store';
import { createSearchRuntimeFromEnv } from '../../search/runtime';
import { EmbeddingDeferredError } from '../../search/embedding-errors';

import { uploadRouter } from '../../upload/index';
import { startBackgroundJobs } from '../../jobs/worker';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pluto-backend' });
});

app.use(express.json());
app.use('/upload', uploadRouter);

const DATABASE_URL = process.env.DATABASE_URL;

const server = app.listen(PORT, () => {
  console.log(`Pluto backend running on port ${PORT}`);
});

let shutdownBot: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  const baseStore = createDefaultStore();
  const search = createSearchRuntimeFromEnv();

  if (DATABASE_URL) {
    await startBackgroundJobs(DATABASE_URL, search?.indexer);
  }

  if (search) {
    // P1 records predate search_chunks; bring them over once before intake
    // starts writing new rows.
    const records = await baseStore.listRecords();
    search.indexer.beginEmbeddingRun?.();
    try {
      await search.syncDiscord(records);
      console.log(`Search index synced for ${records.length} Discord records`);
    } catch (error) {
      if (!(error instanceof EmbeddingDeferredError)) throw error;
      console.warn(
        `Discord search sync paused (${error.reason}); Pluto will start and resume indexing later, after ${error.resumeAt.toISOString()}.`,
      );
    }
  }

  const bot = await startDiscordBot({
    store: search?.store ?? baseStore,
    askService: search?.askService,
  });
  shutdownBot = bot.shutdown;
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pluto failed to start: ${message}`);
  server.close();
  process.exitCode = 1;
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down Pluto`);
  server.close();
  if (shutdownBot) {
    await shutdownBot();
  }
  process.exit(0);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
