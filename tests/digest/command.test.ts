import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGEST_MESSAGES,
  handleDigestInteraction,
  type DigestInteraction,
} from '../../src/digest/command';
import type { DigestService } from '../../src/digest/service';
import type { DigestReport } from '../../src/digest/service';
import { GUILD } from '../discord/helpers';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const REPORT: DigestReport = {
  days: 7,
  from: new Date('2026-11-11T06:30:00.000Z'),
  to: new Date('2026-11-18T06:30:00.000Z'),
  githubIssues: [],
  githubIssueCount: 0,
  discordMessageCount: 4,
  decisionsMessageCount: 1,
  upcomingMeetingCount: 0,
  upcomingMeetings: [],
  upcomingEventCount: 0,
  upcomingEvents: [],
};

class FakeDigestInteraction implements DigestInteraction {
  readonly replies: Array<{ content: string; ephemeral: boolean }> = [];
  readonly edits: string[] = [];
  readonly deferOptions: Array<{ ephemeral?: boolean } | undefined> = [];
  deferrals = 0;

  commandName = 'digest';

  guildId: string | null;

  private readonly days: number | null;

  constructor(options: { guildId?: string | null; days?: number | null } = {}) {
    this.guildId = options.guildId === undefined ? GUILD : options.guildId;
    this.days = options.days ?? null;
  }

  isChatInputCommand(): boolean {
    return true;
  }

  get options(): DigestInteraction['options'] {
    return { getInteger: () => this.days };
  }

  async reply(options: { content: string; ephemeral: boolean }): Promise<unknown> {
    this.replies.push(options);
    return undefined;
  }

  async deferReply(options?: { ephemeral?: boolean }): Promise<unknown> {
    this.deferrals += 1;
    this.deferOptions.push(options);
    return undefined;
  }

  async editReply(options: { content: string }): Promise<unknown> {
    this.edits.push(options.content);
    return undefined;
  }
}

test('/digest rejects a foreign guild', async () => {
  const interaction = new FakeDigestInteraction({ guildId: '999999999999999999' });
  let calls = 0;
  const result = await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: {
      async build() {
        calls += 1;
        return REPORT;
      },
    },
    logger: silentLogger,
  });

  assert.equal(result, 'wrong-guild');
  assert.equal(interaction.replies[0]?.content, DIGEST_MESSAGES.wrongGuild);
  assert.equal(interaction.replies[0]?.ephemeral, true);
  assert.equal(calls, 0);
});

test('/digest defaults to 7 days and replies publicly', async () => {
  const interaction = new FakeDigestInteraction();
  let received: { guildId: string; days?: number | null } | undefined;
  const result = await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: {
      async build(input) {
        received = input;
        return REPORT;
      },
    },
    logger: silentLogger,
  });

  assert.equal(result, 'sent');
  assert.deepEqual(received, { guildId: GUILD, days: 7 });
  assert.equal(interaction.deferrals, 1);
  assert.equal(interaction.deferOptions[0], undefined);
  assert.match(interaction.edits[0], /\*\*Activity digest\*\* — last 7 days/);
});

test('/digest passes an explicit day value through', async () => {
  const interaction = new FakeDigestInteraction({ days: 30 });
  let receivedDays: number | null | undefined;
  await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: {
      async build(input) {
        receivedDays = input.days;
        return { ...REPORT, days: 30 };
      },
    },
    logger: silentLogger,
  });

  assert.equal(receivedDays, 30);
  assert.match(interaction.edits[0], /last 30 days/);
});

test('/digest rejects an out-of-range day value before querying', async () => {
  const interaction = new FakeDigestInteraction({ days: 0 });
  let calls = 0;
  const result = await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: {
      async build() {
        calls += 1;
        return REPORT;
      },
    },
    logger: silentLogger,
  });

  assert.equal(result, 'invalid-days');
  assert.equal(interaction.replies[0]?.content, DIGEST_MESSAGES.invalidDays);
  assert.equal(calls, 0);
  assert.equal(interaction.deferrals, 0);
});

test('/digest reports failures without leaking details', async () => {
  const interaction = new FakeDigestInteraction();
  const result = await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: {
      async build(): Promise<DigestReport> {
        throw new Error('connection refused');
      },
    },
    logger: silentLogger,
  });

  assert.equal(result, 'error');
  assert.equal(interaction.edits[0], DIGEST_MESSAGES.error);
  assert.equal(interaction.edits[0].includes('connection refused'), false);
});

test('/digest ignores other commands', async () => {
  const interaction = new FakeDigestInteraction();
  (interaction as { commandName: string }).commandName = 'ask';
  const service: Pick<DigestService, 'build'> = {
    async build() {
      return REPORT;
    },
  };
  const result = await handleDigestInteraction(interaction, {
    guildId: GUILD,
    digest: service,
    logger: silentLogger,
  });
  assert.equal(result, 'ignored');
});
