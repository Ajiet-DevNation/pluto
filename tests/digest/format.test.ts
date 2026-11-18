import test from 'node:test';
import assert from 'node:assert/strict';
import { DIGEST_FOOTER, formatDigest } from '../../src/digest/format';
import type { DigestReport } from '../../src/digest/service';

const FROM = new Date('2026-11-11T06:30:00.000Z'); // 11 Nov 2026, 12:00 IST
const TO = new Date('2026-11-18T06:30:00.000Z'); // 18 Nov 2026, 12:00 IST

function report(overrides: Partial<DigestReport> = {}): DigestReport {
  return {
    days: 7,
    from: FROM,
    to: TO,
    githubIssues: [
      {
        githubId: 1,
        number: 12,
        title: 'Fix login',
        htmlUrl: 'https://github.com/Ajiet-DevNation/pluto/issues/12',
        repositoryFullName: 'Ajiet-DevNation/pluto',
        createdAt: new Date('2026-11-17T06:30:00.000Z'),
      },
    ],
    githubIssueCount: 2,
    discordMessageCount: 10,
    decisionsMessageCount: 3,
    upcomingMeetingCount: 1,
    upcomingMeetings: [
      {
        id: 'm1',
        title: 'Standup',
        startAt: new Date('2026-11-22T04:30:00.000Z'),
        sourceMessageUrl: 'https://discord.com/channels/1/2/3',
      },
    ],
    upcomingEventCount: 0,
    upcomingEvents: [],
    ...overrides,
  };
}

test('digest renders only counts, links and the honest date caveat', () => {
  const output = formatDigest(report());

  assert.match(output, /^Activity digest — last 7 days/);
  assert.match(
    output,
    /Window: 11 Nov 2026, 12:00 PM IST → 18 Nov 2026, 12:00 PM IST/,
  );
  assert.match(output, /GitHub issues created: 2/);
  assert.match(output, /Discord messages indexed: 10/);
  assert.match(output, /• #decisions: 3/);
  assert.match(output, /Upcoming meetings: 1/);
  assert.match(output, /Sun, 22 Nov 2026, 10:00 AM IST — Standup/);
  assert.match(output, /https:\/\/discord\.com\/channels\/1\/2\/3/);
  assert.match(output, /Upcoming events: none/);
  assert.match(output, /Recent GitHub issues/);
  assert.match(
    output,
    /Ajiet-DevNation\/pluto#12 — Fix login/,
  );
  assert.match(output, /https:\/\/github\.com\/Ajiet-DevNation\/pluto\/issues\/12/);
  assert.match(output, new RegExp(DIGEST_FOOTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(
    /(pull requests?|commits?) (created|merged|pushed|made)/i.test(output),
    false,
  );
});

test('digest handles an empty period without fabricating activity', () => {
  const output = formatDigest(
    report({
      githubIssues: [],
      githubIssueCount: 0,
      discordMessageCount: 0,
      decisionsMessageCount: 0,
      upcomingMeetingCount: 0,
      upcomingMeetings: [],
      upcomingEventCount: 0,
      upcomingEvents: [],
    }),
  );

  assert.match(
    output,
    /No indexed GitHub issues, Discord messages, or #decisions messages were recorded in this period\./,
  );
  assert.match(output, /Upcoming meetings: none/);
  assert.match(output, /Upcoming events: none/);
  assert.equal(output.includes('Recent GitHub issues'), false);
  assert.equal(output.includes('GitHub issues created: 0'), false);
});

test('digest uses singular wording for a one-day window', () => {
  const output = formatDigest(report({ days: 1 }));
  assert.match(output, /^Activity digest — last 1 day\n/);
});

test('digest shows the decisions subset even when the window has other messages', () => {
  const output = formatDigest(
    report({ decisionsMessageCount: 0, upcomingEventCount: 0 }),
  );
  assert.match(output, /Discord messages indexed: 10/);
  assert.match(output, /• #decisions: 0/);
});

test('digest output stays within the Discord message limit', () => {
  const longIssue = (index: number) => ({
    githubId: index,
    number: index,
    title: `Issue ${index} ${'x'.repeat(600)}`,
    htmlUrl: `https://github.com/Ajiet-DevNation/pluto/issues/${index}/${'y'.repeat(
      300,
    )}`,
    repositoryFullName: 'Ajiet-DevNation/pluto',
    createdAt: new Date('2026-11-17T06:30:00.000Z'),
  });
  const output = formatDigest(
    report({
      githubIssues: Array.from({ length: 100 }, (_, index) =>
        longIssue(index),
      ),
      githubIssueCount: 100,
    }),
  );

  assert.ok(output.length <= 2_000);
  assert.match(output, /\[truncated\]/);
});
