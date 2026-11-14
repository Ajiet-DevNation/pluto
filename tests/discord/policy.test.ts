import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEnvMatchesPolicy,
  buildDiscordPolicy,
  DiscordConfigError,
  loadDiscordPolicy,
  validateDiscordConfig,
  type RawDiscordConfig,
} from '../../src/discord/policy';
import { CHANNELS, GUILD, OUTPUT } from './helpers';

function validRaw(overrides: Partial<RawDiscordConfig> = {}): RawDiscordConfig {
  return {
    guild_id: GUILD,
    output_channel_id: OUTPUT,
    index_own_output_channel: false,
    indexed_channels: { ...CHANNELS },
    indexing_mode: 'allowlist',
    ...overrides,
  };
}

test('loadDiscordPolicy reads exactly the four v1 allowlisted channels', () => {
  const policy = loadDiscordPolicy();
  assert.equal(Object.keys(policy.indexedChannels).length, 4);
  assert.deepEqual(
    [...policy.indexedChannelIds].sort(),
    Object.values(CHANNELS).sort(),
  );
  for (const [name, id] of Object.entries(CHANNELS)) {
    assert.equal(policy.indexedChannels[name], id);
  }
  assert.equal(policy.indexedChannelIds.has(OUTPUT), false);
});

test('validateDiscordConfig rejects a non-allowlist indexing mode', () => {
  assert.throws(
    () => validateDiscordConfig(validRaw({ indexing_mode: 'exclude-all' })),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /allowlist/);
      return true;
    },
  );
});

test('validateDiscordConfig refuses to index the bot output channel', () => {
  assert.throws(
    () => validateDiscordConfig(validRaw({ index_own_output_channel: true })),
    DiscordConfigError,
  );
});

test('buildDiscordPolicy rejects an output channel that is also in the allowlist', () => {
  assert.throws(
    () =>
      buildDiscordPolicy({
        guildId: GUILD,
        outputChannelId: OUTPUT,
        indexedChannels: {
          ...CHANNELS,
          '#pluto': OUTPUT,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /output channel/i);
      return true;
    },
  );
});

test('buildDiscordPolicy rejects duplicate channel ids', () => {
  assert.throws(
    () =>
      buildDiscordPolicy({
        guildId: GUILD,
        outputChannelId: OUTPUT,
        indexedChannels: {
          '#project-stack': CHANNELS['#project-stack'],
          '#resources': CHANNELS['#project-stack'],
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /Duplicate/);
      return true;
    },
  );
});

test('buildDiscordPolicy rejects a malformed channel id', () => {
  assert.throws(
    () =>
      buildDiscordPolicy({
        guildId: GUILD,
        outputChannelId: OUTPUT,
        indexedChannels: { '#project-stack': 'not-a-snowflake' },
      }),
    DiscordConfigError,
  );
});

test('buildDiscordPolicy rejects an empty allowlist', () => {
  assert.throws(
    () =>
      buildDiscordPolicy({
        guildId: GUILD,
        outputChannelId: OUTPUT,
        indexedChannels: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /empty/);
      return true;
    },
  );
});

test('buildDiscordPolicy rejects a malformed guild id', () => {
  assert.throws(
    () =>
      buildDiscordPolicy({
        guildId: 'abc',
        outputChannelId: OUTPUT,
        indexedChannels: { ...CHANNELS },
      }),
    DiscordConfigError,
  );
});

test('assertEnvMatchesPolicy accepts matching guild and output overrides', () => {
  const policy = buildDiscordPolicy({
    guildId: GUILD,
    outputChannelId: OUTPUT,
    indexedChannels: { ...CHANNELS },
  });
  assert.doesNotThrow(() =>
    assertEnvMatchesPolicy(policy, {
      DISCORD_GUILD_ID: GUILD,
      DISCORD_OUTPUT_CHANNEL_ID: OUTPUT,
    }),
  );
});

test('assertEnvMatchesPolicy ignores an absent output override', () => {
  const policy = buildDiscordPolicy({
    guildId: GUILD,
    outputChannelId: OUTPUT,
    indexedChannels: { ...CHANNELS },
  });
  assert.doesNotThrow(() =>
    assertEnvMatchesPolicy(policy, { DISCORD_GUILD_ID: GUILD }),
  );
});

test('assertEnvMatchesPolicy rejects a guild mismatch', () => {
  const policy = buildDiscordPolicy({
    guildId: GUILD,
    outputChannelId: OUTPUT,
    indexedChannels: { ...CHANNELS },
  });
  assert.throws(
    () => assertEnvMatchesPolicy(policy, { DISCORD_GUILD_ID: '1422593925658579999' }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /does not match/);
      return true;
    },
  );
});

test('assertEnvMatchesPolicy rejects a missing guild id', () => {
  const policy = buildDiscordPolicy({
    guildId: GUILD,
    outputChannelId: OUTPUT,
    indexedChannels: { ...CHANNELS },
  });
  assert.throws(
    () => assertEnvMatchesPolicy(policy, {}),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /DISCORD_GUILD_ID is required/);
      return true;
    },
  );
});

test('assertEnvMatchesPolicy rejects an output channel mismatch', () => {
  const policy = buildDiscordPolicy({
    guildId: GUILD,
    outputChannelId: OUTPUT,
    indexedChannels: { ...CHANNELS },
  });
  assert.throws(
    () =>
      assertEnvMatchesPolicy(policy, {
        DISCORD_GUILD_ID: GUILD,
        DISCORD_OUTPUT_CHANNEL_ID: '1570721649538502999',
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordConfigError);
      assert.match(error.message, /output_channel_id/);
      return true;
    },
  );
});
