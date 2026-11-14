import { InMemoryDiscordStore } from '../../src/discord/store';
import { buildDiscordPolicy, type DiscordPolicy } from '../../src/discord/policy';
import type {
  AuthoredMessage,
  DiscordIndexRecord,
  DiscordLogger,
  IntakeContext,
} from '../../src/discord/types';
import type { OptOutInteraction } from '../../src/optout/command';

export const GUILD = '1422593925658579036';
export const OUTPUT = '1570721649538502686';

export const CHANNELS = {
  '#project-stack': '1423323863093088407',
  '#resources': '1422593926367547487',
  '#announcements': '1422593926367547486',
  '#meeting-plans': '1570872485933752502',
} as const;

/** Visible to the bot in the live guild, but deliberately not in the allowlist. */
export const CORE_SECRETS_ID = '1422593926367547499';
export const OTHER_VISIBLE_ID = '1422593926367547500';

export const silentLogger: DiscordLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function makePolicy(
  overrides: Partial<{
    guildId: string;
    outputChannelId: string;
    indexedChannels: Record<string, string>;
  }> = {},
): DiscordPolicy {
  return buildDiscordPolicy({
    guildId: overrides.guildId ?? GUILD,
    outputChannelId: overrides.outputChannelId ?? OUTPUT,
    indexedChannels: overrides.indexedChannels ?? { ...CHANNELS },
  });
}

export function makeMessage(overrides: Partial<AuthoredMessage> = {}): AuthoredMessage {
  return {
    id: '1000000000000000001',
    guildId: GUILD,
    channelId: CHANNELS['#project-stack'],
    system: false,
    content: 'A real project update',
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
    author: { id: '200000000000000001', bot: false },
    ...overrides,
  };
}

export function makeRecord(
  overrides: Partial<DiscordIndexRecord> = {},
): DiscordIndexRecord {
  const message = makeMessage();
  return {
    sourceType: 'discord',
    guildId: GUILD,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorIsBot: false,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    indexedAt: '2026-11-14T12:00:00.000Z',
    sourceUrl: `https://discord.com/channels/${GUILD}/${message.channelId}/${message.id}`,
    ...overrides,
  };
}

export function makeContext(
  store: InMemoryDiscordStore = new InMemoryDiscordStore(),
  overrides: Partial<IntakeContext> = {},
): IntakeContext {
  const policy = makePolicy();
  return {
    guildId: policy.guildId,
    botUserId: '300000000000000001',
    indexedChannelIds: policy.indexedChannelIds,
    outputChannelId: policy.outputChannelId,
    optOutStore: store,
    indexStore: store,
    logger: silentLogger,
    now: () => new Date('2026-11-14T12:00:00.000Z'),
    ...overrides,
  };
}

export class FakeInteraction implements OptOutInteraction {
  readonly replies: Array<{ content: string; ephemeral: boolean }> = [];

  constructor(
    private readonly options: {
      command?: boolean;
      commandName?: string;
      guildId?: string | null;
      userId?: string;
      replyError?: Error;
    } = {},
  ) {}

  isChatInputCommand(): boolean {
    return this.options.command ?? true;
  }

  get commandName(): string {
    return this.options.commandName ?? 'optout';
  }

  get guildId(): string | null {
    return this.options.guildId === undefined ? GUILD : this.options.guildId;
  }

  get user(): { id: string } {
    return { id: this.options.userId ?? '200000000000000001' };
  }

  async reply(options: { content: string; ephemeral: boolean }): Promise<unknown> {
    if (this.options.replyError) {
      throw this.options.replyError;
    }
    this.replies.push(options);
    return undefined;
  }
}

export function tempRecordId(index: number): string {
  return String(1000000000000000000 + index);
}
