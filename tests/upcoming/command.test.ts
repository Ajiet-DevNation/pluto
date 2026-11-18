import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleUpcomingInteraction,
  type UpcomingInteraction,
} from '../../src/upcoming/command';
import {
  formatEventList,
  formatMeetingList,
  UPCOMING_MESSAGES,
} from '../../src/upcoming/format';
import { GUILD } from '../discord/helpers';

const NOW = new Date('2026-11-18T06:30:00.000Z'); // 12:00 IST

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeUpcomingInteraction implements UpcomingInteraction {
  readonly replies: Array<{ content: string; ephemeral: boolean }> = [];
  readonly edits: string[] = [];
  readonly deferOptions: Array<{ ephemeral?: boolean } | undefined> = [];
  deferrals = 0;

  commandName = 'upcoming';

  guildId: string | null;

  private readonly subcommand: string;

  constructor(options: { guildId?: string | null; subcommand?: string } = {}) {
    this.guildId = options.guildId === undefined ? GUILD : options.guildId;
    this.subcommand = options.subcommand ?? 'meetings';
  }

  isChatInputCommand(): boolean {
    return true;
  }

  get options(): UpcomingInteraction['options'] {
    return { getSubcommand: () => this.subcommand };
  }

  async reply(options: { content: string; ephemeral: boolean }): Promise<unknown> {
    this.replies.push(options);
    return undefined;
  }

  async deferReply(options?: { ephemeral?: boolean }): Promise<unknown> {
    this.deferrals += 1;
    this.deferOptions.push(options);
    return undefined;
  }

  async editReply(options: { content: string }): Promise<unknown> {
    this.edits.push(options.content);
    return undefined;
  }
}

const meetings = [
  {
    id: 'm1',
    title: 'Standup',
    startAt: new Date('2026-11-22T04:30:00.000Z'),
    sourceMessageUrl: 'https://discord.com/channels/1/2/3',
  },
];

const events = [
  {
    id: 1,
    title: 'Hackathon',
    description: 'Bring a laptop.',
    startAt: new Date('2026-11-22T04:30:00.000Z'),
    endAt: new Date('2026-11-22T06:30:00.000Z'),
  },
];

test('/upcoming rejects a foreign guild', async () => {
  const interaction = new FakeUpcomingInteraction({ guildId: '999999999999999999' });
  const result = await handleUpcomingInteraction(interaction, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async () => meetings,
      listEvents: async () => events,
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'wrong-guild');
  assert.equal(interaction.replies[0]?.content, UPCOMING_MESSAGES.wrongGuild);
  assert.equal(interaction.replies[0]?.ephemeral, true);
  assert.equal(interaction.edits.length, 0);
});

test('/upcoming meetings lists confirmed meetings with their source link', async () => {
  const interaction = new FakeUpcomingInteraction({ subcommand: 'meetings' });
  let eventsCalled = 0;
  const result = await handleUpcomingInteraction(interaction, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async (guildId, now) => {
        assert.equal(guildId, GUILD);
        assert.equal(now.getTime(), NOW.getTime());
        return meetings;
      },
      listEvents: async () => {
        eventsCalled += 1;
        return events;
      },
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'listed');
  assert.equal(eventsCalled, 0);
  assert.equal(interaction.deferrals, 1);
  assert.equal(interaction.deferOptions[0], undefined);
  assert.match(interaction.edits[0], /Confirmed upcoming meetings/);
  assert.match(
    interaction.edits[0],
    /Sun, 22 Nov 2026, 10:00 AM IST — Standup/,
  );
  assert.match(interaction.edits[0], /https:\/\/discord\.com\/channels\/1\/2\/3/);
});

test('/upcoming events lists scheduled events and marks ongoing ones', async () => {
  const interaction = new FakeUpcomingInteraction({ subcommand: 'events' });
  const result = await handleUpcomingInteraction(interaction, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async () => meetings,
      listEvents: async () => [
        ...events,
        {
          id: 2,
          title: 'Live now',
          description: null,
          startAt: new Date('2026-11-18T06:00:00.000Z'),
          endAt: new Date('2026-11-18T08:00:00.000Z'),
        },
      ],
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'listed');
  assert.match(interaction.edits[0], /Scheduled upcoming events/);
  assert.match(
    interaction.edits[0],
    /Sun, 22 Nov 2026, 10:00 AM–12:00 PM IST — Hackathon \(ID: 1\)/,
  );
  assert.match(interaction.edits[0], /Live now \(ID: 2\) \(ongoing\)/);
});

test('/upcoming handles empty lists honestly', async () => {
  const interaction = new FakeUpcomingInteraction({ subcommand: 'events' });
  const result = await handleUpcomingInteraction(interaction, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async () => [],
      listEvents: async () => [],
    },
    now: () => NOW,
    logger: silentLogger,
  });

  assert.equal(result, 'listed');
  assert.equal(interaction.edits[0], UPCOMING_MESSAGES.noEvents);
});

test('/upcoming reports unsupported subcommands and query failures', async () => {
  const unsupported = new FakeUpcomingInteraction({ subcommand: 'all' });
  const unsupportedResult = await handleUpcomingInteraction(unsupported, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async () => [],
      listEvents: async () => [],
    },
    now: () => NOW,
    logger: silentLogger,
  });
  assert.equal(unsupportedResult, 'unsupported-subcommand');
  assert.equal(unsupported.edits.length, 0);
  assert.equal(unsupported.replies.length, 0);

  const failing = new FakeUpcomingInteraction({ subcommand: 'meetings' });
  const failingResult = await handleUpcomingInteraction(failing, {
    guildId: GUILD,
    upcoming: {
      listMeetings: async () => {
        throw new Error('database down');
      },
      listEvents: async () => [],
    },
    now: () => NOW,
    logger: silentLogger,
  });
  assert.equal(failingResult, 'error');
  assert.equal(failing.edits[0], UPCOMING_MESSAGES.error);
});

test('upcoming formatters produce deterministic, bounded output', () => {
  assert.equal(formatMeetingList([]), UPCOMING_MESSAGES.noMeetings);
  assert.equal(formatEventList([], NOW), UPCOMING_MESSAGES.noEvents);

  const manyMeetings = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    title: `Meeting ${index} ${'x'.repeat(400)}`,
    startAt: new Date('2026-11-22T04:30:00.000Z'),
    sourceMessageUrl: `https://discord.com/channels/1/2/${index}`,
  }));
  const output = formatMeetingList(manyMeetings);
  assert.ok(output.length <= 2_000);
  assert.match(output, /\[truncated\]/);
});
