import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleReminder,
  singletonKey,
  MEETING_REMINDER_QUEUE,
} from '../../src/meetings/scheduling.js';

const MEETING_ID = 'evt-00000000-0000-0000-0000-000000000001';
const VERSION = 1;

class FakeBoss {
  sends: Array<{ queue: string; payload: any; options: any }> = [];
  async send(queue: string, payload: any, options: any): Promise<string | null> {
    this.sends.push({ queue, payload, options });
    return 'job-id';
  }
}

function futureMs(minutesFromNow: number): Date {
  return new Date(Date.now() + minutesFromNow * 60 * 1000);
}

test('schedules a reminder one hour before start_at with singleton key', async () => {
  const boss = new FakeBoss();
  const startAt = futureMs(90); // 90 min away -> reminder in 30 min
  const jobId = await scheduleReminder(boss, MEETING_ID, VERSION, startAt);
  assert.equal(jobId, 'job-id');
  assert.equal(boss.sends.length, 1);
  assert.equal(boss.sends[0].queue, MEETING_REMINDER_QUEUE);
  assert.deepEqual(boss.sends[0].payload, { meetingId: MEETING_ID, eventVersion: VERSION });
  assert.equal(boss.sends[0].options.singletonKey, singletonKey(MEETING_ID, VERSION));
  assert.equal(boss.sends[0].options.retryLimit, 3);
  assert.equal(boss.sends[0].options.retryBackoff, true);
  assert.equal(boss.sends[0].options.expireInSeconds, 600);
  // startAfter ~30 minutes = 1800 seconds
  assert.ok(boss.sends[0].options.startAfter >= 1790 && boss.sends[0].options.startAfter <= 1810);
});

test('does not schedule when the meeting has already started', async () => {
  const boss = new FakeBoss();
  const startAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  const jobId = await scheduleReminder(boss, MEETING_ID, VERSION, startAt);
  assert.equal(jobId, null);
  assert.equal(boss.sends.length, 0);
});

test('schedules immediately when the meeting is less than one hour away', async () => {
  const boss = new FakeBoss();
  const startAt = futureMs(10); // 10 min away -> reminder overdue -> startAfter 0
  const jobId = await scheduleReminder(boss, MEETING_ID, VERSION, startAt);
  assert.equal(jobId, 'job-id');
  assert.equal(boss.sends[0].options.startAfter, 0);
});

test('singletonKey is derived from meeting id and version', () => {
  assert.equal(singletonKey('m-1', 1), 'meeting:m-1:v1');
  assert.equal(singletonKey('m-1', 2), 'meeting:m-1:v2');
  assert.notEqual(singletonKey('m-1', 1), singletonKey('m-2', 1));
});
