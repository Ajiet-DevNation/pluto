/**
 * Automatic Meeting Announcer entry point (L3).
 *
 * Wires together announcement detection, parsing, confirmation, persistence,
 * durable reminder scheduling, the reminder worker, and startup reconciliation.
 *
 * All functions are exported so Khushi can integrate them into the shared
 * startup files (src/discord/bot.ts, src/jobs/worker.ts, src/cmd/pluto/index.ts)
 * without L3 rewriting shared code.
 */

import { Client, Events, type Message } from 'discord.js';
import type { PgBoss } from 'pg-boss';
import type { MeetingRepository } from './repository.js';
import {
  detectMeetingAnnouncement,
  type AnnouncementMessage,
  type DetectionOpts,
} from './detection.js';
import { TextChannel } from 'discord.js';
import { parseMeeting } from './parsing.js';
import { createMeetingRepository } from './repository.js';
import { scheduleReminder } from './scheduling.js';
import { registerMeetingReminderWorker } from './worker.js';
import { reconcileMeetingReminders } from './reconciliation.js';
import { createConfirmationHandler, type ConfirmationDeps } from './confirmation.js';
import type { ConfirmationInteraction } from './confirmation.js';

export interface MeetingAnnouncerDeps {
  client: Client;
  repository: MeetingRepository;
  boss: PgBoss;
  botUserId: string;
  /** Opt-out store check (guildId, userId) => opted out. */
  isOptedOut?: (guildId: string, userId: string) => Promise<boolean>;
  /** (guildId, userId) => Manage Messages permission. */
  moderatorCheck?: (guildId: string, userId: string) => Promise<boolean>;
  /** Posts a confirmation message with buttons to a channel. */
  postConfirmation: (
    channelId: string,
    content: string,
  ) => Promise<{ messageId?: string } | null>;
  /** Sends a reminder to #pluto. */
  sendReminder: (
    channelId: string,
    content: string,
  ) => Promise<{ messageId?: string } | null>;
  outputChannelId: string;
  logger?: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
    error(message: string, details?: Record<string, unknown>): void;
  };
}

export interface StartedMeetingAnnouncer {
  shutdown: () => Promise<void>;
}

const detectionOptsCache = new WeakMap<object, DetectionOpts>();

function buildDetectionOpts(
  deps: Pick<
    MeetingAnnouncerDeps,
    'botUserId' | 'isOptedOut' | 'logger'
  >,
): DetectionOpts {
  return {
    botUserId: deps.botUserId,
    isOptedOut: deps.isOptedOut,
    logger: deps.logger,
  };
}

/**
 * Start the announcer: register the gateway detection listener, the confirmation
 * interaction handler, and the pg-boss reminder worker. Returns a shutdown
 * hook. Call reconcileMeetingReminders separately after the bot is ready.
 */
export function startMeetingAnnouncer(deps: MeetingAnnouncerDeps): StartedMeetingAnnouncer {
  const { client, repository, boss, logger } = deps;
  const log = logger ?? console;

  const detectionOpts = buildDetectionOpts({
    botUserId: deps.botUserId,
    isOptedOut: deps.isOptedOut,
    logger: log,
  });

  const confirmation = createConfirmationHandler({
    repository,
    boss,
    moderatorCheck: deps.moderatorCheck,
    postConfirmation: deps.postConfirmation,
    logger: log,
  });

  // --- Gateway detection listener (own error boundary inside detectMeetingAnnouncement) ---
  client.on(Events.MessageCreate, async (message: Message) => {
    const announcementMessage = message as unknown as AnnouncementMessage;
    const result = await detectMeetingAnnouncement(announcementMessage, detectionOpts);
    if (!result.isCandidate) {
      return;
    }

    // Parse deterministically, anchored to the original message createdAt.
    const parsed = parseMeeting(message.content, message.createdAt, {
      now: () => new Date(),
    });

    if (parsed.kind !== 'ok' || !parsed.startAt) {
      // Ambiguous / missing / invalid / past: ask for clarification in the
      // meeting-plans channel (ephemeral-style reply to the announcer). Do not
      // create an event or schedule anything.
      const clarification =
        parsed.clarification ?? 'I could not parse the meeting date/time.';
      try {
        // Reply to the announcer in the meeting-plans channel.
        const textChannel = message.channel as TextChannel;
        await textChannel.send(
          `<@${message.author.id}> ${clarification}`,
        );
      } catch (error) {
        log.error('Failed to send clarification reply', {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    // Create a pending event (idempotent on unique source identity).
    const sourceUrl = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
    const created = await repository.create({
      guildId: message.guildId!,
      channelId: message.channelId,
      sourceMessageId: message.id,
      sourceMessageUrl: sourceUrl,
      createdBy: message.author.id,
      title: parsed.title ?? message.content.trim(),
      startAt: parsed.startAt,
      timezone: parsed.timezone,
      status: 'pending',
      eventVersion: 1,
    });

    if (!created) {
      log.error('Failed to persist meeting event', {
        messageId: message.id,
        sourceMessageId: message.id,
      });
      return;
    }

    // Post confirmation controls to the announcer.
    await confirmation.postConfirmation(message.channelId, created.id, {
      title: created.title,
      startAt: created.startAt,
      timezone: created.timezone,
      sourceMessageUrl: created.sourceMessageUrl,
    }, message.createdAt);

    log.info('Meeting candidate detected and confirmation posted', {
      messageId: message.id,
      meetingId: created.id,
      channelId: message.channelId,
      startAt: created.startAt,
    });
  });

  // --- Interaction handler registration (Khushi routes component interactions here) ---
  // Exported via confirmation.handleInteraction; wired by Khushi in bot.ts.
  // No-op here beyond capturing the handler for shutdown/inspection.

  // --- Register the durable reminder worker ---
  registerMeetingReminderWorker(boss, {
    repository,
    sendReminder: deps.sendReminder,
    outputChannelId: deps.outputChannelId,
    logger: log,
  });

  return {
    shutdown: async () => {
      // No persistent resources to close beyond the shared boss/client.
      return undefined;
    },
  };
}

/**
 * Get the confirmation interaction handler for Khushi to wire into the shared
 * Discord interaction router (alongside /ask and /optout).
 */
export function getConfirmationHandler(deps: MeetingAnnouncerDeps) {
  return createConfirmationHandler({
    repository: deps.repository,
    boss: deps.boss,
    moderatorCheck: deps.moderatorCheck,
    postConfirmation: deps.postConfirmation,
    logger: deps.logger,
  });
}

export type { ConfirmationInteraction };
