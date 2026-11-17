import test from 'node:test';
import assert from 'node:assert/strict';
import { Events, type Client } from 'discord.js';
import type { PgBoss } from 'pg-boss';
import { loadConfig } from '../../src/config.js';
import { startMeetingAnnouncer } from '../../src/meetings/index.js';
import { ensureMeetingReminderQueue } from '../../src/jobs/worker.js';
import type {
  MeetingRepository,
} from '../../src/meetings/repository.js';
import type { MeetingEvent, NewMeetingEvent } from '../../src/meetings/schema.js';
import type { DiscordLogger } from '../../src/discord/types.js';

const config = loadConfig();
const GUILD = config.planning.discord.guild_id;
const MEETING_CHANNEL = config.planning.discord.indexed_channels['#meeting-plans'];
const OUTPUT_CHANNEL = config.planning.discord.output_channel_id;
const BOT_USER = 'bot-user-1';
const ANNOUNCER_USER = 'human-user-1';

type Listener = (message: any) => Promise<void>;

class FakeClient {
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  off(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter((entry) => entry !== listener));
    return this;
  }

  listener(event: string): Listener | undefined {
    return this.listeners.get(event)?.[0];
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

class FakeRepo implements MeetingRepository {
  readonly created: NewMeetingEvent[] = [];
  failCreate = false;

  async create(input: NewMeetingEvent): Promise<MeetingEvent | null> {
    if (this.failCreate) {
      throw new Error('database unavailable');
    }
    this.created.push(input);
    return {
      id: 'meeting-1',
      guildId: input.guildId,
      channelId: input.channelId,
      sourceMessageId: input.sourceMessageId,
      sourceMessageUrl: input.sourceMessageUrl,
      createdBy: input.createdBy,
      title: input.title,
      startAt: input.startAt as Date,
      timezone: input.timezone ?? 'Asia/Kolkata',
      status: input.status ?? 'confirmed',
      eventVersion: input.eventVersion ?? 1,
      reminderSentAt: null,
      reminderMessageId: null,
      reminderClaimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getBySource(): Promise<MeetingEvent | null> {
    return null;
  }

  async getById(): Promise<MeetingEvent | null> {
    return null;
  }

  async claim(): Promise<MeetingEvent | null> {
    return null;
  }

  async markSent(): Promise<MeetingEvent | null> {
    return null;
  }

  async markCompleted(): Promise<MeetingEvent | null> {
    return null;
  }

  async listUnremindedFuture(): Promise<MeetingEvent[]> {
    return [];
  }
}

class FakeBoss {
  readonly queues: string[] = [];
  readonly queued: Array<{ queue: string; payload: any; options: any }> = [];
  readonly workers = new Map<string, unknown>();
  readonly workCalls: string[] = [];
  failSend = false;

  async createQueue(name: string): Promise<void> {
    this.queues.push(name);
  }

  async send(queue: string, payload: any, options: any): Promise<string | null> {
    if (this.failSend) {
      throw new Error('pg-boss unavailable');
    }
    this.queued.push({ queue, payload, options });
    return 'job-1';
  }

  work(name: string, handler: unknown): void {
    this.workCalls.push(name);
    this.workers.set(name, handler);
  }
}

interface CapturedLogger extends DiscordLogger {
  readonly messages: string[];
}

function makeLogger(): CapturedLogger {
  const messages: string[] = [];
  return {
    messages,
    info: (message) => messages.push(`info:${message}`),
    warn: (message) => messages.push(`warn:${message}`),
    error: (message) => messages.push(`error:${message}`),
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  const replies: string[] = [];
  const message = {
    id: 'message-1',
    guildId: GUILD,
    channelId: MEETING_CHANNEL,
    system: false,
    content: 'Meeting tomorrow at 4 PM',
    createdAt: new Date(),
    author: { id: ANNOUNCER_USER, bot: false },
    mentions: { everyone: true },
    channel: {
      send: async (content: string) => {
        replies.push(content);
        return { id: 'reply-1' };
      },
    },
    ...overrides,
  };
  return { message, replies };
}

function start(repo: FakeRepo, boss: FakeBoss, logger: CapturedLogger) {
  const client = new FakeClient();
  const reminders: Array<{ channelId: string; content: string }> = [];
  const announcer = startMeetingAnnouncer({
    client: client as unknown as Client,
    repository: repo,
    boss: boss as unknown as PgBoss,
    botUserId: BOT_USER,
    isOptedOut: async () => false,
    sendReminder: async (channelId, content) => {
      reminders.push({ channelId, content });
      return { messageId: 'reminder-1' };
    },
    outputChannelId: OUTPUT_CHANNEL,
    logger,
  });
  return { client, announcer, reminders };
}

test('valid announcement creates a confirmed event and schedules one reminder', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  const logger = makeLogger();
  const { client } = start(repo, boss, logger);
  const { message } = makeMessage();
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener, 'announcer must register a MessageCreate listener');

  await listener(message);

  assert.equal(repo.created.length, 1);
  assert.equal(repo.created[0].status, 'confirmed');
  assert.equal(repo.created[0].eventVersion, 1);
  assert.equal(repo.created[0].sourceMessageId, 'message-1');
  assert.equal(repo.created[0].timezone, 'Asia/Kolkata');
  assert.equal(boss.queued.length, 1);
  assert.equal(boss.queued[0].queue, 'send-meeting-reminder');
  assert.deepEqual(boss.queued[0].payload, {
    meetingId: 'meeting-1',
    eventVersion: 1,
  });
  assert.equal(boss.queued[0].options.singletonKey, 'meeting:meeting-1:v1');
  assert.deepEqual(boss.workCalls, ['send-meeting-reminder']);
  assert.equal(logger.messages.filter((m) => m.startsWith('error:')).length, 0);
});

test('ambiguous time posts a clarification and schedules nothing', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  const { client } = start(repo, boss, makeLogger());
  const { message, replies } = makeMessage({ content: 'Meeting today at 5' });
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener);

  await listener(message);

  assert.equal(replies.length, 1);
  assert.match(replies[0], new RegExp(`^<@${ANNOUNCER_USER}>`));
  assert.match(replies[0], /05:00/);
  assert.equal(repo.created.length, 0);
  assert.equal(boss.queued.length, 0);
});

test('announcements outside #meeting-plans are ignored', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  const { client } = start(repo, boss, makeLogger());
  const { message, replies } = makeMessage({ channelId: OUTPUT_CHANNEL });
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener);

  await listener(message);

  assert.equal(repo.created.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(boss.queued.length, 0);
});

test('plain-text @everyone without mention metadata is ignored', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  const { client } = start(repo, boss, makeLogger());
  const { message, replies } = makeMessage({
    content: '@everyone Meeting tomorrow at 4 PM',
    mentions: { everyone: false },
  });
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener);

  await listener(message);

  assert.equal(repo.created.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(boss.queued.length, 0);
});

test('database failure is logged and never escapes the gateway listener', async () => {
  const repo = new FakeRepo();
  repo.failCreate = true;
  const boss = new FakeBoss();
  const logger = makeLogger();
  const { client } = start(repo, boss, logger);
  const { message } = makeMessage();
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener);

  await assert.doesNotReject(() => listener(message));

  assert.equal(boss.queued.length, 0);
  assert.ok(
    logger.messages.some((m) => m.startsWith('error:Failed to persist meeting event')),
  );
});

test('scheduling failure leaves the event for startup reconciliation', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  boss.failSend = true;
  const logger = makeLogger();
  const { client } = start(repo, boss, logger);
  const { message } = makeMessage();
  const listener = client.listener(Events.MessageCreate);
  assert.ok(listener);

  await assert.doesNotReject(() => listener(message));

  assert.equal(repo.created.length, 1);
  assert.equal(boss.queued.length, 0);
  assert.ok(
    logger.messages.some((m) =>
      m.startsWith('error:Failed to schedule meeting reminder; reconciliation will retry'),
    ),
  );
});

test('shutdown removes the MessageCreate listener', async () => {
  const repo = new FakeRepo();
  const boss = new FakeBoss();
  const { client, announcer } = start(repo, boss, makeLogger());
  assert.equal(client.listenerCount(Events.MessageCreate), 1);

  await announcer.shutdown();

  assert.equal(client.listenerCount(Events.MessageCreate), 0);
});

test('startup wiring creates the reminder queue exactly once', async () => {
  const boss = new FakeBoss();

  await ensureMeetingReminderQueue(boss as unknown as PgBoss);

  assert.deepEqual(boss.queues, ['send-meeting-reminder']);
  assert.equal(boss.workers.size, 0, 'queue creation must not register a duplicate worker');
});
