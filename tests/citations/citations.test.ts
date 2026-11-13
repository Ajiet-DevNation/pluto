import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationUrl,
  defaultCitationPolicy,
  renderCitations,
  CitationError,
} from '../../src/citations';
import type { Citation } from '../../src/citations';

const PLUTO_CHANNEL = '1570721649538502686';
const GUILD = '1422593925658579036';

test('builds GitHub commit, pull request and issue URLs', () => {
  assert.equal(
    citationUrl({ kind: 'github-commit', owner: 'Ajiet-DevNation', repo: 'pluto', sha: '823d07c1a3e' }),
    'https://github.com/Ajiet-DevNation/pluto/commit/823d07c1a3e',
  );
  assert.equal(
    citationUrl({ kind: 'github-pull-request', owner: 'Ajiet-DevNation', repo: 'pluto', number: 2 }),
    'https://github.com/Ajiet-DevNation/pluto/pull/2',
  );
  assert.equal(
    citationUrl({ kind: 'github-issue', owner: 'Ajiet-DevNation', repo: 'pluto', number: 7 }),
    'https://github.com/Ajiet-DevNation/pluto/issues/7',
  );
});

test('builds a Discord message link', () => {
  assert.equal(
    citationUrl(
      { kind: 'discord-message', guildId: GUILD, channelId: '1423323863093088407', messageId: '1300000000000000000' },
      { blockedChannelIds: [PLUTO_CHANNEL] },
    ),
    `https://discord.com/channels/${GUILD}/1423323863093088407/1300000000000000000`,
  );
});

test('refuses to cite the bot output channel', () => {
  assert.throws(
    () =>
      citationUrl(
        { kind: 'discord-message', guildId: GUILD, channelId: PLUTO_CHANNEL, messageId: '1300000000000000000' },
        { blockedChannelIds: [PLUTO_CHANNEL] },
      ),
    (error: unknown) => {
      assert.ok(error instanceof CitationError);
      assert.match(error.message, /blocked output channel/);
      return true;
    },
  );
});

test('default policy blocks the configured output channel', () => {
  const policy = defaultCitationPolicy({ DISCORD_OUTPUT_CHANNEL_ID: PLUTO_CHANNEL });
  assert.deepEqual(policy.blockedChannelIds, [PLUTO_CHANNEL]);
  assert.deepEqual(defaultCitationPolicy({}).blockedChannelIds, []);
});

test('builds a Miro board URL', () => {
  assert.equal(
    citationUrl({ kind: 'miro-board', boardId: 'uXjVH8abc=' }),
    'https://miro.com/app/board/uXjVH8abc=/',
  );
});

test('builds a meeting transcript link with a timestamp anchor', () => {
  assert.equal(
    citationUrl({
      kind: 'meeting-transcript',
      meetingId: 'meeting-2026-11-13',
      uri: 'https://r2.example.com/transcripts/meeting-2026-11-13.md',
    }),
    'https://r2.example.com/transcripts/meeting-2026-11-13.md',
  );
  assert.equal(
    citationUrl({
      kind: 'meeting-transcript',
      meetingId: 'meeting-2026-11-13',
      uri: 'https://r2.example.com/transcripts/meeting-2026-11-13.md',
      timestamp: '00:12:30',
    }),
    'https://r2.example.com/transcripts/meeting-2026-11-13.md#t=00%3A12%3A30',
  );
});

test('rejects a meeting citation without a real URL', () => {
  assert.throws(
    () => citationUrl({ kind: 'meeting-transcript', meetingId: 'm1', uri: 'not-a-url' }),
    CitationError,
  );
});

test('rejects malformed identifiers', () => {
  assert.throws(
    () => citationUrl({ kind: 'github-commit', owner: 'Ajiet-DevNation', repo: 'pluto', sha: 'nope!' }),
    CitationError,
  );
  assert.throws(
    () => citationUrl({ kind: 'github-issue', owner: 'Ajiet-DevNation', repo: 'pluto', number: 0 }),
    CitationError,
  );
  assert.throws(
    () =>
      citationUrl({
        kind: 'discord-message',
        guildId: 'not-a-snowflake',
        channelId: '1423323863093088407',
        messageId: '1300000000000000000',
      }),
    CitationError,
  );
});

test('renders a de-duplicated markdown list', () => {
  const citations: Citation[] = [
    { kind: 'github-issue', owner: 'Ajiet-DevNation', repo: 'pluto', number: 7 },
    { kind: 'github-issue', owner: 'Ajiet-DevNation', repo: 'pluto', number: 7 },
    { kind: 'github-pull-request', owner: 'Ajiet-DevNation', repo: 'pluto', number: 2 },
  ];

  const rendered = renderCitations(citations, { blockedChannelIds: [] });

  assert.equal(
    rendered,
    [
      '- [issue #7](https://github.com/Ajiet-DevNation/pluto/issues/7)',
      '- [PR #2](https://github.com/Ajiet-DevNation/pluto/pull/2)',
    ].join('\n'),
  );
});
