import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askCommand,
  commandPayloads,
  digestCommand,
  eventCommand,
  helpCommand,
  optOutCommand,
  registerGuildCommands,
  upcomingCommand,
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

test('/digest is guild-only with a 1–30 day option defaulting to 7', () => {
  const json = digestCommand.toJSON();

  assert.equal(json.name, 'digest');
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.equal(json.options?.length, 1);
  const days = json.options?.[0] as {
    name?: string;
    required?: boolean;
    min_value?: number;
    max_value?: number;
  };
  assert.equal(days.name, 'days');
  assert.equal(days.required, false);
  assert.equal(days.min_value, 1);
  assert.equal(days.max_value, 30);
});

test('/upcoming exposes meetings and events subcommands', () => {
  const json = upcomingCommand.toJSON();

  assert.equal(json.name, 'upcoming');
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.deepEqual(
    (json.options ?? []).map((option) => option.name),
    ['meetings', 'events'],
  );
});

test('/event add and cancel are available to every member', () => {
  const json = eventCommand.toJSON();

  assert.equal(json.name, 'event');
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.equal(
    (json as { default_member_permissions?: string }).default_member_permissions,
    undefined,
  );
  assert.deepEqual(
    (json.options ?? []).map((option) => option.name),
    ['add', 'cancel'],
  );

  const add = json.options?.[0] as {
    options?: Array<{ name?: string; required?: boolean }>;
  };
  assert.deepEqual(
    (add.options ?? []).map((option) => option.name),
    ['title', 'date', 'time', 'end', 'description'],
  );
  assert.deepEqual(
    (add.options ?? [])
      .filter((option) => option.required)
      .map((option) => option.name),
    ['title', 'date', 'time'],
  );

  const cancel = json.options?.[1] as {
    options?: Array<{
      name?: string;
      required?: boolean;
      min_value?: number;
      type?: number;
    }>;
  };
  assert.equal(cancel.options?.length, 1);
  assert.equal(cancel.options?.[0].name, 'id');
  assert.equal(cancel.options?.[0].required, true);
  assert.equal(cancel.options?.[0].min_value, 1);
  assert.equal(cancel.options?.[0].type, 4); // integer
});

test('/help is guild-only and takes no options', () => {
  const json = helpCommand.toJSON();

  assert.equal(json.name, 'help');
  assert.equal((json as { dm_permission?: boolean }).dm_permission, false);
  assert.deepEqual(json.options ?? [], []);
});

test('commandPayloads contains the six v1 guild commands', () => {
  const payloads = commandPayloads();
  assert.deepEqual(payloads.map((payload) => payload.name), [
    'optout',
    'ask',
    'digest',
    'upcoming',
    'event',
    'help',
  ]);
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
  assert.deepEqual(received?.map((payload) => payload.name), [
    'optout',
    'ask',
    'digest',
    'upcoming',
    'event',
    'help',
  ]);
});
