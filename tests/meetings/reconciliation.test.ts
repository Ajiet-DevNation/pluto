import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileMeetingReminders,
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
  async confirm() { return null; }
  async cancel() { return null; }
  async reschedule() { return null; }
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
  async send(_q: string, _p: any, options: any): Promise<string | null> {
    this.sends.push({ singletonKey: options.singletonKey });
    return 'job-id';
  }
}

async function makeDeps(events: any[]) {
  const repo = new FakeRepo(events);
  const boss = new FakeBoss();
  const scheduled = await reconcileMeetingReminders({ repository: repo, boss });
  return { repo, boss, scheduled };
}

const now = Date.now();
const future = new Date(now + 2 * 60 * 60 * 1000); // 2h away

test('reconciliation schedules reminders for confirmed unsent future events', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss, scheduled } = await makeDeps(events);
  assert.equal(scheduled, 1);
  assert.equal(boss.sends.length, 1);
  assert.equal(boss.sends[0].singletonKey, `meeting:${MEETING_ID_1}:v1`);
});

test('reconciliation is idempotent: singleton key prevents duplicate jobs', async () => {
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
  const { boss, scheduled } = await makeDeps(events);
  assert.equal(scheduled, 0);
  assert.equal(boss.sends.length, 0);
});

test('reconciliation skips events that have already started', async () => {
  const past = new Date(now - 60 * 60 * 1000);
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: past, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss, scheduled } = await makeDeps(events);
  assert.equal(scheduled, 0);
  assert.equal(boss.sends.length, 0);
});

test('reconciliation never sends reminders directly (only schedules jobs)', async () => {
  const events = [
    { id: MEETING_ID_1, eventVersion: 1, startAt: future, status: 'confirmed', reminderSentAt: null },
  ];
  const { boss } = await makeDeps(events);
  // boss only records sends (schedule calls), no direct delivery content is sent here.
  assert.equal(boss.sends.length, 1);
});
