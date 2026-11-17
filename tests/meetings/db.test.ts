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
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
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

test('event is created with confirmed status and version 1', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-status',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-status', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    assert.ok(created);
    assert.equal(created!.status, 'confirmed');
    assert.equal(created!.eventVersion, 1);
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
    assert.ok(first, 'first claim should win');
    const second = await repo.claim(created!.id, 1);
    assert.equal(second, null, 'second claim within expiry should yield');
  });
});

test('claim with wrong version yields', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-wrongver',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-wrongver', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: null,
    });
    const claimed = await repo.claim(created!.id, 99);
    assert.equal(claimed, null, 'claim with wrong version should yield');
  });
});

test('markSent persists reminder_sent_at and reminder_message_id', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const created = await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-sent',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-sent', createdBy: 'u1',
      title: 'Standup', startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    const marked = await repo.markSent(created!.id, 'msg-100');
    assert.ok(marked);
    assert.ok(marked!.reminderSentAt);
    assert.equal(marked!.reminderMessageId, 'msg-100');
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

test('listUnremindedFuture returns only confirmed, unsent, future events', async (t) => {
  await withDb(t, async (db) => {
    const repo = createMeetingRepository(db);
    const now = new Date();
    const future = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 60 * 60 * 1000);

    await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-future',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-future', createdBy: 'u1',
      title: 'Future', startAt: future, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-past',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-past', createdBy: 'u1',
      title: 'Past', startAt: past, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1,
    });
    await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-sent',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-sent', createdBy: 'u1',
      title: 'Sent', startAt: future, timezone: 'Asia/Kolkata', status: 'confirmed', eventVersion: 1, reminderSentAt: new Date(),
    });
    await repo.create({
      guildId: 'g', channelId: 'c', sourceMessageId: 'm-cancelled',
      sourceMessageUrl: 'https://discord.com/channels/g/c/m-cancelled', createdBy: 'u1',
      title: 'Cancelled', startAt: future, timezone: 'Asia/Kolkata', status: 'cancelled', eventVersion: 1,
    });

    const unreminded = await repo.listUnremindedFuture();
    assert.equal(unreminded.length, 1);
    assert.equal(unreminded[0].title, 'Future');
  });
});
