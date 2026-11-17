/**
 * Automatic Meeting Announcer entry point (L3 MVP).
 *
 * Wires together announcement detection, deterministic date/time parsing,
 * persistent meeting event storage, durable pg-boss reminder scheduling,
 * the reminder worker, and startup reconciliation.
 *
 * Flow: detected announcement → parse date/time (anchored to message
 * createdAt) → if valid future time, create event + schedule reminder;
 * otherwise post a simple explanatory reply. No confirmation, cancel, or
 * reschedule interaction.
 *
 * All functions are exported so Khushi can integrate them into the shared
 * startup files (src/discord/bot.ts, src/jobs/worker.ts, src/cmd/pluto/index.ts)
 * without L3 rewriting shared code.
 */

import { Client, Events, TextChannel, type Message } from 'discord.js';
import type { PgBoss } from 'pg-boss';
import type { MeetingRepository } from './repository.js';
import {
  detectMeetingAnnouncement,
  type AnnouncementMessage,
  type DetectionOpts,
} from './detection.js';
import { parseMeeting } from './parsing.js';
import { createMeetingRepository } from './repository.js';
import { scheduleReminder } from './scheduling.js';
import { registerMeetingReminderWorker } from './worker.js';
import { reconcileMeetingReminders } from './reconciliation.js';

export interface MeetingAnnouncerDeps {
  client: Client;
  repository: MeetingRepository;
  boss: PgBoss;
  botUserId: string;
  /** Opt-out store check (guildId, userId) => opted out. */
  isOptedOut?: (guildId: string, userId: string) => Promise<boolean>;
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

function buildDetectionOpts(
  deps: Pick<MeetingAnnouncerDeps, 'botUserId' | 'isOptedOut' | 'logger'>,
): DetectionOpts {
  return {
    botUserId: deps.botUserId,
    isOptedOut: deps.isOptedOut,
    logger: deps.logger,
  };
}

/**
 * Start the announcer: register the gateway detection listener and the
 * pg-boss reminder worker. Returns a shutdown hook. Call
 * reconcileMeetingReminders separately after the bot is ready.
 */
export function startMeetingAnnouncer(deps: MeetingAnnouncerDeps): StartedMeetingAnnouncer {
  const { client, repository, boss, logger } = deps;
  const log = logger ?? console;

  const detectionOpts = buildDetectionOpts({
    botUserId: deps.botUserId,
    isOptedOut: deps.isOptedOut,
    logger: log,
  });

  // --- Gateway detection listener ---
  // Detection has its own error boundary. The rest of the handler is wrapped
  // too: a parse, database, or pg-boss failure must never become an unhandled
  // rejection that could take down the shared Discord gateway loop.
  const onMessageCreate = async (message: Message): Promise<void> => {
    try {
      const announcementMessage = message as unknown as AnnouncementMessage;
      const result = await detectMeetingAnnouncement(announcementMessage, detectionOpts);
      if (!result.isCandidate) {
        return;
      }

      // Parse deterministically, anchored to the original message createdAt.
      let parsed: ReturnType<typeof parseMeeting>;
      try {
        parsed = parseMeeting(message.content, message.createdAt, {
          now: () => new Date(),
        });
      } catch (error) {
        log.error('Meeting announcement parsing failed', {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (parsed.kind !== 'ok' || !parsed.startAt) {
        // Missing / ambiguous / invalid / past: post a simple explanation.
        // Do not create an event or schedule anything.
        const clarification = parsed.clarification ?? 'I could not parse the meeting date/time.';
        try {
          const textChannel = message.channel as TextChannel;
          await textChannel.send(`<@${message.author.id}> ${clarification}`);
        } catch (error) {
          log.error('Failed to send clarification reply', {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      // Create a confirmed event (idempotent on unique source identity).
      const sourceUrl = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
      let created: Awaited<ReturnType<MeetingRepository['create']>>;
      try {
        created = await repository.create({
          guildId: message.guildId!,
          channelId: message.channelId,
          sourceMessageId: message.id,
          sourceMessageUrl: sourceUrl,
          createdBy: message.author.id,
          title: parsed.title ?? message.content.trim(),
          startAt: parsed.startAt,
          timezone: parsed.timezone,
          status: 'confirmed',
          eventVersion: 1,
        });
      } catch (error) {
        log.error('Failed to persist meeting event', {
          messageId: message.id,
          sourceMessageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (!created) {
        log.error('Failed to persist meeting event', {
          messageId: message.id,
          sourceMessageId: message.id,
        });
        return;
      }

      // Schedule the reminder (no-op if meeting already started). If this
      // fails, the event stays confirmed and unsent so startup reconciliation
      // can schedule it again.
      try {
        await scheduleReminder(boss, created.id, created.eventVersion, created.startAt);
      } catch (error) {
        log.error('Failed to schedule meeting reminder; reconciliation will retry', {
          messageId: message.id,
          meetingId: created.id,
          eventVersion: created.eventVersion,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      log.info('Meeting detected, event confirmed, reminder scheduled', {
        messageId: message.id,
        meetingId: created.id,
        channelId: message.channelId,
        startAt: created.startAt,
      });
    } catch (error) {
      // Defensive: detection and the individual steps above already catch
      // their own failures, but no announcer error may escape the gateway.
      log.error('Meeting announcer handler failed', {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  client.on(Events.MessageCreate, onMessageCreate);

  // --- Register the durable reminder worker ---
  registerMeetingReminderWorker(boss, {
    repository,
    sendReminder: deps.sendReminder,
    outputChannelId: deps.outputChannelId,
    logger: log,
  });

  return {
    shutdown: async () => {
      client.off(Events.MessageCreate, onMessageCreate);
    },
  };
}
