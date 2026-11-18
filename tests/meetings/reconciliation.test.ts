import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileMeetingReminders,
  type ReconciliationResult,
} from '../../src/meetings/reconciliation.js';
import type { MeetingRepository } from '../../src/meetings/repository.js';

const MEETING_ID_1 = 'evt-00000000-0000-0000-0000-000000000001';
const MEETING_ID_2 = 'evt-00000000-0000-0000-0000-000000000002';

class FakeRepo implements MeetingRepository {
  events: any[];
  constructor(events: any[]) { this.events = events; }
  async create() { return null; }
  async getBySource() { return null; }
  async getById() { return null; }
  async claim() { return null; }
  async markSent() { return null; }
  async markCompleted() { return null; }
  async listUnremindedFuture() {
    const now = Date.now();
    return this.events.filter(
      (e) => e.status === 'confirmed' && !e.reminderSentAt && e.startAt.getTime() > now,
    );
  }
}

class FakeBoss {
  sends: Array<{ singletonKey: string }> = [];
  failNext = false;
  async send(_q: string, _p: any, options: any): Promise<string | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('pg-boss send failed');
    }
    this.sends.push({ singletonKey: options.singletonKey });
    return 'job-id';
  }
}

async function makeDeps(events: any[], failNext = false) {
  const repo = new FakeRepo(events);
  const boss = new FakeBoss();
  boss.failNext = failNext;
  const result: ReconciliationResult = await reconcileMeetingReminders({ repository: repo, boss });
  return { repo, boss, result };
}

const now = Date.now();
const future = new Date(now + 2 * 60 * 60 * 1000); // 2h away

test('reconciliation schedules reminders for confirmed unsent future events', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss, result } = await makeDeps(events);
  assert.equal(result.scheduled, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(boss.sends.length, 1);
  assert.equal(boss.sends[0].singletonKey, `meeting:${MEETING_ID_1}:v1`);
});

test('reconciliation reports partial failure when scheduling fails', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
    { id: MEETING_ID_2, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss, result } = await makeDeps(events, true);
  // First event fails, second succeeds.
  assert.equal(result.scheduled, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].meetingId, MEETING_ID_1);
  assert.equal(boss.sends.length, 1);
  assert.equal(boss.sends[0].singletonKey, `meeting:${MEETING_ID_2}:v1`);
});

test('reconciliation is idempotent: repeated runs do not multiply jobs', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const boss = new FakeBoss();
  const repo = new FakeRepo(events);
  await reconcileMeetingReminders({ repository: repo, boss });
  await reconcileMeetingReminders({ repository: repo, boss });
  assert.equal(boss.sends.length, 2, 'two calls each ensure one job (singkey dedupe is pg-boss-side)');
});

test('reconciliation skips events already reminded', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: new Date() },
  ];
  const { boss, result } = await makeDeps(events);
  assert.equal(result.scheduled, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(boss.sends.length, 0);
});

test('reconciliation skips events that have already started', async () => {
  const past = new Date(now - 60 * 60 * 1000);
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: past, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss, result } = await makeDeps(events);
  assert.equal(result.scheduled, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(boss.sends.length, 0);
});

test('reconciliation never sends reminders directly (only schedules jobs)', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss } = await makeDeps(events);
  assert.equal(boss.sends.length, 1);
});
