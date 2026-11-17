import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConfirmationHandler,
  type ConfirmationInteraction,
} from '../../src/meetings/confirmation.js';
import type { MeetingRepository } from '../../src/meetings/repository.js';

const MEETING_ID = 'evt-00000000-0000-0000-0000-000000000001';
const GUILD = '1422593925658579036';
const ANNOUNCER = 'user-announcer';
const MODERATOR = 'user-moderator';
const UNAUTHORIZED = 'user-random';

const EVENT = {
  id: MEETING_ID,
  title: 'Team standup',
  startAt: new Date('2026-11-15T10:30:00.000Z'),
  timezone: 'Asia/Kolkata',
  sourceMessageUrl: 'https://discord.com/channels/1422593925658579036/1570872485933752502/1000000000000000001',
  createdBy: ANNOUNCER,
  status: 'pending' as const,
  eventVersion: 1,
  reminderSentAt: null,
};

class FakeRepo implements MeetingRepository {
  events = new Map<string, any>();
  calls: string[] = [];
  constructor(initial: any) { this.events.set(initial.id, { ...initial }); }

  async create() { return null; }
  async getBySource() { return null; }
  async getById(id: string) { return this.events.get(id) ?? null; }
  async confirm(id: string) {
    this.calls.push('confirm');
    const e = this.events.get(id);
    if (!e) return null;
    this.events.set(id, { ...e, status: 'confirmed' });
    return this.events.get(id);
  }
  async cancel(id: string, expectedVersion: number) {
    this.calls.push('cancel');
    const e = this.events.get(id);
    if (!e || e.eventVersion !== expectedVersion) return null;
    this.events.set(id, { ...e, status: 'cancelled', eventVersion: e.eventVersion + 1 });
    return this.events.get(id);
  }
  async reschedule(id: string, expectedVersion: number, newStartAt: Date) {
    this.calls.push('reschedule');
    const e = this.events.get(id);
    if (!e || e.eventVersion !== expectedVersion) return null;
    this.events.set(id, { ...e, startAt: newStartAt, eventVersion: e.eventVersion + 1, status: 'confirmed' });
    return this.events.get(id);
  }
  async claim() { return null; }
  async markSent() { return null; }
  async markCompleted() { return null; }
  async listUnremindedFuture() { return []; }
}

class FakeInteraction implements ConfirmationInteraction {
  customId: string | null;
  user: { id: string };
  guildId: string | null;
  replies: Array<{ content: string; ephemeral?: boolean }> = [];
  fields?: Record<string, string>;
  constructor(opts: { customId: string | null; userId: string; guildId?: string | null }) {
    this.customId = opts.customId;
    this.user = { id: opts.userId };
    this.guildId = opts.guildId ?? GUILD;
  }
  async reply(options: { content: string; ephemeral?: boolean }): Promise<unknown> {
    this.replies.push(options);
    return undefined;
  }
}

function lastReply(i: FakeInteraction) {
  return i.replies[i.replies.length - 1];
}

function makeHandler(overrides: { moderatorCheck?: (g: string, u: string) => Promise<boolean> } = {}) {
  const repo = new FakeRepo(EVENT);
  let scheduled: string[] = [];
  const boss: any = {
    work: () => {},
    send: async (_q: string, _p: any, o: any) => {
      scheduled.push(o.singletonKey);
      return 'job-1';
    },
  };
  const handler = createConfirmationHandler({
    repository: repo,
    boss,
    moderatorCheck: overrides.moderatorCheck,
    postConfirmation: async () => ({ messageId: 'msg-1' }),
  });
  return { repo, handler, boss, scheduled };
}

test('original announcer can confirm a pending meeting', async () => {
  const { handler, repo } = makeHandler();
  const interaction = new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: ANNOUNCER });
  const result = await handler.handleInteraction(interaction);
  assert.equal(result, 'handled');
  const e = await repo.getById(MEETING_ID);
  assert.equal(e!.status, 'confirmed');
  assert.equal(lastReply(interaction)!.ephemeral, true);
  assert.ok(lastReply(interaction)!.content!.includes('Confirmed'));
});

test('repeated confirmation is idempotent', async () => {
  const { handler, repo } = makeHandler();
  // Confirm once to move to confirmed.
  await handler.handleInteraction(new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: ANNOUNCER }));
  repo.calls = [];
  const interaction = new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: ANNOUNCER });
  const result = await handler.handleInteraction(interaction);
  assert.equal(result, 'handled');
  assert.equal(repo.calls.includes('confirm'), false, 'confirm should not be called again');
  assert.ok(lastReply(interaction)!.content!.includes('already confirmed'));
});

test('a Manage Messages moderator can confirm', async () => {
  const { handler } = makeHandler({
    moderatorCheck: async (g, u) => u === MODERATOR,
  });
  const interaction = new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: MODERATOR });
  const result = await handler.handleInteraction(interaction);
  assert.equal(result, 'handled');
  assert.ok(lastReply(interaction)!.content!.includes('Confirmed'));
});

test('an unauthorized member is refused ephemerally', async () => {
  const { handler } = makeHandler({
    moderatorCheck: async () => false,
  });
  const interaction = new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: UNAUTHORIZED });
  const result = await handler.handleInteraction(interaction);
  assert.equal(result, 'handled');
  const reply = lastReply(interaction)!;
  assert.equal(reply.ephemeral, true);
  assert.ok(reply.content!.includes('Only the original announcer or an authorized moderator'));
});

test('cancellation bumps event version and marks cancelled', async () => {
  const { handler, repo } = makeHandler();
  // confirm first
  await handler.handleInteraction(new FakeInteraction({ customId: `meeting:confirm:${MEETING_ID}`, userId: ANNOUNCER }));
  const interaction = new FakeInteraction({ customId: `meeting:cancel:${MEETING_ID}`, userId: ANNOUNCER });
  const result = await handler.handleInteraction(interaction);
  assert.equal(result, 'handled');
  const e = await repo.getById(MEETING_ID);
  assert.equal(e!.status, 'cancelled');
  assert.equal(e!.eventVersion, 2);
});
