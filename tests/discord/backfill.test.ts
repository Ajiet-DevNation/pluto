import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backfillChannel,
  compareSnowflakes,
  runStartupBackfill,
  type BackfillChannel,
} from '../../src/discord/backfill';
import { InMemoryDiscordStore } from '../../src/discord/store';
import type { AuthoredMessage } from '../../src/discord/types';
import {
  CHANNELS,
  CORE_SECRETS_ID,
  GUILD,
  makeContext,
  makeMessage,
  silentLogger,
} from './helpers';

interface FetchCall {
  after: string;
  limit: number;
}

function channelWithPages(
  pages: AuthoredMessage[][],
  calls: FetchCall[] = [],
  channelId: string = CHANNELS['#project-stack'],
): BackfillChannel {
  let index = 0;
  return {
    channelId,
    channelName: '#project-stack',
    fetchPage: async (after, limit) => {
      calls.push({ after, limit });
      const page = pages[index] ?? [];
      index += 1;
      return page;
    },
  };
}

test('backfill starts at after=0 when no cursor exists', async () => {
  const store = new InMemoryDiscordStore();
  const calls: FetchCall[] = [];
  const channel = channelWithPages(
    [[makeMessage({ id: '1000000000000000001' }), makeMessage({ id: '1000000000000000002' })]],
    calls,
  );

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    logger: silentLogger,
  });

  assert.deepEqual(calls[0], { after: '0', limit: 100 });
  assert.equal(result.indexed, 2);
  assert.equal(result.cursor, '1000000000000000002');
  assert.equal(
    await store.getLastMessageId(GUILD, channel.channelId),
    '1000000000000000002',
  );
});

test('backfill resumes from the stored cursor', async () => {
  const store = new InMemoryDiscordStore();
  const channelId = CHANNELS['#project-stack'];
  await store.setLastMessageId(GUILD, channelId, '1000000000000000050');

  const calls: FetchCall[] = [];
  const channel = channelWithPages(
    [[makeMessage({ id: '1000000000000000051' })]],
    calls,
    channelId,
  );

  await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    logger: silentLogger,
  });

  assert.deepEqual(calls[0], { after: '1000000000000000050', limit: 100 });
});

test('backfill sorts each page ascending and advances to the highest id', async () => {
  const store = new InMemoryDiscordStore();
  const channel = channelWithPages([
    [
      makeMessage({ id: '1000000000000000003' }),
      makeMessage({ id: '1000000000000000001' }),
      makeMessage({ id: '1000000000000000002' }),
    ],
  ]);

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    logger: silentLogger,
  });

  assert.equal(result.cursor, '1000000000000000003');
  assert.deepEqual(
    (await store.listRecords()).map((record) => record.messageId),
    [
      '1000000000000000001',
      '1000000000000000002',
      '1000000000000000003',
    ],
  );
});

test('backfill continues while pages are full and stops on a short page', async () => {
  const store = new InMemoryDiscordStore();
  const calls: FetchCall[] = [];
  const channel = channelWithPages(
    [
      [
        makeMessage({ id: '1000000000000000001' }),
        makeMessage({ id: '1000000000000000002' }),
      ],
      [makeMessage({ id: '1000000000000000003' })],
    ],
    calls,
  );

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    pageSize: 2,
    logger: silentLogger,
  });

  assert.equal(result.indexed, 3);
  assert.deepEqual(calls, [
    { after: '0', limit: 2 },
    { after: '1000000000000000002', limit: 2 },
  ]);
});

test('backfill advances the cursor even when every message is filtered out', async () => {
  const store = new InMemoryDiscordStore();
  const channel = channelWithPages(
    [
      [
        makeMessage({ id: '1000000000000000001', author: { id: '999', bot: true } }),
        makeMessage({ id: '1000000000000000002', author: { id: '998', bot: true } }),
      ],
      [],
    ],
  );

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    pageSize: 2,
    logger: silentLogger,
  });

  assert.equal(result.indexed, 0);
  assert.equal(result.skipped, 2);
  assert.equal(result.cursor, '1000000000000000002');
  assert.deepEqual(await store.listRecords(), []);
});

test('backfill applies allowlist, bot and opt-out filters', async () => {
  const store = new InMemoryDiscordStore();
  const optedOutAuthor = '200000000000000099';
  await store.optOut(GUILD, optedOutAuthor, optedOutAuthor);

  const channel = channelWithPages([
    [
      makeMessage({ id: '1000000000000000001' }),
      makeMessage({
        id: '1000000000000000002',
        author: { id: '999', bot: true },
      }),
      makeMessage({
        id: '1000000000000000003',
        author: { id: optedOutAuthor, bot: false },
      }),
      makeMessage({
        id: '1000000000000000004',
        channelId: CORE_SECRETS_ID,
      }),
    ],
  ]);

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    logger: silentLogger,
  });

  assert.equal(result.fetched, 4);
  assert.equal(result.indexed, 1);
  assert.equal(result.skipped, 3);
  assert.deepEqual(
    (await store.listRecords()).map((record) => record.messageId),
    ['1000000000000000001'],
  );
});

test('backfill retries a transient fetch failure', async () => {
  const store = new InMemoryDiscordStore();
  let attempts = 0;
  const channel: BackfillChannel = {
    channelId: CHANNELS['#project-stack'],
    fetchPage: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('rate limited');
      }
      return [makeMessage({ id: '1000000000000000001' })];
    },
  };

  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    maxAttempts: 2,
    retryDelayMs: 0,
    logger: silentLogger,
  });

  assert.equal(attempts, 2);
  assert.equal(result.indexed, 1);
});

test('startup backfill isolates one failing channel from the rest', async () => {
  const store = new InMemoryDiscordStore();
  const failing: BackfillChannel = {
    channelId: CHANNELS['#resources'],
    channelName: '#resources',
    fetchPage: async () => {
      throw new Error('permission denied');
    },
  };
  const working = channelWithPages(
    [[makeMessage({ id: '1000000000000000001' })]],
    [],
    CHANNELS['#announcements'],
  );

  const results = await runStartupBackfill([failing, working], {
    guildId: GUILD,
    context: makeContext(store),
    maxAttempts: 1,
    logger: silentLogger,
  });

  assert.equal(results.length, 2);
  assert.match(results[0].error ?? '', /permission denied/);
  assert.equal(results[1].indexed, 1);
});

test('backfill stops if the cursor would not advance', async () => {
  const store = new InMemoryDiscordStore();
  const channelId = CHANNELS['#project-stack'];
  await store.setLastMessageId(GUILD, channelId, '1000000000000000200');

  const channel = channelWithPages(
    [[makeMessage({ id: '1000000000000000200' })]],
    [],
    channelId,
  );
  const result = await backfillChannel(channel, {
    guildId: GUILD,
    context: makeContext(store),
    logger: silentLogger,
  });

  assert.equal(result.cursor, '1000000000000000200');
  assert.equal(
    await store.getLastMessageId(GUILD, channelId),
    '1000000000000000200',
  );
});

test('compareSnowflakes orders numeric ids by value', () => {
  assert.equal(
    compareSnowflakes('1000000000000000002', '1000000000000000001'),
    1,
  );
  assert.equal(
    compareSnowflakes('1000000000000000001', '1000000000000000002'),
    -1,
  );
  assert.equal(
    compareSnowflakes('1000000000000000001', '1000000000000000001'),
    0,
  );
});
