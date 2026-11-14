import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('commandPayloads contains exactly the /optout command', () => {
  const payloads = commandPayloads();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].name, 'optout');
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
  assert.equal(received?.length, 1);
  assert.equal(received?.[0].name, 'optout');
});
