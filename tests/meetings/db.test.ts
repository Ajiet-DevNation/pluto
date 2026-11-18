import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createMeetingDb } from '../../src/meetings/db.js';
import { createMeetingRepository } from '../../src/meetings/repository.js';
import { meetingEvents } from '../../src/meetings/schema.js';

// These are integration tests against a real PostgreSQL database. Load the
// same local .env the application entrypoints use; an exported DATABASE_URL
// still takes precedence because dotenv does not override existing values.
dotenv.config({ quiet: true });

const MIGRATION_PATH = path.join(process.cwd(), 'drizzle/migrations/0008_meeting_events.sql');

let dbPromise: Promise<any | null> | null = null;

/**
 * Connect to the test database and apply the migration FIRST, then verify
 * the table is queryable. Running the migration before any query means this
 * works on a fresh database.
 */
async function getDb(): Promise<any | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    try {
      const db = createMeetingDb(url);
      // Apply the migration first so the table exists on a fresh database.
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await db.$client.query(sql);
      // Now verify the table is queryable.
      await db.select().from(meetingEvents).limit(1);
      return db;
    } catch (error) {
      // Re-throw so the caller can distinguish "no database" from "migration/query failure".
      throw error;
    }
  })();
  return dbPromise;
}

async function withDb(t: { skip: () => void }, fn: (db: any) => Promise<void>) {
  try {
    const db = await getDb();
    if (!db) {
      t.skip();
      return;
    }
    await fn(db);
  } catch (error) {
    // Database is configured but migration or query failed — fail visibly.
    throw error;
  }
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupRepo(db: any, sourceMessageIds: string[]) {
  const repo = createMeetingRepository(db);
  for (const id of sourceMessageIds) {
    try {
      await db.$client.query(
        'DELETE FROM meeting_events WHERE source_message_id = $1',
        [id],
      );
    } catch {
      // Best-effort cleanup.
    }
  }
}

test('migration applies and meeting_events table exists', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const row = await repo.getBySource('g', 'c', 'm');
    assert.equal(row, null);
  });
});

test('unique source identity prevents duplicate events', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-unique');
    const input = {
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    };
    const first = await repo.create(input);
    assert.ok(first);
    const second = await repo.create(input);
    assert.ok(second);
    assert.equal(second!.id, first!.id);
    const bySource = await repo.getBySource('g', 'c', msgId);
    assert.equal(bySource!.id, first!.id);
    await cleanupRepo(db, [msgId]);
  });
});

test('event is created with confirmed status and version 1', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-status');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    assert.ok(created);
    assert.equal(created!.status, 'confirmed');
    assert.equal(created!.eventVersion, 1);
    await cleanupRepo(db, [msgId]);
  });
});

test('claim is conditional: first wins, second yields within expiry', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-claim');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: null,
    });
    const first = await repo.claim(created!.id, 1);
    assert.ok(first, 'first claim should win');
    const second = await repo.claim(created!.id, 1);
    assert.equal(second, null, 'second claim within expiry should yield');
    await cleanupRepo(db, [msgId]);
  });
});

test('claim with wrong version yields', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-wrongver');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: null,
    });
    const claimed = await repo.claim(created!.id, 99);
    assert.equal(claimed, null, 'claim with wrong version should yield');
    await cleanupRepo(db, [msgId]);
  });
});

test('markSent persists reminder_sent_at and reminder_message_id', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-sent');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const marked = await repo.markSent(created!.id, 'msg-100');
    assert.ok(marked);
    assert.ok(marked!.reminderSentAt);
    assert.equal(marked!.reminderMessageId, 'msg-100');
    await cleanupRepo(db, [msgId]);
  });
});

test('markSent is idempotent: second call does not overwrite', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-idem');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const first = await repo.markSent(created!.id, 'msg-100');
    assert.ok(first);
    assert.equal(first!.reminderMessageId, 'msg-100');
    const second = await repo.markSent(created!.id, 'msg-200');
    assert.equal(second, null, 'second markSent should not overwrite');
    await cleanupRepo(db, [msgId]);
  });
});

test('markCompleted sets status completed', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const msgId = uniqueId('m-complete');
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: msgId,
      sourceMessageUrl: `https://discord.com/channels/g/c/${msgId}`, createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() - 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const completed = await repo.markCompleted(created!.id);
    assert.ok(completed);
    assert.equal(completed!.status, 'completed');
    await cleanupRepo(db, [msgId]);
  });
});

test('listUnremindedFuture returns only confirmed, unsent, future events', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const now = new Date();
    const future = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 60 * 60 * 1000);
    const ids: string[] = [];

    const m1 = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: uniqueId('m-future'),
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-future', createdBy: 'u1',
      title: 'Future', startAt: future, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    ids.push(m1!.sourceMessageId);
    const m2 = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: uniqueId('m-past'),
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-past', createdBy: 'u1',
      title: 'Past', startAt: past, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    ids.push(m2!.sourceMessageId);
    const m3 = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: uniqueId('m-sent'),
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-sent', createdBy: 'u1',
      title: 'Sent', startAt: future, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: new Date(),
    });
    ids.push(m3!.sourceMessageId);
    const m4 = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: uniqueId('m-cancelled'),
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-cancelled', createdBy: 'u1',
      title: 'Cancelled', startAt: future, timezone: 'Asia/Kolkata', status: 'cancelled', eventVersion: 1,
    });
    ids.push(m4!.sourceMessageId);

    const unreminded = await repo.listUnremindedFuture();
    assert.equal(unreminded.length, 1);
    assert.equal(unreminded[0].title, 'Future');
    await cleanupRepo(db, ids);
  });
});

test('schema has status and timezone constraints', async (t) => {
  await withDb(t, async (db) => {
    // Attempt to insert an invalid status — should fail the check constraint.
    await assert.rejects(
      db.$client.query(
        `INSERT INTO meeting_events (id, guild_id, channel_id, source_message_id, source_message_url, created_by, title, start_at, timezone, status, event_version) VALUES (gen_random_uuid(), 'g', 'c', 'm-bad-status', 'https://x', 'u1', 't', now(), 'Asia/Kolkata', 'invalid_status', 1)`,
      ),
      /violates check constraint/,
    );
    // Attempt to insert a wrong timezone — should fail the check constraint.
    await assert.rejects(
      db.$client.query(
        `INSERT INTO meeting_events (id, guild_id, channel_id, source_message_id, source_message_url, created_by, title, start_at, timezone, status, event_version) VALUES (gen_random_uuid(), 'g', 'c', 'm-bad-tz', 'https://x', 'u1', 't', now(), 'UTC', 'confirmed', 1)`,
      ),
      /violates check constraint/,
    );
  });
});

test('unique source-message index prevents duplicates at SQL level', async (t) => {
  await withDb(t, async (db) => {
    const msgId = uniqueId('m-sql-unique');
    await db.$client.query(
      `INSERT INTO meeting_events (id, guild_id, channel_id, source_message_id, source_message_url, created_by, title, start_at, timezone, status, event_version) VALUES (gen_random_uuid(), 'g', 'c', $1, 'https://x', 'u1', 't', now(), 'Asia/Kolkata', 'confirmed', 1)`,
      [msgId],
    );
    await assert.rejects(
      db.$client.query(
        `INSERT INTO meeting_events (id, guild_id, channel_id, source_message_id, source_message_url, created_by, title, start_at, timezone, status, event_version) VALUES (gen_random_uuid(), 'g', 'c', $1, 'https://x', 'u1', 't', now(), 'Asia/Kolkata', 'confirmed', 1)`,
        [msgId],
      ),
      /duplicate key/,
    );
    await cleanupRepo(db, [msgId]);
  });
});
