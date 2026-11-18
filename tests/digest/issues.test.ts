import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createDb, type Db } from '../../src/db/index.js';
import { issues, repositories } from '../../src/db/schema.js';
import { listIssuesCreatedBetween } from '../../src/digest/issues.js';

dotenv.config({ quiet: true });

let dbPromise: Promise<Db | null> | null = null;

async function getDb(): Promise<Db | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const db = createDb(url);
    // Fail early and visibly if the baseline schema is missing.
    await db.select().from(issues).limit(1);
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

function uniqueNumber(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

test('digest issue query counts only issues created inside the window', async (t) => {
  await withDb(t, async (db) => {
    const githubId = uniqueNumber();
    const fullName = `Ajiet-DevNation/p3-digest-${githubId}`;
    let repositoryId: number | undefined;

    try {
      const [repository] = await db
        .insert(repositories)
        .values({
          githubId,
          name: `p3-digest-${githubId}`,
          fullName,
          owner: 'Ajiet-DevNation',
          htmlUrl: `https://github.com/${fullName}`,
        })
        .returning();
      repositoryId = repository.id;

      const inside = new Date('2026-11-17T06:30:00.000Z');
      const outside = new Date('2026-10-01T06:30:00.000Z');

      await db.insert(issues).values([
        {
          githubId: githubId + 1,
          repositoryId,
          number: 1,
          title: 'Inside',
          body: null,
          state: 'open',
          htmlUrl: `https://github.com/${fullName}/issues/1`,
          createdAt: inside,
          updatedAt: inside,
        },
        {
          githubId: githubId + 2,
          repositoryId,
          number: 2,
          title: 'Outside',
          body: null,
          state: 'open',
          htmlUrl: `https://github.com/${fullName}/issues/2`,
          createdAt: outside,
          updatedAt: outside,
        },
      ]);

      const rows = await listIssuesCreatedBetween(
        db,
        new Date('2026-11-11T06:30:00.000Z'),
        new Date('2026-11-18T06:30:00.000Z'),
      );

      const mine = rows.filter((row) => row.repositoryFullName === fullName);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].number, 1);
      assert.equal(mine[0].title, 'Inside');
    } finally {
      if (repositoryId !== undefined) {
        await db.$client.query('DELETE FROM issues WHERE repository_id = $1', [
          repositoryId,
        ]);
        await db.$client.query('DELETE FROM repositories WHERE id = $1', [
          repositoryId,
        ]);
      }
    }
  });
});
