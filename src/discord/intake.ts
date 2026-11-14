/**
 * Discord message intake.
 *
 * The same filter pipeline is used by the gateway listener and the startup
 * backfill. It is allowlist-first and fails closed: a message is indexed only
 * when every check passes.
 */

import { discordMessageUrl } from '../citations/discord';
import type {
  AuthoredMessage,
  DiscordIndexRecord,
  DiscordIndexStore,
  DiscordLogger,
  OptOutStore,
} from './types';
import { defaultLogger, errorMessage } from './types';

export type IntakeResult = 'indexed' | 'ignored' | 'error';

export interface IntakeContext {
  guildId: string;
  botUserId: string;
  indexedChannelIds: ReadonlySet<string>;
  outputChannelId: string;
  optOutStore: OptOutStore;
  indexStore: DiscordIndexStore;
  logger?: DiscordLogger;
  now?: () => Date;
}

export interface IntakeFilters {
  guildId: string;
  botUserId: string;
  indexedChannelIds: ReadonlySet<string>;
}

/**
 * Synchronous gates, in contract order. Opt-out is checked separately because
 * it requires storage access.
 */
export function passesStaticMessageFilters(
  message: AuthoredMessage,
  filters: IntakeFilters,
): boolean {
  if (!message.guildId || message.guildId !== filters.guildId) {
    return false;
  }
  if (!filters.indexedChannelIds.has(message.channelId)) {
    return false;
  }
  if (message.system) {
    return false;
  }
  if (message.author.bot) {
    return false;
  }
  if (message.author.id === filters.botUserId) {
    return false;
  }
  return message.content.trim().length > 0;
}

export async function shouldIndexMessage(
  message: AuthoredMessage,
  context: IntakeContext,
): Promise<boolean> {
  if (!passesStaticMessageFilters(message, context)) {
    return false;
  }
  return !(await context.optOutStore.isOptedOut(context.guildId, message.author.id));
}

export function toIndexRecord(
  message: AuthoredMessage,
  context: IntakeContext,
  indexedAt: Date = context.now?.() ?? new Date(),
): DiscordIndexRecord {
  if (!message.guildId) {
    throw new Error(`Cannot index message ${message.id}: it has no guild id`);
  }
  if (message.author.bot || message.author.id === context.botUserId) {
    throw new Error(`Refusing to index bot-authored message ${message.id}`);
  }

  return {
    sourceType: 'discord',
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    indexedAt: indexedAt.toISOString(),
    sourceUrl: discordMessageUrl(
      {
        kind: 'discord-message',
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
      },
      { blockedChannelIds: [context.outputChannelId] },
    ),
  };
}

export async function handleMessageCreate(
  message: AuthoredMessage,
  context: IntakeContext,
): Promise<IntakeResult> {
  try {
    if (!(await shouldIndexMessage(message, context))) {
      return 'ignored';
    }
    await context.indexStore.upsert(toIndexRecord(message, context));
    return 'indexed';
  } catch (error) {
    (context.logger ?? defaultLogger).error('Failed to index a Discord message', {
      messageId: message.id,
      channelId: message.channelId,
      error: errorMessage(error),
    });
    return 'error';
  }
}
