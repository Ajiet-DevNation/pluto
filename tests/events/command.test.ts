import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleEventInteraction,
  EVENT_MESSAGES,
  formatEventCancellationConfirmation,
  formatEventCancelledRecord,
  formatEventConfirmation,
  formatEventPublicRecord,
  type EventInteraction,
} from '../../src/events/command';
import type { ManualEvent, NewManualEvent } from '../../src/events/schema';
import { fitDiscordContent } from '../../src/events/text';
import { GUILD } from '../discord/helpers';

const NOW = new Date('2026-11-18T06:30:00.000Z'); // 12:00 IST

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeEventInteraction implements EventInteraction {
  readonly replies: Array<{ content: string; ephemeral: boolean }> = [];
  readonly edits: string[] = [];
  deferrals = 0;

  commandName = 'event';

  guildId: string | null;

  user: { id: string; username?: string };

  memberPermissions: { has(permission: bigint): boolean } | null;

  private readonly subcommand: string;

  private readonly values: Record<string, string | undefined>;

  private readonly eventId: number | null;

  constructor(
    options: {
      guildId?: string | null;
      subcommand?: string;
      values?: Record<string, string | undefined>;
      eventId?: number | null;
      userId?: string;
      hasManage?: boolean;
    } = {},
  ) {
    this.guildId = options.guildId === undefined ? GUILD : options.guildId;
    this.subcommand = options.subcommand ?? 'add';
    this.values = options.values ?? {};
    this.eventId = options.eventId ?? 169;
    this.user = {
      id: options.userId ?? '200000000000000001',
      username: 'organizer',
    };
    this.memberPermissions = {
      has: () => options.hasManage ?? false,
    };
  }

  isChatInputCommand(): boolean {
    return true;
  }

  get options(): EventInteraction['options'] {
    return {
      getSubcommand: () => this.subcommand,
      getString: (name: string) => this.values[name] ?? null,
      getInteger: () => this.eventId,
    };
  }

  async reply(options: { content: string; ephemeral: boolean }): Promise<unknown> {
    this.replies.push(options);
    return undefined;
  }

  async deferReply(): Promise<unknown> {
    this.deferrals += 1;
    return undefined;
  }

  async editReply(options: { content: string }): Promise<unknown> {
    this.edits.push(options.content);
    return undefined;
  }
}

function makeEvent(overrides: Partial<ManualEvent> = {}): ManualEvent {
  return {
    id: 169,
    guildId: GUILD,
    title: 'ui event',
    description: null,
    startAt: new Date('2026-11-24T04:30:00.000Z'),
    endAt: null,
    timezone: 'Asia/Kolkata',
    createdBy: '200000000000000001',
    status: 'scheduled',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ManualEvent;
}

function makeRepository(
  options: {
    existingEvent?: ManualEvent | null;
    cancelResult?: ManualEvent | null;
  } = {},
) {
  const saved: NewManualEvent[] = [];
  const cancelled: Array<{ guildId: string; id: number }> = [];
  return {
    saved,
    cancelled,
    repository: {
      async create(input: NewManualEvent): Promise<ManualEvent> {
        saved.push(input);
        return {
          id: 1,
          guildId: input.guildId,
          title: input.title,
          description: input.description ?? null,
          startAt: input.startAt,
          endAt: input.endAt ?? null,
          timezone: input.timezone ?? 'Asia/Kolkata',
          createdBy: input.createdBy,
          status: input.status ?? 'scheduled',
          createdAt: NOW,
          updatedAt: NOW,
        } as ManualEvent;
      },
      async getById(): Promise<ManualEvent | null> {
        return options.existingEvent === undefined
          ? null
          : options.existingEvent;
      },
      async cancel(guildId: string, id: number): Promise<ManualEvent | null> {
        cancelled.push({ guildId, id });
        if (options.cancelResult !== undefined) {
          return options.cancelResult;
        }
        if (!options.existingEvent) {
          return null;
        }
        return {
          ...options.existingEvent,
          status: 'cancelled',
          updatedAt: NOW,
        };
      },
    },
  };
}

function validValues(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    title: 'Hackathon',
    date: '2026-11-22',
    time: '10:00 AM',
    end: '12:00 PM',
    description: 'Bring a laptop.',
    ...overrides,
  };
}

test('/event add rejects a foreign guild without saving or posting', async () => {
  const interaction = new FakeEventInteraction({ guildId: '1422593925658579999' });
  const { saved, repository } = makeRepository();
  let posts = 0;
  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => {
      posts += 1;
      return {};
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'wrong-guild');
  assert.equal(interaction.replies[0]?.content, EVENT_MESSAGES.wrongGuild);
  assert.equal(interaction.replies[0]?.ephemeral, true);
  assert.equal(saved.length, 0);
  assert.equal(posts, 0);
});

test('/event add works for any member without a permission gate', async () => {
  const interaction = new FakeEventInteraction({ values: validValues() });
  const { saved, repository } = makeRepository();
  const posts: string[] = [];
  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'saved');
  assert.equal(saved.length, 1);
  assert.equal(posts.length, 1);
});

test('/event add reports invalid input before saving', async () => {
  const interaction = new FakeEventInteraction({
    values: validValues({ date: '2026-02-30' }),
  });
  const { saved, repository } = makeRepository();
  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => ({}),
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'invalid');
  assert.match(interaction.replies[0]?.content ?? '', /real calendar date/);
  assert.equal(interaction.deferrals, 0);
  assert.equal(saved.length, 0);
});

test('/event add rejects an over-long title and description', async () => {
  const longTitle = new FakeEventInteraction({
    values: validValues({ title: 'x'.repeat(201) }),
  });
  const { saved, repository } = makeRepository();
  const deps = {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => ({}),
    now: () => NOW,
    logger: silentLogger,
  };

  const titleResult = await handleEventInteraction(longTitle, deps);
  assert.equal(titleResult, 'invalid');
  assert.equal(longTitle.replies[0]?.content, EVENT_MESSAGES.invalidTitle);

  const longDescription = new FakeEventInteraction({
    values: validValues({ description: 'x'.repeat(1001) }),
  });
  const descriptionResult = await handleEventInteraction(longDescription, deps);
  assert.equal(descriptionResult, 'invalid');
  assert.equal(
    longDescription.replies[0]?.content,
    EVENT_MESSAGES.invalidDescription,
  );
  assert.equal(saved.length, 0);
});

test('/event add saves one strict IST event, posts once and confirms', async () => {
  const interaction = new FakeEventInteraction({ values: validValues() });
  const { saved, repository } = makeRepository();
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return { messageId: '300000000000000001' };
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'saved');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].guildId, GUILD);
  assert.equal(saved[0].title, 'Hackathon');
  assert.equal(saved[0].createdBy, interaction.user.id);
  assert.equal(saved[0].timezone, 'Asia/Kolkata');
  assert.equal(saved[0].status, 'scheduled');
  assert.equal(saved[0].startAt.toISOString(), '2026-11-22T04:30:00.000Z');
  assert.equal(saved[0].endAt?.toISOString(), '2026-11-22T06:30:00.000Z');

  assert.equal(posts.length, 1);
  assert.match(posts[0], /New event: Hackathon/);
  assert.match(posts[0], /Sun, 22 Nov 2026, 10:00 AM–12:00 PM IST/);
  assert.match(posts[0], /Bring a laptop\./);
  assert.match(posts[0], /Added by organizer/);

  assert.equal(interaction.deferrals, 1);
  assert.match(interaction.edits[0], /Event saved: Hackathon/);
  assert.match(interaction.edits[0], /posted in #events/);
});

test('/event add still accepts 24-hour input and displays it in 12-hour form', async () => {
  const interaction = new FakeEventInteraction({
    values: validValues({ time: '10:00', end: '12:00' }),
  });
  const { saved, repository } = makeRepository();
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'saved');
  assert.equal(saved[0].startAt.toISOString(), '2026-11-22T04:30:00.000Z');
  assert.equal(saved[0].endAt?.toISOString(), '2026-11-22T06:30:00.000Z');
  assert.match(interaction.edits[0], /10:00 AM–12:00 PM IST/);
});

test('/event add neutralises mass mentions in the saved and public text', async () => {
  const interaction = new FakeEventInteraction({
    values: validValues({
      title: '@everyone Hackathon',
      description: 'Ping @here for help',
    }),
  });
  const { saved, repository } = makeRepository();
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'saved');
  assert.equal(saved[0].title, 'everyone Hackathon');
  assert.equal(saved[0].description, 'Ping here for help');
  assert.equal(posts[0].includes('@everyone'), false);
  assert.equal(posts[0].includes('@here'), false);
});

test('/event add keeps the row when the public post fails', async () => {
  const interaction = new FakeEventInteraction({ values: validValues() });
  const { saved, repository } = makeRepository();

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => {
      throw new Error('missing permissions');
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'saved-post-failed');
  assert.equal(saved.length, 1);
  assert.match(interaction.edits[0], /could not post the public record/);
});

test('/event add reports a save failure without posting', async () => {
  const interaction = new FakeEventInteraction({ values: validValues() });
  let posts = 0;

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: {
      async create(): Promise<ManualEvent> {
        throw new Error('database down');
      },
    },
    postPublicRecord: async () => {
      posts += 1;
      return {};
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'error');
  assert.equal(posts, 0);
  assert.equal(interaction.edits[0], EVENT_MESSAGES.error);
});

test('/event ignores unsupported or foreign subcommands', async () => {
  const interaction = new FakeEventInteraction({ subcommand: 'remove' });
  const { repository } = makeRepository();
  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => ({}),
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'unsupported-subcommand');
  assert.equal(interaction.replies.length, 0);
  assert.equal(interaction.edits.length, 0);
});

test('/event cancel lets the organizer cancel their own event', async () => {
  const interaction = new FakeEventInteraction({
    subcommand: 'cancel',
    eventId: 169,
  });
  const { repository, cancelled } = makeRepository({
    existingEvent: makeEvent(),
  });
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    logger: silentLogger,
  });

  assert.equal(result, 'cancelled');
  assert.deepEqual(cancelled, [{ guildId: GUILD, id: 169 }]);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /Event cancelled: ui event/);
  assert.match(posts[0], /Event ID: 169/);
  assert.match(posts[0], /Cancelled by organizer/);
  assert.match(interaction.edits[0], /public cancellation notice/);
});

test('/event cancel allows Manage Events to cancel another member event', async () => {
  const interaction = new FakeEventInteraction({
    subcommand: 'cancel',
    eventId: 169,
    userId: 'moderator-id',
    hasManage: true,
  });
  const { repository, cancelled } = makeRepository({
    existingEvent: makeEvent({ createdBy: 'someone-else' }),
  });
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    logger: silentLogger,
  });

  assert.equal(result, 'cancelled');
  assert.deepEqual(cancelled, [{ guildId: GUILD, id: 169 }]);
  assert.equal(posts.length, 1);
});

test('/event cancel denies a non-owner without Manage Events', async () => {
  const interaction = new FakeEventInteraction({
    subcommand: 'cancel',
    eventId: 169,
    userId: 'not-the-owner',
    hasManage: false,
  });
  const { repository, cancelled } = makeRepository({
    existingEvent: makeEvent({ createdBy: 'someone-else' }),
  });
  const posts: string[] = [];

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async (content) => {
      posts.push(content);
      return {};
    },
    logger: silentLogger,
  });

  assert.equal(result, 'not-authorized');
  assert.equal(
    interaction.edits[0],
    EVENT_MESSAGES.notAllowedToCancel,
  );
  assert.equal(cancelled.length, 0);
  assert.equal(posts.length, 0);
});

test('/event cancel reports missing, cancelled and concurrent events', async () => {
  const missing = new FakeEventInteraction({ subcommand: 'cancel' });
  const missingRepo = makeRepository();
  const missingResult = await handleEventInteraction(missing, {
    guildId: GUILD,
    events: missingRepo.repository,
    postPublicRecord: async () => ({}),
    logger: silentLogger,
  });
  assert.equal(missingResult, 'not-found');
  assert.equal(missing.edits[0], EVENT_MESSAGES.notFound);

  const already = new FakeEventInteraction({ subcommand: 'cancel' });
  const alreadyRepo = makeRepository({
    existingEvent: makeEvent({ status: 'cancelled' }),
  });
  const alreadyResult = await handleEventInteraction(already, {
    guildId: GUILD,
    events: alreadyRepo.repository,
    postPublicRecord: async () => ({}),
    logger: silentLogger,
  });
  assert.equal(alreadyResult, 'already-cancelled');
  assert.equal(already.edits[0], EVENT_MESSAGES.alreadyCancelled);
  assert.equal(alreadyRepo.cancelled.length, 0);

  const concurrent = new FakeEventInteraction({ subcommand: 'cancel' });
  const concurrentRepo = makeRepository({
    existingEvent: makeEvent(),
    cancelResult: null,
  });
  const concurrentResult = await handleEventInteraction(concurrent, {
    guildId: GUILD,
    events: concurrentRepo.repository,
    postPublicRecord: async () => ({}),
    logger: silentLogger,
  });
  assert.equal(concurrentResult, 'already-cancelled');
  assert.equal(concurrent.edits[0], EVENT_MESSAGES.alreadyCancelled);
});

test('/event cancel keeps the cancelled row when the public notice fails', async () => {
  const interaction = new FakeEventInteraction({ subcommand: 'cancel' });
  const { repository, cancelled } = makeRepository({
    existingEvent: makeEvent(),
  });

  const result = await handleEventInteraction(interaction, {
    guildId: GUILD,
    events: repository,
    postPublicRecord: async () => {
      throw new Error('missing permissions');
    },
    logger: silentLogger,
  });

  assert.equal(result, 'cancelled-post-failed');
  assert.equal(cancelled.length, 1);
  assert.match(interaction.edits[0], /could not post the cancellation notice/);
});

test('/event cancel rejects invalid ids and foreign guilds', async () => {
  const invalid = new FakeEventInteraction({
    subcommand: 'cancel',
    eventId: 0,
  });
  const invalidRepo = makeRepository({
    existingEvent: makeEvent(),
  });
  const invalidResult = await handleEventInteraction(invalid, {
    guildId: GUILD,
    events: invalidRepo.repository,
    postPublicRecord: async () => ({}),
    logger: silentLogger,
  });
  assert.equal(invalidResult, 'invalid');
  assert.equal(invalid.replies[0]?.content, EVENT_MESSAGES.invalidId);
  assert.equal(invalid.deferrals, 0);

  const foreign = new FakeEventInteraction({
    subcommand: 'cancel',
    guildId: '999999999999999999',
  });
  const foreignRepo = makeRepository({
    existingEvent: makeEvent(),
  });
  const foreignResult = await handleEventInteraction(foreign, {
    guildId: GUILD,
    events: foreignRepo.repository,
    postPublicRecord: async () => ({}),
    logger: silentLogger,
  });
  assert.equal(foreignResult, 'wrong-guild');
  assert.equal(foreign.replies[0]?.ephemeral, true);
  assert.equal(foreignRepo.cancelled.length, 0);
});

test('event presentation fits Discord limits and keeps the confirmation honest', () => {
  const record = formatEventPublicRecord({
    id: 169,
    title: 'x'.repeat(190),
    startAt: new Date('2026-11-22T04:30:00.000Z'),
    endAt: null,
    description: 'y'.repeat(1_000),
    organizerUsername: 'organizer',
  });
  assert.ok(record.length <= 2_000);
  assert.match(record, /New event: xxx/);
  assert.match(record, /Event ID: 169/);
  assert.match(record, /Added by organizer/);

  const truncated = fitDiscordContent(`line\n${'z'.repeat(3_000)}`);
  assert.ok(truncated.length <= 2_000);
  assert.match(truncated, /\[truncated\]/);

  const confirmation = formatEventConfirmation(
    {
      id: 169,
      title: 'Hackathon',
      startAt: new Date('2026-11-22T04:30:00.000Z'),
      endAt: null,
    },
    false,
  );
  assert.match(confirmation, /could not post the public record/);

  const cancelled = formatEventCancelledRecord({
    id: 169,
    title: 'Hackathon',
    startAt: new Date('2026-11-22T04:30:00.000Z'),
    endAt: null,
    cancelledBy: 'organizer',
  });
  assert.match(cancelled, /Event cancelled: Hackathon/);
  assert.match(cancelled, /Event ID: 169/);
  assert.match(cancelled, /Cancelled by organizer/);

  const cancelConfirmation = formatEventCancellationConfirmation(
    {
      id: 169,
      title: 'Hackathon',
      startAt: new Date('2026-11-22T04:30:00.000Z'),
      endAt: null,
    },
    false,
  );
  assert.match(cancelConfirmation, /could not post the cancellation notice/);
});
