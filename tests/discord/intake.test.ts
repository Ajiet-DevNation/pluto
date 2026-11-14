import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleMessageCreate,
  passesStaticMessageFilters,
  shouldIndexMessage,
  toIndexRecord,
} from '../../src/discord/intake';
import { InMemoryDiscordStore } from '../../src/discord/store';
import {
  CHANNELS,
  CORE_SECRETS_ID,
  GUILD,
  OTHER_VISIBLE_ID,
  OUTPUT,
  makeContext,
  makeMessage,
} from './helpers';

test('accepts a human message in each of the four allowlisted channels', () => {
  const context = makeContext();
  for (const channelId of Object.values(CHANNELS)) {
    assert.equal(
      passesStaticMessageFilters(makeMessage({ channelId }), context),
      true,
      `channel ${channelId} should be indexed`,
    );
  }
});

test('rejects a visible channel that is not in the allowlist (#core-secrets)', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ channelId: CORE_SECRETS_ID }), context),
    false,
  );
});

test('rejects another visible channel that is not in the allowlist', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ channelId: OTHER_VISIBLE_ID }), context),
    false,
  );
});

test('rejects the bot output channel even if a message appears there', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ channelId: OUTPUT }), context),
    false,
  );
});

test('rejects bot-authored messages', () => {
  const context = makeContext();
  const message = makeMessage({ author: { id: '999', bot: true } });
  assert.equal(passesStaticMessageFilters(message, context), false);
});

test('rejects the bot itself even if author.bot is false', () => {
  const context = makeContext();
  const message = makeMessage({
    author: { id: context.botUserId, bot: false },
  });
  assert.equal(passesStaticMessageFilters(message, context), false);
});

test('rejects system messages', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ system: true }), context),
    false,
  );
});

test('rejects empty and whitespace-only messages', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ content: '' }), context),
    false,
  );
  assert.equal(
    passesStaticMessageFilters(makeMessage({ content: '   \n\t ' }), context),
    false,
  );
});

test('rejects messages from another guild', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(
      makeMessage({ guildId: '1422593925658579999' }),
      context,
    ),
    false,
  );
});

test('rejects direct messages', () => {
  const context = makeContext();
  assert.equal(
    passesStaticMessageFilters(makeMessage({ guildId: null }), context),
    false,
  );
});

test('shouldIndexMessage rejects an opted-out author', async () => {
  const store = new InMemoryDiscordStore();
  const message = makeMessage();
  await store.optOut(GUILD, message.author.id, message.author.id);
  assert.equal(await shouldIndexMessage(message, makeContext(store)), false);
});

test('shouldIndexMessage accepts an author who has not opted out', async () => {
  const context = makeContext();
  assert.equal(await shouldIndexMessage(makeMessage(), context), true);
});

test('toIndexRecord maps the message into the shared Discord record shape', () => {
  const context = makeContext();
  const message = makeMessage({
    id: '1000000000000000042',
    content: 'Decision: ship the Discord indexer first.',
  });

  const record = toIndexRecord(message, context);

  assert.equal(record.sourceType, 'discord');
  assert.equal(record.guildId, GUILD);
  assert.equal(record.channelId, CHANNELS['#project-stack']);
  assert.equal(record.messageId, message.id);
  assert.equal(record.authorId, message.author.id);
  assert.equal(record.authorIsBot, false);
  assert.equal(record.content, message.content);
  assert.equal(record.createdAt, '2026-11-14T10:00:00.000Z');
  assert.equal(record.indexedAt, '2026-11-14T12:00:00.000Z');
  assert.equal(
    record.sourceUrl,
    `https://discord.com/channels/${GUILD}/${message.channelId}/${message.id}`,
  );
});

test('toIndexRecord refuses to build a citation for the output channel', () => {
  const context = makeContext();
  assert.throws(
    () => toIndexRecord(makeMessage({ channelId: OUTPUT }), context),
    /Refusing to cite channel/,
  );
});

test('handleMessageCreate indexes a qualifying gateway message', async () => {
  const store = new InMemoryDiscordStore();
  const result = await handleMessageCreate(makeMessage(), makeContext(store));

  assert.equal(result, 'indexed');
  const records = await store.listRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].messageId, '1000000000000000001');
});

test('handleMessageCreate ignores a bot-authored message', async () => {
  const store = new InMemoryDiscordStore();
  const result = await handleMessageCreate(
    makeMessage({ author: { id: '999', bot: true } }),
    makeContext(store),
  );

  assert.equal(result, 'ignored');
  assert.deepEqual(await store.listRecords(), []);
});

test('handleMessageCreate reports a store failure without throwing', async () => {
  class FailingStore extends InMemoryDiscordStore {
    async upsert(): Promise<void> {
      throw new Error('disk full');
    }
  }

  const result = await handleMessageCreate(
    makeMessage(),
    makeContext(new FailingStore()),
  );
  assert.equal(result, 'error');
});
