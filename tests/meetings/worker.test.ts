import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerMeetingReminderWorker,
  type MeetingReminderDeps,
} from '../../src/meetings/worker.js';
import type { MeetingRepository } from '../../src/meetings/repository.js';

const MEETING_ID = 'evt-00000000-0000-0000-0000-000000000001';

class FakeRepo implements MeetingRepository {
  event: any;
  claims = 0;
  markSentCalls = 0;
  markCompletedCalls = 0;
  constructor(event: any) { this.event = { ...event }; }
  async getById(id: string) { return id === MEETING_ID ? this.event : null; }
  async create() { return null; }
  async getBySource() { return null; }
  async claim(id: string, expectedVersion: number) {
    this.claims += 1;
    const e = this.event;
    if (id !== MEETING_ID || e.status !== 'confirmed' || e.eventVersion !== expectedVersion || e.reminderSentAt) {
      return null;
    }
    const now = new Date();
    this.event = { ...e, reminderClaimedAt: now };
    return this.event;
  }
  async markSent(id: string, messageId: string) {
    this.markSentCalls += 1;
    // Idempotent: only set if not already sent.
    if (this.event.reminderSentAt) {
      return null;
    }
    this.event = { ...this.event, reminderSentAt: new Date(), reminderMessageId: messageId };
    return this.event;
  }
  async markCompleted(id: string) {
    this.markCompletedCalls += 1;
    if (id !== MEETING_ID || !this.event) return null;
    this.event = { ...this.event, status: 'completed' };
    return this.event;
  }
  async listUnremindedFuture() { return []; }
}

class FakeBoss {
  handlers: Map<string, (jobs: any[]) => Promise<void>> = new Map();
  work(name: string, handler: (jobs: any[]) => Promise<void>) {
    this.handlers.set(name, handler);
  }
  async run(name: string, jobs: any[]) {
    const h = this.handlers.get(name);
    if (!h) throw new Error('no handler for ' + name);
    await h(jobs);
  }
}

function makeEvent(overrides: Partial<any> = {}) {
  return {
    id: MEETING_ID,
    title: 'Team standup',
    startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    timezone: 'Asia/Kolkata',
    sourceMessageUrl: 'https://discord.com/channels/1/2/3',
    createdBy: 'user-announcer',
    status: 'confirmed' as const,
    eventVersion: 1,
    reminderSentAt: null,
    reminderClaimedAt: null,
    ...overrides,
  };
}

async function makeHandler(depsOverrides: Partial<MeetingReminderDeps> = {}) {
  const repo = new FakeRepo(makeEvent());
  const sent: Array<{ channelId: string; content: string }> = [];
  const deps: MeetingReminderDeps = {
    repository: repo,
    outputChannelId: '1570721649538502686',
    sendReminder: async (channelId, content) => {
      sent.push({ channelId, content });
      return { messageId: 'msg-100' };
    },
    ...depsOverrides,
  };
  const boss = new FakeBoss();
  registerMeetingReminderWorker(boss, deps);
  return { repo, boss, deps, sent };
}

function job(meetingId: string, eventVersion: number) {
  return { id: 'job-1', data: { meetingId, eventVersion } };
}

test('worker delivers a reminder and persists sent state', async () => {
  const { repo, boss, sent } = await makeHandler();
  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, '1570721649538502686');
  assert.ok(sent[0].content.includes('Team standup'));
  assert.ok(!sent[0].content.includes('@everyone') && !sent[0].content.includes('@here'));
  assert.ok(sent[0].content.includes('Asia/Kolkata'));
  assert.ok(sent[0].content.includes('Original announcement:'));
  const e = await repo.getById(MEETING_ID);
  assert.ok(e!.reminderSentAt);
  assert.equal(e!.reminderMessageId, 'msg-100');
  assert.equal(e!.status, 'completed');
  assert.equal(repo.markCompletedCalls, 1);
  assert.equal(repo.claims, 1);
});

test('late reminder job skips delivery and marks the event completed', async () => {
  const { repo, boss, sent } = await makeHandler();
  repo.event = {
    ...repo.event,
    startAt: new Date(Date.now() - 60_000),
  };

  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);

  assert.equal(sent.length, 0);
  assert.equal(repo.claims, 0, 'late event should not be claimed for delivery');
  assert.equal(repo.markCompletedCalls, 1);
  assert.equal((await repo.getById(MEETING_ID))!.status, 'completed');
});

test('reminder strips mass-mention text from the event title', async () => {
  const { repo, boss, sent } = await makeHandler();
  repo.event = { ...repo.event, title: '@everyone Team standup @here' };

  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);

  assert.equal(sent.length, 1);
  assert.ok(!sent[0].content.includes('@everyone'));
  assert.ok(!sent[0].content.includes('@here'));
  assert.ok(sent[0].content.includes('Team standup'));
});

test('obsolete version job is a no-op and does not send', async () => {
  const { repo, boss, sent } = await makeHandler();
  await boss.run('send-meeting-reminder', [job(MEETING_ID, 99)]);
  assert.equal(sent.length, 0);
  assert.equal(repo.claims, 0);
  assert.equal((await repo.getById(MEETING_ID))!.reminderSentAt, null);
});

test('already-sent reminder is not re-sent', async () => {
  const { repo, boss, sent } = await makeHandler();
  repo.event = { ...repo.event, reminderSentAt: new Date() };
  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);
  assert.equal(sent.length, 0);
  assert.equal(repo.claims, 0);
});

test('cancelled event job is a no-op', async () => {
  const { repo, boss, sent } = await makeHandler();
  repo.event = { ...repo.event, status: 'cancelled', eventVersion: 2 };
  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);
  assert.equal(sent.length, 0);
  assert.equal(repo.claims, 0);
});

test('Discord failure throws so pg-boss retries and claim can expire', async () => {
  const { repo, boss, sent } = await makeHandler({
    sendReminder: async () => { throw new Error('Discord API rate limited'); },
  });
  await assert.rejects(() => boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]), /Discord API/);
  assert.equal(sent.length, 0);
  // reminder_sent_at must not be persisted on failure
  assert.equal((await repo.getById(MEETING_ID))!.reminderSentAt, null);
});

test('Discord send success but markSent failure: delivery logged, no retry, no duplicate', async () => {
  const { repo, boss, sent } = await makeHandler({
    sendReminder: async (channelId, content) => {
      sent.push({ channelId, content });
      return { messageId: 'msg-100' };
    },
  });
  let attempts = 0;
  const originalMarkSent = repo.markSent.bind(repo);
  repo.markSent = async (id: string, messageId: string) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('PostgreSQL connection lost');
    }
    return originalMarkSent(id, messageId);
  };

  await boss.run('send-meeting-reminder', [job(MEETING_ID, 1)]);
  // Discord send happened exactly once — no duplicate despite markSent failure.
  assert.equal(sent.length, 1);
  // markSent was attempted (failed once).
  assert.equal(attempts, 1);
  // reminderSentAt was NOT persisted (markSent failed).
  assert.equal((await repo.getById(MEETING_ID))!.reminderSentAt, null);
});

test('concurrent delivery attempts: only one reminder is sent', async () => {
  const { repo, boss, sent } = await makeHandler();
  // Two jobs for the same meeting and version run sequentially in the test.
  await boss.run('send-meeting-reminder', [
    job(MEETING_ID, 1),
    job(MEETING_ID, 1),
  ]);
  // Only one reminder should be sent — the second is a no-op.
  assert.equal(sent.length, 1);
  // The second job is caught by the pre-claim reminderSentAt check, so claim
  // is only invoked once.
  assert.equal(repo.claims, 1);
});
