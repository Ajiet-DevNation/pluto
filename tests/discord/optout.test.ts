import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleOptOutInteraction,
  OPTOUT_MESSAGES,
} from '../../src/optout/command';
import { InMemoryDiscordStore } from '../../src/discord/store';
import { FakeInteraction, GUILD, makeRecord, silentLogger } from './helpers';

function dependencies(store: InMemoryDiscordStore) {
  return {
    guildId: GUILD,
    optOutStore: store,
    indexStore: store,
    logger: silentLogger,
  };
}

test('ignores interactions that are not chat input commands', async () => {
  const store = new InMemoryDiscordStore();
  const interaction = new FakeInteraction({ command: false });
  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'ignored');
  assert.deepEqual(interaction.replies, []);
});

test('ignores other chat input commands', async () => {
  const store = new InMemoryDiscordStore();
  const interaction = new FakeInteraction({ commandName: 'ask' });
  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'ignored');
  assert.deepEqual(interaction.replies, []);
});

test('rejects use outside the configured guild', async () => {
  const store = new InMemoryDiscordStore();
  const interaction = new FakeInteraction({
    guildId: '1422593925658579999',
  });
  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'wrong-guild');
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.wrongGuild, ephemeral: true },
  ]);
  assert.equal(await store.isOptedOut(GUILD, interaction.user.id), false);
});

test('/optout records the opt-out and purges existing records', async () => {
  const store = new InMemoryDiscordStore();
  await store.upsert(makeRecord());
  const interaction = new FakeInteraction();

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'opted-out');
  assert.equal(await store.isOptedOut(GUILD, interaction.user.id), true);
  assert.deepEqual(await store.listRecords(), []);
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.optedOut, ephemeral: true },
  ]);
});

test('/optout is idempotent and still purges stale records', async () => {
  const store = new InMemoryDiscordStore();
  const interaction = new FakeInteraction();
  await store.optOut(GUILD, interaction.user.id, interaction.user.id);
  await store.upsert(makeRecord());

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'already-opted-out');
  assert.deepEqual(await store.listRecords(), []);
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.already, ephemeral: true },
  ]);
});

test('/optout reports a read failure without claiming success', async () => {
  class ReadFailureStore extends InMemoryDiscordStore {
    async isOptedOut(): Promise<boolean> {
      throw new Error('database unavailable');
    }
  }
  const store = new ReadFailureStore();
  const interaction = new FakeInteraction();

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'error');
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.error, ephemeral: true },
  ]);
});

test('/optout reports a write failure without claiming success', async () => {
  class WriteFailureStore extends InMemoryDiscordStore {
    async optOut(): Promise<void> {
      throw new Error('database unavailable');
    }
  }
  const store = new WriteFailureStore();
  const interaction = new FakeInteraction();

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'error');
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.error, ephemeral: true },
  ]);
});

test('/optout remains successful when the purge alone fails', async () => {
  class PurgeFailureStore extends InMemoryDiscordStore {
    async removeAuthor(): Promise<number> {
      throw new Error('purge failed');
    }
  }
  const store = new PurgeFailureStore();
  const interaction = new FakeInteraction();

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'opted-out');
  assert.equal(await store.isOptedOut(GUILD, interaction.user.id), true);
  assert.deepEqual(interaction.replies, [
    { content: OPTOUT_MESSAGES.optedOut, ephemeral: true },
  ]);
});

test('/optout does not throw when Discord rejects the reply', async () => {
  const store = new InMemoryDiscordStore();
  const interaction = new FakeInteraction({
    replyError: new Error('interaction expired'),
  });

  const result = await handleOptOutInteraction(interaction, dependencies(store));

  assert.equal(result, 'error');
  assert.equal(await store.isOptedOut(GUILD, interaction.user.id), true);
});
