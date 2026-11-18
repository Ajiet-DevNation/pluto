import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createDb, type Db } from '../../src/db/index.js';
import { createEventRepository } from '../../src/events/repository.js';
import { createUpcomingRepository } from '../../src/upcoming/repository.js';

dotenv.config({ quiet: true });

const EVENTS_MIGRATION = path.join(
  process.cwd(),
  'drizzle/migrations/0009_events.sql',
);
const MEETINGS_MIGRATION = path.join(
  process.cwd(),
  'drizzle/migrations/0008_meeting_events.sql',
);

let dbPromise: Promise<Db | null> | null = null;

async function getDb(): Promise<Db | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const db = createDb(url);
    await db.$client.query(fs.readFileSync(EVENTS_MIGRATION, 'utf8'));
    // meeting_events is an L3 dependency. Apply its migration only when the
    // table is absent, so the common case needs no concurrent DDL.
    const existing = await db.$client.query(
      "SELECT to_regclass('public.meeting_events') AS table_name",
    );
    if (!existing.rows[0]?.table_name) {
      await db.$client.query(fs.readFileSync(MEETINGS_MIGRATION, 'utf8'));
    }
    return db;
  })();
  return dbPromise;
}

async function withDb(
  t: { skip: () => void },
  fn: (db: Db) => Promise<void>,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    t.skip();
    return;
  }
  await fn(db);
}

function uniqueGuild(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertMeeting(
  db: Db,
  input: {
    guildId: string;
    sourceMessageId: string;
    title: string;
    startAt: Date;
    status: string;
  },
): Promise<void> {
  await db.$client.query(
    `INSERT INTO meeting_events
       (guild_id, channel_id, source_message_id, source_message_url, created_by,
        title, start_at, timezone, status, event_version, reminder_sent_at)
     VALUES ($1, '1570872485933752502', $2, $3, 'announcer',
             $4, $5, 'Asia/Kolkata', $6, 1, now())`,
    [
      input.guildId,
      input.sourceMessageId,
      `https://discord.com/channels/${input.guildId}/1570872485933752502/${input.sourceMessageId}`,
      input.title,
      input.startAt,
      input.status,
    ],
  );
}

async function cleanup(db: Db, guildId: string): Promise<void> {
  try {
    await db.$client.query('DELETE FROM events WHERE guild_id = $1', [guildId]);
    await db.$client.query('DELETE FROM meeting_events WHERE guild_id = $1', [
      guildId,
    ]);
  } catch {
    // Best-effort cleanup.
  }
}

test('/upcoming meetings reads confirmed future meetings only', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-meetings');
    const otherGuild = uniqueGuild('p3-other');
    const now = new Date();
    const hour = 60 * 60 * 1000;
    const repository = createUpcomingRepository(db);

    try {
      await insertMeeting(db, {
        guildId,
        sourceMessageId: `${guildId}-confirmed`,
        title: 'Confirmed future',
        startAt: new Date(now.getTime() + 2 * hour),
        status: 'confirmed',
      });
      await insertMeeting(db, {
        guildId,
        sourceMessageId: `${guildId}-past`,
        title: 'Past confirmed',
        startAt: new Date(now.getTime() - hour),
        status: 'confirmed',
      });
      await insertMeeting(db, {
        guildId,
        sourceMessageId: `${guildId}-cancelled`,
        title: 'Cancelled future',
        startAt: new Date(now.getTime() + 3 * hour),
        status: 'cancelled',
      });
      await insertMeeting(db, {
        guildId,
        sourceMessageId: `${guildId}-completed`,
        title: 'Completed future',
        startAt: new Date(now.getTime() + 4 * hour),
        status: 'completed',
      });
      await insertMeeting(db, {
        guildId: otherGuild,
        sourceMessageId: `${otherGuild}-confirmed`,
        title: 'Other guild',
        startAt: new Date(now.getTime() + 5 * hour),
        status: 'confirmed',
      });

      const meetings = await repository.listMeetings(guildId, now);
      assert.deepEqual(
        meetings.map((meeting) => meeting.title),
        ['Confirmed future'],
      );
      assert.match(
        meetings[0].sourceMessageUrl,
        /discord\.com\/channels\//,
      );
      assert.equal(await repository.countMeetings(guildId, now), 1);
    } finally {
      await cleanup(db, guildId);
      await cleanup(db, otherGuild);
    }
  });
});

test('/upcoming events reads scheduled future or ongoing rows for one guild', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-events-upcoming');
    const now = new Date();
    const hour = 60 * 60 * 1000;
    const eventRepository = createEventRepository(db);
    const repository = createUpcomingRepository(db);

    try {
      await eventRepository.create({
        guildId,
        title: 'Ongoing',
        startAt: new Date(now.getTime() - hour),
        endAt: new Date(now.getTime() + hour),
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'scheduled',
      });
      await eventRepository.create({
        guildId,
        title: 'Future',
        startAt: new Date(now.getTime() + 2 * hour),
        endAt: null,
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'scheduled',
      });
      await eventRepository.create({
        guildId,
        title: 'Ended',
        startAt: new Date(now.getTime() - 3 * hour),
        endAt: new Date(now.getTime() - hour),
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'scheduled',
      });
      await eventRepository.create({
        guildId,
        title: 'Cancelled',
        startAt: new Date(now.getTime() + 3 * hour),
        endAt: null,
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'cancelled',
      });

      const events = await repository.listEvents(guildId, now);
      assert.deepEqual(
        events.map((event) => event.title),
        ['Ongoing', 'Future'],
      );
      assert.equal(await repository.countEvents(guildId, now), 2);
    } finally {
      await cleanup(db, guildId);
    }
  });
});
