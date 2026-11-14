import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_MESSAGES,
  handleAskInteraction,
  type AskInteraction,
} from '../../src/ask/command';
import { NO_EVIDENCE_MESSAGE } from '../../src/guardrails/evidence';
import type { AskResult } from '../../src/search/ask';
import { GUILD, silentLogger } from '../discord/helpers';

class FakeAskInteraction implements AskInteraction {
  readonly defers: Array<{ ephemeral?: boolean }> = [];
  readonly edits: string[] = [];

  constructor(
    private readonly settings: {
      command?: boolean;
      commandName?: string;
      guildId?: string | null;
      question?: string | null;
      deferError?: Error;
      editError?: Error;
    } = {},
  ) {}

  isChatInputCommand(): boolean {
    return this.settings.command ?? true;
  }

  get commandName(): string {
    return this.settings.commandName ?? 'ask';
  }

  get guildId(): string | null {
    return this.settings.guildId === undefined ? GUILD : this.settings.guildId;
  }

  get user(): { id: string } {
    return { id: '200000000000000001' };
  }

  options = {
    getString: (name: string): string | null => {
      assert.equal(name, 'question');
      return this.settings.question === undefined
        ? 'what is the stack?'
        : this.settings.question;
    },
  };

  async deferReply(options?: { ephemeral?: boolean }): Promise<unknown> {
    if (this.settings.deferError) {
      throw this.settings.deferError;
    }
    this.defers.push(options ?? {});
    return undefined;
  }

  async editReply(options: { content: string }): Promise<unknown> {
    if (this.settings.editError) {
      throw this.settings.editError;
    }
    this.edits.push(options.content);
    return undefined;
  }
}

function dependencies(result: AskResult | Error) {
  return {
    guildId: GUILD,
    logger: silentLogger,
    askService: {
      async ask(): Promise<AskResult> {
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
  };
}

test('ignores non-chat or other command interactions', async () => {
  const interaction = new FakeAskInteraction({ command: false });
  assert.equal(
    await handleAskInteraction(interaction, dependencies({ ok: false, message: NO_EVIDENCE_MESSAGE })),
    'ignored',
  );

  const other = new FakeAskInteraction({ commandName: 'optout' });
  assert.equal(
    await handleAskInteraction(other, dependencies({ ok: false, message: NO_EVIDENCE_MESSAGE })),
    'ignored',
  );
});

test('rejects /ask outside the configured guild', async () => {
  const interaction = new FakeAskInteraction({ guildId: '1422593925658579999' });
  const result = await handleAskInteraction(
    interaction,
    dependencies({ ok: true, answer: 'nope', sources: [], chunks: [] }),
  );

  assert.equal(result, 'wrong-guild');
  assert.deepEqual(interaction.defers, [{ ephemeral: true }]);
  assert.deepEqual(interaction.edits, [ASK_MESSAGES.wrongGuild]);
});

test('rejects an empty question without calling the service', async () => {
  const interaction = new FakeAskInteraction({ question: '   ' });
  const result = await handleAskInteraction(
    interaction,
    dependencies({ ok: true, answer: 'should not happen', sources: [], chunks: [] }),
  );

  assert.equal(result, 'empty');
  assert.deepEqual(interaction.defers, [{ ephemeral: true }]);
  assert.deepEqual(interaction.edits, [ASK_MESSAGES.emptyQuestion]);
});

test('returns the no-evidence message unchanged', async () => {
  const interaction = new FakeAskInteraction();
  const result = await handleAskInteraction(
    interaction,
    dependencies({ ok: false, message: NO_EVIDENCE_MESSAGE }),
  );

  assert.equal(result, 'no-evidence');
  assert.deepEqual(interaction.defers, [{}]);
  assert.deepEqual(interaction.edits, [NO_EVIDENCE_MESSAGE]);
});

test('returns a grounded answer', async () => {
  const interaction = new FakeAskInteraction();
  const result = await handleAskInteraction(
    interaction,
    dependencies({
      ok: true,
      answer: 'TypeScript and Postgres.\n\nSources:\n- [Discord message](https://discord.com/x)',
      sources: [{ label: 'Discord message', url: 'https://discord.com/x' }],
      chunks: [],
    }),
  );

  assert.equal(result, 'answered');
  assert.deepEqual(interaction.defers, [{}]);
  assert.match(interaction.edits[0], /TypeScript and Postgres/);
  assert.match(interaction.edits[0], /Sources:/);
});

test('reports service failures without leaking the error', async () => {
  const interaction = new FakeAskInteraction();
  const result = await handleAskInteraction(
    interaction,
    dependencies(new Error('database password leaked')),
  );

  assert.equal(result, 'error');
  assert.deepEqual(interaction.edits, [ASK_MESSAGES.error]);
});

test('reports acknowledgement failures', async () => {
  const interaction = new FakeAskInteraction({
    deferError: new Error('interaction expired'),
  });
  const result = await handleAskInteraction(
    interaction,
    dependencies({ ok: true, answer: 'answer', sources: [], chunks: [] }),
  );

  assert.equal(result, 'error');
  assert.deepEqual(interaction.edits, []);
});
