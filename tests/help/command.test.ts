import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleHelpInteraction,
  HELP_CONTENT,
  HELP_MESSAGES,
  type HelpInteraction,
} from '../../src/help/command';
import { GUILD } from '../discord/helpers';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeHelpInteraction implements HelpInteraction {
  readonly replies: Array<{ content: string; ephemeral?: boolean }> = [];

  commandName = 'help';

  guildId: string | null;

  constructor(guildId: string | null = GUILD) {
    this.guildId = guildId;
  }

  isChatInputCommand(): boolean {
    return true;
  }

  async reply(options: { content: string; ephemeral?: boolean }): Promise<unknown> {
    this.replies.push(options);
    return undefined;
  }
}

test('/help lists every guild-scoped command with examples', () => {
  for (const command of [
    '`/ask',
    '`/digest',
    '`/upcoming meetings`',
    '`/upcoming events`',
    '`/event add',
    '`/event cancel',
    '`/optout`',
    '`/help`',
  ]) {
    assert.ok(HELP_CONTENT.includes(command), `missing ${command}`);
  }
  assert.ok(HELP_CONTENT.includes('Examples'));
  assert.ok(HELP_CONTENT.length <= 2_000);
  assert.equal(HELP_CONTENT.includes('/resource'), false);
  assert.equal(HELP_CONTENT.includes('/upcoming all'), false);
});

test('/help replies publicly in the configured guild', async () => {
  const interaction = new FakeHelpInteraction();
  const result = await handleHelpInteraction(interaction, {
    guildId: GUILD,
    logger: silentLogger,
  });

  assert.equal(result, 'sent');
  assert.equal(interaction.replies[0]?.ephemeral, undefined);
  assert.equal(interaction.replies[0]?.content, HELP_CONTENT);
});

test('/help rejects foreign guilds and ignores other commands', async () => {
  const foreign = new FakeHelpInteraction('999999999999999999');
  const result = await handleHelpInteraction(foreign, {
    guildId: GUILD,
    logger: silentLogger,
  });
  assert.equal(result, 'wrong-guild');
  assert.equal(foreign.replies[0]?.content, HELP_MESSAGES.wrongGuild);
  assert.equal(foreign.replies[0]?.ephemeral, true);

  const other = new FakeHelpInteraction();
  (other as { commandName: string }).commandName = 'ask';
  const ignored = await handleHelpInteraction(other, {
    guildId: GUILD,
    logger: silentLogger,
  });
  assert.equal(ignored, 'ignored');
  assert.equal(other.replies.length, 0);
});
