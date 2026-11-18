import express from 'express';
import dotenv from 'dotenv';
import { startDiscordBot } from '../../discord/bot';
import { createDefaultStore } from '../../discord/store';
import { createSearchRuntimeFromEnv } from '../../search/runtime';
import { EmbeddingDeferredError } from '../../search/embedding-errors';

import { uploadRouter } from '../../upload/index';
import { startBackgroundJobs, ensureMeetingReminderQueue } from '../../jobs/worker';
import { getDiscordOutputChannelId, getIndexedChannels } from '../../config';
import { createMeetingDb } from '../../meetings/db';
import { createMeetingRepository } from '../../meetings/repository';
import { startMeetingAnnouncer } from '../../meetings/index';
import { reconcileMeetingReminders } from '../../meetings/reconciliation';
import { createDb } from '../../db/index';
import { createDigestService, type DigestService } from '../../digest/service';
import { listIssuesCreatedBetween } from '../../digest/issues';
import {
  createEventRepository,
  type EventRepository,
} from '../../events/repository';
import {
  createUpcomingRepository,
  type UpcomingRepository,
} from '../../upcoming/repository';

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
let shutdownMeetingAnnouncer: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  const baseStore = createDefaultStore();
  const search = createSearchRuntimeFromEnv();
  const botStore = search?.store ?? baseStore;

  const boss = DATABASE_URL
    ? await startBackgroundJobs(DATABASE_URL, search?.indexer)
    : undefined;

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

  // P3 activity and event awareness. This path needs only the database; it is
  // not gated on Cloudflare credentials or the background worker.
  const db = search?.db ?? (DATABASE_URL ? createDb(DATABASE_URL) : undefined);
  let digestService: DigestService | undefined;
  let upcomingRepository: UpcomingRepository | undefined;
  let eventRepository: EventRepository | undefined;

  if (db) {
    const indexedChannels = getIndexedChannels();
    upcomingRepository = createUpcomingRepository(db);
    eventRepository = createEventRepository(db);
    digestService = createDigestService({
      listIssuesCreatedBetween: (from, to) =>
        listIssuesCreatedBetween(db, from, to),
      listDiscordRecords: () => botStore.listRecords(),
      isOptedOut: (guildId, userId) => botStore.isOptedOut(guildId, userId),
      upcoming: upcomingRepository,
      decisionsChannelId: indexedChannels['#decisions'] ?? null,
      indexedChannelIds: new Set(Object.values(indexedChannels)),
    });
  } else {
    console.warn(
      'DATABASE_URL is not set; /digest, /upcoming and /event are unavailable.',
    );
  }

  const bot = await startDiscordBot({
    store: botStore,
    activity: {
      digest: digestService,
      upcoming: upcomingRepository,
      events: eventRepository,
    },
  });
  shutdownBot = bot.shutdown;

  if (DATABASE_URL && boss) {
    const botUserId = bot.client.user?.id;
    if (!botUserId) {
      throw new Error('Discord client is not ready; cannot start the meeting announcer');
    }

    const meetingRepository = createMeetingRepository(createMeetingDb(DATABASE_URL));
    const outputChannelId = getDiscordOutputChannelId();
    const sendReminder = async (
      channelId: string,
      content: string,
    ): Promise<{ messageId?: string } | null> => {
      const channel = await bot.client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(
          `Meeting reminder target ${channelId} is not a sendable channel visible to the bot`,
        );
      }
      const message = await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
      return { messageId: message.id };
    };

    // The queue must exist before anything schedules a reminder. The worker
    // itself is registered by startMeetingAnnouncer, which owns the listener
    // and worker lifecycle together.
    await ensureMeetingReminderQueue(boss);

    const announcer = startMeetingAnnouncer({
      client: bot.client,
      repository: meetingRepository,
      boss,
      botUserId,
      isOptedOut: (guildId, userId) => bot.store.isOptedOut(guildId, userId),
      sendReminder,
      outputChannelId,
    });
    shutdownMeetingAnnouncer = announcer.shutdown;

    await reconcileMeetingReminders({
      repository: meetingRepository,
      boss,
    });
  }
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
  if (shutdownMeetingAnnouncer) {
    await shutdownMeetingAnnouncer();
  }
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
