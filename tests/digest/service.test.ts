import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDigestService,
  DIGEST_DEFAULT_DAYS,
  normalizeDigestDays,
  type DigestServiceDependencies,
} from '../../src/digest/service';
import type { DiscordIndexRecord } from '../../src/discord/types';
import type { DigestIssue } from '../../src/digest/issues';

const GUILD = '1422593925658579036';
const PROJECT_STACK = '1423323863093088407';
const DECISIONS = '1571564343995277492';
const NOT_INDEXED = '1422593926367547499';
const NOW = new Date('2026-11-18T06:30:00.000Z');

function record(
  overrides: Partial<DiscordIndexRecord> = {},
): DiscordIndexRecord {
  return {
    sourceType: 'discord',
    guildId: GUILD,
    channelId: PROJECT_STACK,
    messageId: `m-${Math.random()}`,
    authorId: 'author',
    authorIsBot: false,
    content: 'message',
    createdAt: '2026-11-17T06:30:00.000Z',
    indexedAt: '2026-11-17T06:30:00.000Z',
    sourceUrl: 'https://discord.com/channels/1/2/3',
    ...overrides,
  };
}

function issue(number: number, createdAt: Date): DigestIssue {
  return {
    githubId: number,
    number,
    title: `Issue ${number}`,
    htmlUrl: `https://github.com/Ajiet-DevNation/pluto/issues/${number}`,
    repositoryFullName: 'Ajiet-DevNation/pluto',
    createdAt,
  };
}

function makeDependencies(
  overrides: Partial<DigestServiceDependencies> = {},
): DigestServiceDependencies {
  const issues = [
    issue(1, new Date(NOW.getTime() - 24 * 60 * 60 * 1000)),
    issue(2, new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)),
  ];
  return {
    listIssuesCreatedBetween: async (from, to) =>
      issues.filter((entry) => entry.createdAt >= from && entry.createdAt <= to),
    listDiscordRecords: async () => [
      record(),
      record({ channelId: DECISIONS, messageId: 'd1' }),
      record({ channelId: DECISIONS, messageId: 'd2' }),
      record({ channelId: NOT_INDEXED, messageId: 'x1' }),
      record({ guildId: 'other-guild', messageId: 'x2' }),
      record({
        messageId: 'old',
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
      record({ messageId: 'bot', authorIsBot: true }),
    ],
    upcoming: {
      listMeetings: async () => [
        {
          id: 'm1',
          title: 'Standup',
          startAt: new Date('2026-11-22T04:30:00.000Z'),
          sourceMessageUrl: 'https://discord.com/channels/1/2/3',
        },
      ],
      countMeetings: async () => 3,
      listEvents: async () => [
        {
          id: 1,
          title: 'Hackathon',
          description: null,
          startAt: new Date('2026-11-22T04:30:00.000Z'),
          endAt: null,
        },
      ],
      countEvents: async () => 1,
    },
    decisionsChannelId: DECISIONS,
    indexedChannelIds: new Set([PROJECT_STACK, DECISIONS]),
    isOptedOut: async () => false,
    now: () => NOW,
    ...overrides,
  };
}

test('digest days default to 7 and only accept whole numbers in 1–30', () => {
  assert.equal(normalizeDigestDays(undefined), DIGEST_DEFAULT_DAYS);
  assert.equal(normalizeDigestDays(null), DIGEST_DEFAULT_DAYS);
  assert.equal(normalizeDigestDays(1), 1);
  assert.equal(normalizeDigestDays(30), 30);
  assert.equal(normalizeDigestDays(0), null);
  assert.equal(normalizeDigestDays(31), null);
  assert.equal(normalizeDigestDays(2.5), null);
  assert.equal(normalizeDigestDays(Number.NaN), null);
});

test('digest counts indexed records for the guild and window only', async () => {
  const service = createDigestService(makeDependencies());
  const report = await service.build({ guildId: GUILD });

  assert.equal(report.days, 7);
  assert.equal(report.from.toISOString(), '2026-11-11T06:30:00.000Z');
  assert.equal(report.to.toISOString(), NOW.toISOString());
  assert.equal(report.githubIssueCount, 2);
  assert.equal(report.discordMessageCount, 3);
  assert.equal(report.decisionsMessageCount, 2);
  assert.equal(report.upcomingMeetingCount, 3);
  assert.equal(report.upcomingMeetings.length, 1);
  assert.equal(report.upcomingEventCount, 1);
  assert.equal(report.upcomingEvents.length, 1);
});

test('digest excludes non-allowlisted, foreign-guild, bot and out-of-window records', async () => {
  const service = createDigestService(makeDependencies());
  const report = await service.build({ guildId: GUILD, days: 7 });

  assert.equal(
    report.discordMessageCount,
    3,
    'only allowlisted, human-authored, in-window records are counted',
  );
  assert.equal(report.decisionsMessageCount, 2);
});

test('digest honours an explicit day window', async () => {
  let receivedFrom: Date | undefined;
  let receivedTo: Date | undefined;
  const service = createDigestService(
    makeDependencies({
      listIssuesCreatedBetween: async (from, to) => {
        receivedFrom = from;
        receivedTo = to;
        return [];
      },
    }),
  );

  const report = await service.build({ guildId: GUILD, days: 1 });
  assert.equal(report.days, 1);
  assert.equal(receivedFrom?.toISOString(), '2026-11-17T06:30:00.000Z');
  assert.equal(receivedTo?.toISOString(), NOW.toISOString());
});

test('digest handles an empty period without inventing activity', async () => {
  const service = createDigestService(
    makeDependencies({
      listIssuesCreatedBetween: async () => [],
      listDiscordRecords: async () => [],
      upcoming: {
        listMeetings: async () => [],
        countMeetings: async () => 0,
        listEvents: async () => [],
        countEvents: async () => 0,
      },
    }),
  );

  const report = await service.build({ guildId: GUILD });
  assert.equal(report.githubIssueCount, 0);
  assert.equal(report.discordMessageCount, 0);
  assert.equal(report.decisionsMessageCount, 0);
  assert.equal(report.upcomingMeetingCount, 0);
  assert.equal(report.upcomingEventCount, 0);
  assert.deepEqual(report.githubIssues, []);
  assert.deepEqual(report.upcomingMeetings, []);
  assert.deepEqual(report.upcomingEvents, []);
});

test('digest treats a missing #decisions channel as zero, not an error', async () => {
  const service = createDigestService(
    makeDependencies({ decisionsChannelId: null }),
  );
  const report = await service.build({ guildId: GUILD });
  assert.equal(report.decisionsMessageCount, 0);
});

test('digest filters opted-out authors even if their records were not purged', async () => {
  const service = createDigestService(
    makeDependencies({
      listDiscordRecords: async () => [
        record({ authorId: 'opted-out' }),
        record({ authorId: 'opted-out', channelId: DECISIONS }),
        record({ authorId: 'allowed', messageId: 'allowed-1' }),
      ],
      isOptedOut: async (_guildId, userId) => userId === 'opted-out',
    }),
  );

  const report = await service.build({ guildId: GUILD });
  assert.equal(report.discordMessageCount, 1);
  assert.equal(report.decisionsMessageCount, 0);
});

test('digest rejects an out-of-range day value', async () => {
  const service = createDigestService(makeDependencies());
  await assert.rejects(
    service.build({ guildId: GUILD, days: 0 }),
    /days must be an integer/,
  );
  await assert.rejects(
    service.build({ guildId: GUILD, days: 31 }),
    /days must be an integer/,
  );
});
