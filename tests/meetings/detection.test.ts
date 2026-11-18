import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMeetingAnnouncement,
  type AnnouncementMessage,
} from '../../src/meetings/detection.js';

const GUILD = '1422593925658579036';
const MEETING_PLANS = '1570872485933752502';
const OTHER_CHANNEL = '1423323863093088407';
const BOT_USER_ID = '300000000000000001';

function makeMessage(overrides: Partial<AnnouncedMessageFields> = {}): AnnouncementMessage {
  return {
    id: '1000000000000000001',
    guildId: GUILD,
    channelId: MEETING_PLANS,
    system: false,
    content: 'Team standup tomorrow at 10 AM',
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
    author: { id: '200000000000000001', bot: false },
    mentions: { everyone: true },
    ...overrides,
  };
}

type AnnouncedMessageFields = Partial<AnnouncementMessage>;

async function detect(message: AnnouncementMessage, isOptedOut?: (g: string, u: string) => Promise<boolean>) {
  return detectMeetingAnnouncement(message, {
    botUserId: BOT_USER_ID,
    isOptedOut,
  });
}

test('detects a real @everyone meeting announcement in #meeting-plans', async () => {
  const result = await detect(makeMessage());
  assert.equal(result.isCandidate, true);
});

test('detects a real @here meeting announcement', async () => {
  const result = await detect(makeMessage({ mentions: { everyone: true } }));
  assert.equal(result.isCandidate, true);
});

test('rejects text-only @everyone lookalike without mention metadata', async () => {
  const result = await detect(makeMessage({ mentions: undefined, content: 'Hello @everyone standup' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'no-mention');
});

test('rejects a message with no mention', async () => {
  const result = await detect(makeMessage({ mentions: undefined, content: 'Team standup tomorrow' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'no-mention');
});

test('rejects a bot-authored message', async () => {
  const result = await detect(makeMessage({ author: { id: '999', bot: true } }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'bot-author');
});

test('rejects the bot itself even when author.bot is false', async () => {
  const result = await detect(makeMessage({ author: { id: BOT_USER_ID, bot: false } }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'self-author');
});

test('accepts a human author in #meeting-plans', async () => {
  const result = await detect(makeMessage({ author: { id: '200000000000000001', bot: false } }));
  assert.equal(result.isCandidate, true);
});

test('rejects a meeting announcement in a non-#meeting-plans channel', async () => {
  const result = await detect(makeMessage({ channelId: OTHER_CHANNEL }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'wrong-channel');
});

test('rejects empty content', async () => {
  const result = await detect(makeMessage({ content: '' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'empty-content');
});

test('rejects whitespace-only content', async () => {
  const result = await detect(makeMessage({ content: '   \n\t ' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'empty-content');
});

test('rejects a system message', async () => {
  const result = await detect(makeMessage({ system: true }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'system-message');
});

test('requires meeting-related language in addition to the mention', async () => {
  const result = await detect(makeMessage({ content: 'Hello everyone, pizza party!' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'no-meeting-language');
});

test('accepts each approved meeting keyword', async () => {
  for (const keyword of ['meeting', 'meet', 'standup', 'sync', 'call', 'review', 'session', 'discussion']) {
    const result = await detect(makeMessage({ content: `Project ${keyword} tomorrow at 4 PM` }));
    assert.equal(result.isCandidate, true, `keyword ${keyword} should be accepted`);
  }
});

test('is case-insensitive for meeting keywords', async () => {
  const result = await detect(makeMessage({ content: 'STANDUP tomorrow at 9 AM' }));
  assert.equal(result.isCandidate, true);
});

test('ignores messages from another guild', async () => {
  const result = await detect(makeMessage({ guildId: '999999999999999999' }));
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'wrong-guild');
});

test('rejects an opted-out author', async () => {
  const result = await detect(makeMessage(), async () => true);
  assert.equal(result.isCandidate, false);
  assert.equal(result.reason, 'opted-out');
});

test('accepts a non-opted-out author', async () => {
  const result = await detect(makeMessage(), async () => false);
  assert.equal(result.isCandidate, true);
});
