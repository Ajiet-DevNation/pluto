import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createDb, type Db } from '../../src/db/index.js';
import { createEventRepository } from '../../src/events/repository.js';

dotenv.config({ quiet: true });

const EVENTS_MIGRATION = path.join(
  process.cwd(),
  'drizzle/migrations/0009_events.sql',
);

let dbPromise: Promise<Db | null> | null = null;

async function getDb(): Promise<Db | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const db = createDb(url);
    await db.$client.query(fs.readFileSync(EVENTS_MIGRATION, 'utf8'));
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

test('P3 events migration applies and the repository round-trips', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-events');
    const repository = createEventRepository(db);
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    try {
      const created = await repository.create({
        guildId,
        title: 'Hackathon',
        description: 'Bring a laptop.',
        startAt: start,
        endAt: end,
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'scheduled',
      });

      assert.equal(created.guildId, guildId);
      assert.equal(created.title, 'Hackathon');
      assert.equal(created.description, 'Bring a laptop.');
      assert.equal(created.timezone, 'Asia/Kolkata');
      assert.equal(created.status, 'scheduled');
      assert.equal(created.startAt.getTime(), start.getTime());
      assert.equal(created.endAt?.getTime(), end.getTime());
    } finally {
      await cleanup(db, guildId);
    }
  });
});

test('/upcoming events selects scheduled future or ongoing rows only', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-upcoming');
    const repository = createEventRepository(db);
    const now = new Date();
    const hour = 60 * 60 * 1000;

    const create = (
      title: string,
      startAt: Date,
      endAt: Date | null,
      status: string,
    ) =>
      repository.create({
        guildId,
        title,
        startAt,
        endAt,
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status,
      });

    try {
      await create(
        'Ongoing',
        new Date(now.getTime() - hour),
        new Date(now.getTime() + hour),
        'scheduled',
      );
      await create(
        'Future',
        new Date(now.getTime() + 2 * hour),
        new Date(now.getTime() + 3 * hour),
        'scheduled',
      );
      await create(
        'Future without end',
        new Date(now.getTime() + 4 * hour),
        null,
        'scheduled',
      );
      await create(
        'Ended',
        new Date(now.getTime() - 3 * hour),
        new Date(now.getTime() - hour),
        'scheduled',
      );
      await create(
        'Cancelled',
        new Date(now.getTime() + 5 * hour),
        null,
        'cancelled',
      );
      await create(
        'Completed',
        new Date(now.getTime() + 6 * hour),
        null,
        'completed',
      );

      const upcoming = await repository.listUpcoming(guildId, now);
      assert.deepEqual(
        upcoming.map((event) => event.title),
        ['Ongoing', 'Future', 'Future without end'],
      );
      assert.equal(await repository.countUpcoming(guildId, now), 3);
      assert.equal((await repository.listUpcoming(guildId, now, 2)).length, 2);
    } finally {
      await cleanup(db, guildId);
    }
  });
});

test('cancel marks a scheduled event cancelled and removes it from upcoming lists', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-cancel');
    const repository = createEventRepository(db);
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);

    try {
      const created = await repository.create({
        guildId,
        title: 'Cancel me',
        startAt: start,
        endAt: new Date(start.getTime() + 60 * 60 * 1000),
        timezone: 'Asia/Kolkata',
        createdBy: 'organizer',
        status: 'scheduled',
      });

      const byId = await repository.getById(guildId, created.id);
      assert.equal(byId?.title, 'Cancel me');
      assert.equal(
        await repository.getById('some-other-guild', created.id),
        null,
      );

      const cancelled = await repository.cancel(guildId, created.id);
      assert.equal(cancelled?.status, 'cancelled');
      assert.equal(cancelled?.id, created.id);

      const afterCancel = await repository.getById(guildId, created.id);
      assert.equal(afterCancel?.status, 'cancelled');
      assert.equal(await repository.cancel(guildId, created.id), null);
      assert.equal(
        await repository.cancel('some-other-guild', created.id),
        null,
      );

      const upcoming = await repository.listUpcoming(guildId, new Date());
      assert.equal(upcoming.length, 0);
      assert.equal(await repository.countUpcoming(guildId, new Date()), 0);
    } finally {
      await cleanup(db, guildId);
    }
  });
});

test('the database enforces end-after-start and the IST timezone', async (t) => {
  await withDb(t, async (db) => {
    const guildId = uniqueGuild('p3-checks');
    const repository = createEventRepository(db);
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);

    try {
      await assert.rejects(
        repository.create({
          guildId,
          title: 'Bad end',
          startAt: start,
          endAt: new Date(start.getTime() - 60_000),
          timezone: 'Asia/Kolkata',
          createdBy: 'organizer',
          status: 'scheduled',
        }),
        (error: unknown) => {
          const cause = (error as { cause?: { message?: string } }).cause;
          assert.match(
            cause?.message ?? String(error),
            /events_end_after_start_check/,
          );
          return true;
        },
      );

      await assert.rejects(
        repository.create({
          guildId,
          title: 'Bad timezone',
          startAt: start,
          timezone: 'UTC',
          createdBy: 'organizer',
          status: 'scheduled',
        }),
        (error: unknown) => {
          const cause = (error as { cause?: { message?: string } }).cause;
          assert.match(cause?.message ?? String(error), /events_timezone_check/);
          return true;
        },
      );
    } finally {
      await cleanup(db, guildId);
    }
  });
});
