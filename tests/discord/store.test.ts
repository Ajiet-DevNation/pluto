import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDefaultStore,
  defaultStatePath,
  JsonDiscordStore,
} from '../../src/discord/store';
import { CHANNELS, GUILD, makeRecord } from './helpers';

const tempDirs: string[] = [];

after(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function newStore(): Promise<{ store: JsonDiscordStore; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'pluto-discord-store-'));
  tempDirs.push(directory);
  return {
    store: new JsonDiscordStore(join(directory, 'state.json')),
    directory,
  };
}

test('a new store starts empty', async () => {
  const { store } = await newStore();
  assert.deepEqual(await store.listRecords(), []);
  assert.equal(await store.getLastMessageId(GUILD, CHANNELS['#project-stack']), null);
  assert.equal(await store.isOptedOut(GUILD, 'user-1'), false);
});

test('opt-out persists across store instances', async () => {
  const { store, directory } = await newStore();
  await store.optOut(GUILD, 'user-1', 'admin-1');

  const reopened = new JsonDiscordStore(join(directory, 'state.json'));
  assert.equal(await reopened.isOptedOut(GUILD, 'user-1'), true);
  assert.equal(await reopened.isOptedOut('1422593925658579999', 'user-1'), false);
});

test('opt-in removes a stored opt-out', async () => {
  const { store } = await newStore();
  await store.optOut(GUILD, 'user-1', 'user-1');
  await store.optIn(GUILD, 'user-1');
  assert.equal(await store.isOptedOut(GUILD, 'user-1'), false);
});

test('removeAuthor removes only that guild and author', async () => {
  const { store } = await newStore();
  await store.upsert(makeRecord({ messageId: '1', authorId: 'author-a' }));
  await store.upsert(makeRecord({ messageId: '2', authorId: 'author-b' }));
  await store.upsert(
    makeRecord({
      messageId: '3',
      authorId: 'author-a',
      guildId: '1422593925658579999',
    }),
  );

  const removed = await store.removeAuthor(GUILD, 'author-a');
  assert.equal(removed, 1);
  assert.deepEqual(
    (await store.listRecords()).map((record) => record.messageId).sort(),
    ['2', '3'],
  );
});

test('the backfill cursor persists per channel', async () => {
  const { store, directory } = await newStore();
  const channelId = CHANNELS['#project-stack'];
  await store.setLastMessageId(GUILD, channelId, '1000000000000000099');

  const reopened = new JsonDiscordStore(join(directory, 'state.json'));
  assert.equal(
    await reopened.getLastMessageId(GUILD, channelId),
    '1000000000000000099',
  );
  assert.equal(
    await reopened.getLastMessageId(GUILD, CHANNELS['#resources']),
    null,
  );
});

test('the store refuses a bot-authored record', async () => {
  const { store } = await newStore();
  await assert.rejects(
    () => store.upsert(makeRecord({ authorIsBot: true })),
    /Refusing to store a bot-authored/,
  );
  assert.deepEqual(await store.listRecords(), []);
});

test('upsert is idempotent on message id', async () => {
  const { store } = await newStore();
  await store.upsert(makeRecord({ content: 'first' }));
  await store.upsert(makeRecord({ content: 'updated' }));

  const records = await store.listRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].content, 'updated');
});

test('listRecords returns copies that cannot mutate stored state', async () => {
  const { store } = await newStore();
  await store.upsert(makeRecord({ content: 'original' }));

  const firstRead = await store.listRecords();
  firstRead[0].content = 'mutated by caller';

  assert.equal((await store.listRecords())[0].content, 'original');
});

test('a corrupt state file fails closed instead of silently starting empty', async () => {
  const { store, directory } = await newStore();
  await writeFile(join(directory, 'state.json'), '{not valid json', 'utf8');

  await assert.rejects(
    () => store.isOptedOut(GUILD, 'user-1'),
    /Failed to load Discord state/,
  );
});

test('defaultStatePath honours PLUTO_DATA_DIR and otherwise stays outside the repo', () => {
  const configured = join(tmpdir(), 'pluto-custom-state');
  assert.equal(
    defaultStatePath({ PLUTO_DATA_DIR: configured }),
    join(configured, 'discord-state.json'),
  );

  const fallback = defaultStatePath({});
  assert.match(fallback, /discord-state\.json$/);
  assert.equal(fallback.includes('pluto\\data\\'), false);
});

test('createDefaultStore returns the JSON store implementation', () => {
  const configured = join(tmpdir(), 'pluto-custom-state');
  const store = createDefaultStore({ PLUTO_DATA_DIR: configured });
  assert.ok(store instanceof JsonDiscordStore);
});
