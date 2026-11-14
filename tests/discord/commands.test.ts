import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askCommand,
  commandPayloads,
  optOutCommand,
  registerGuildCommands,
  type CommandPayload,
  type GuildCommandManager,
} from '../../src/discord/commands';

test('/optout is guild-only and needs no member permission', () => {
  const json = optOutCommand.toJSON();

  assert.equal(json.name, 'optout');
  assert.equal(
    json.description,
    'Opt out of Pluto indexing your Discord messages.',
  );
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.deepEqual(json.options ?? [], []);
  assert.equal(
    (json as { default_member_permissions?: string }).default_member_permissions,
    undefined,
  );
});

test('/ask is guild-only and requires a question', () => {
  const json = askCommand.toJSON();

  assert.equal(json.name, 'ask');
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.equal(json.options?.length, 1);
  assert.equal(json.options?.[0].name, 'question');
  assert.equal(json.options?.[0].required, true);
});

test('commandPayloads contains exactly /optout and /ask', () => {
  const payloads = commandPayloads();
  assert.deepEqual(payloads.map((payload) => payload.name), ['optout', 'ask']);
});

test('registerGuildCommands registers through the supplied guild manager', async () => {
  let received: CommandPayload[] | undefined;
  let calls = 0;
  const manager: GuildCommandManager = {
    async set(commands) {
      calls += 1;
      received = commands;
      return [];
    },
  };

  await registerGuildCommands(manager);

  assert.equal(calls, 1);
  assert.deepEqual(received?.map((payload) => payload.name), ['optout', 'ask']);
});
