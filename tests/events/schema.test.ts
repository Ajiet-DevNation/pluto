import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { events } from '../../src/events/schema';

test('events schema matches the P3 manual-event contract', () => {
  assert.ok(events);
  assert.ok(events.id);
  assert.ok(events.guildId);
  assert.ok(events.title);
  assert.ok(events.description);
  assert.ok(events.startAt);
  assert.ok(events.endAt);
  assert.ok(events.timezone);
  assert.ok(events.createdBy);
  assert.ok(events.status);
  assert.ok(events.createdAt);
  assert.ok(events.updatedAt);
});

test('events migration creates the table, constraints and lookup index', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'drizzle/migrations/0009_events.sql'),
    'utf8',
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS "events"/);
  assert.match(sql, /"guild_id" text NOT NULL/);
  assert.match(sql, /"title" varchar\(200\) NOT NULL/);
  assert.match(sql, /"start_at" timestamptz NOT NULL/);
  assert.match(sql, /"end_at" timestamptz/);
  assert.match(sql, /"timezone" varchar\(64\) NOT NULL DEFAULT 'Asia\/Kolkata'/);
  assert.match(sql, /"created_by" text NOT NULL/);
  assert.match(sql, /"status" varchar\(20\) NOT NULL DEFAULT 'scheduled'/);
  assert.match(
    sql,
    /CHECK \("status" IN \('scheduled', 'cancelled', 'completed'\)\)/,
  );
  assert.match(sql, /CHECK \("timezone" = 'Asia\/Kolkata'\)/);
  assert.match(
    sql,
    /CHECK \("end_at" IS NULL OR "end_at" > "start_at"\)/,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS "events_guild_start_idx"[\s\S]*"guild_id", "start_at"/,
  );
  // The P3 migration must not rewrite the meeting-event or transcript tables.
  assert.equal(/CREATE TABLE[^;]*meeting_events/i.test(sql), false);
  assert.equal(/ALTER TABLE[^;]*meeting_events/i.test(sql), false);
  assert.equal(/DROP TABLE[^;]*meeting_events/i.test(sql), false);
  assert.equal(sql.includes('meeting_transcripts'), false);
});
