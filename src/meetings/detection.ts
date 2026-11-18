/**
 * Meeting announcement detection (L3).
 *
 * Consumes the Discord gateway MessageCreate stream and detects human-authored
 * meeting announcements in the configured #meeting-plans channel. Runs behind
 * its own error boundary: a detection failure is logged and never breaks the
 * ordinary indexing pipeline.
 */

import { loadConfig } from '../config.js';
import type { AuthoredMessage, DiscordLogger } from '../discord/types.js';
import { defaultLogger, errorMessage } from '../discord/types.js';

export const MEETING_PLANS_CHANNEL_NAME = '#meeting-plans';

export const MEETING_KEYWORDS = [
  'meeting',
  'meet',
  'standup',
  'sync',
  'call',
  'review',
  'session',
  'discussion',
] as const;

const MEETING_KEYWORD_RE = new RegExp(
  `\\b(${MEETING_KEYWORDS.join('|')})\\b`,
  'i',
);

export interface MentionMetadata {
  everyone: boolean;
}

export interface AnnouncementMessage extends AuthoredMessage {
  mentions?: MentionMetadata;
}

export interface DetectionOpts {
  botUserId: string;
  isOptedOut?: (guildId: string, userId: string) => Promise<boolean>;
  logger?: DiscordLogger;
}

export interface DetectionResult {
  isCandidate: boolean;
  reason?: string;
}

function getMeetingPlansChannelId(): string {
  return loadConfig().planning.discord.indexed_channels[MEETING_PLANS_CHANNEL_NAME];
}

function getGuildId(): string {
  return loadConfig().planning.discord.guild_id;
}

/**
 * All detection filters (contracts/meeting.md §2.2). Every check must pass.
 * Never throws: opt-out store failures are treated as a non-candidate and
 * logged, so detection stays independent of indexing storage.
 */
export async function detectMeetingAnnouncement(
  message: AnnouncementMessage,
  opts: DetectionOpts,
): Promise<DetectionResult> {
  const logger = opts.logger ?? defaultLogger;

  try {
    const guildId = getGuildId();

    // 1. guild matches configured guild
    if (!message.guildId || message.guildId !== guildId) {
      return { isCandidate: false, reason: 'wrong-guild' };
    }

    // 2. configured #meeting-plans channel (never hardcoded)
    if (message.channelId !== getMeetingPlansChannelId()) {
      return { isCandidate: false, reason: 'wrong-channel' };
    }

    // 3. not a system message
    if (message.system) {
      return { isCandidate: false, reason: 'system-message' };
    }

    // 4. human author (not a bot, not the bot itself)
    if (message.author.bot) {
      return { isCandidate: false, reason: 'bot-author' };
    }
    if (message.author.id === opts.botUserId) {
      return { isCandidate: false, reason: 'self-author' };
    }

    // 5. non-empty content
    if (!message.content || message.content.trim().length === 0) {
      return { isCandidate: false, reason: 'empty-content' };
    }

    // 6. actual Discord @everyone/@here mention metadata (not plain text)
    if (!message.mentions?.everyone) {
      return { isCandidate: false, reason: 'no-mention' };
    }

    // 7. meeting-related language, case-insensitive, word-bounded
    if (!MEETING_KEYWORD_RE.test(message.content)) {
      return { isCandidate: false, reason: 'no-meeting-language' };
    }

    // 8. author not opted out
    if (opts.isOptedOut) {
      try {
        if (await opts.isOptedOut(message.guildId!, message.author.id)) {
          return { isCandidate: false, reason: 'opted-out' };
        }
      } catch (error) {
        logger.error('Meeting detection opt-out check failed', {
          messageId: message.id,
          authorId: message.author.id,
          error: errorMessage(error),
        });
        return { isCandidate: false, reason: 'optout-check-failed' };
      }
    }

    return { isCandidate: true };
  } catch (error) {
    // Own error boundary: detection must never throw into the gateway loop.
    logger.error('Meeting announcement detection failed', {
      messageId: message.id,
      channelId: message.channelId,
      error: errorMessage(error),
    });
    return { isCandidate: false, reason: 'detection-error' };
  }
}
