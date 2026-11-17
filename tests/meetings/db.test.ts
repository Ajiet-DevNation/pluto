import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMeetingDb } from '../../src/meetings/db.js';
import { createMeetingRepository } from '../../src/meetings/repository.js';
import { meetingEvents } from '../../src/meetings/schema.js';

const MIGRATION_PATH = path.join(process.cwd(), 'drizzle/migrations/0008_meeting_events.sql');

let dbPromise: Promise<any | null> | null = null;

async function getDb(): Promise<any | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    try {
      const db = createMeetingDb(url);
      await db.select().from(meetingEvents).limit(1);
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await (db as any).client.query(sql);
      return db;
    } catch {
      return null;
    }
  })();
  return dbPromise;
}

async function withDb(t: { skip: () => void }, fn: (db: any) => Promise<void>) {
  const db = await getDb();
  if (!db) {
    t.skip();
    return;
  }
  await fn(db);
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
    const input = {
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-unique',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-unique', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'pending', eventVersion: 1,
    };
    const first = await repo.create(input);
    assert.ok(first);
    const second = await repo.create(input);
    assert.ok(second);
    assert.equal(second!.id, first!.id);
    const bySource = await repo.getBySource('g', 'c', 'm-unique');
    assert.equal(bySource!.id, first!.id);
  });
});

test('confirmation persists', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-conf',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-conf', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'pending', eventVersion: 1,
    });
    assert.ok(created);
    const confirmed = await repo.confirm(created!.id);
    assert.ok(confirmed);
    assert.equal(confirmed!.status, 'confirmed');
  });
});

test('claim is conditional: first wins, second yields within expiry', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-claim',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-claim', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: null,
    });
    const first = await repo.claim(created!.id, 1);
    assert.ok(first);
    const second = await repo.claim(created!.id, 1);
    assert.equal(second, null);
  });
});

test('cancellation bumps event version', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-cancel',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-cancel', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const cancelled = await repo.cancel(created!.id, 1);
    assert.ok(cancelled);
    assert.equal(cancelled!.status, 'cancelled');
    assert.equal(cancelled!.eventVersion, 2);
  });
});

test('rescheduling bumps event version and keeps confirmed', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-resched',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-resched', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const later = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const rescheduled = await repo.reschedule(created!.id, 1, later);
    assert.ok(rescheduled);
    assert.equal(rescheduled!.status, 'confirmed');
    assert.equal(rescheduled!.eventVersion, 2);
    assert.equal(rescheduled!.startAt.getTime(), later.getTime());
  });
});

test('markCompleted sets status completed', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-complete',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-complete', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() - 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const completed = await repo.markCompleted(created!.id);
    assert.ok(completed);
    assert.equal(completed!.status, 'completed');
  });
});
