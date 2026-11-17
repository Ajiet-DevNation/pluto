/**
 * Meeting reminder worker registration (L3 MVP).
 *
 * Registers a real pg-boss worker on the send-meeting-reminder queue. The
 * worker reads the current event, validates version/status, claims delivery
 * conditionally, sends one reminder to #pluto, and persists delivery state.
 * Stale jobs (already reminded or wrong version) are acknowledged as no-ops.
 * Infrastructure errors throw so pg-boss retries.
 *
 * Likhith exports registerMeetingReminderWorker; Khushi wires it into
 * src/jobs/worker.ts at startup.
 */

import type { PgBoss } from 'pg-boss';
import type { MeetingRepository } from './repository.js';

export interface MeetingReminderDeps {
  repository: MeetingRepository;
  /** Send a reminder to the configured #pluto channel. Returns the Discord message id when available. */
  sendReminder: (channelId: string, content: string) => Promise<{ messageId?: string } | null>;
  outputChannelId: string;
  logger?: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
    error(message: string, details?: Record<string, unknown>): void;
  };
}

export function registerMeetingReminderWorker(
  boss: PgBoss,
  deps: MeetingReminderDeps,
): void {
  const logger = deps.logger ?? console;

  boss.work(
    'send-meeting-reminder',
    async (jobs) => {
      const { repository, sendReminder, outputChannelId } = deps;

      for (const job of jobs) {
        const { meetingId, eventVersion } = job.data as {
          meetingId: string;
          eventVersion: number;
        };

        logger.info('Reminder job received', {
          queue: 'send-meeting-reminder',
          jobId: job.id,
          meetingId,
          eventVersion,
        });

        try {
          // 1. Read the current event.
          const event = await repository.getById(meetingId);
          if (!event) {
            logger.warn('Reminder job: event not found, acknowledging', {
              jobId: job.id,
              meetingId,
            });
            continue;
          }

          // 2. Verify it still exists and is confirmed.
          if (event.status !== 'confirmed') {
            logger.warn('Reminder job: event not confirmed, discarding', {
              jobId: job.id,
              meetingId,
              status: event.status,
            });
            continue;
          }

          // 3. Verify the job version matches the current event version.
          if (event.eventVersion !== eventVersion) {
            logger.warn('Reminder job: obsolete version, discarding', {
              jobId: job.id,
              meetingId,
              jobVersion: eventVersion,
              currentVersion: event.eventVersion,
            });
            continue;
          }

          // 4. Verify no reminder has already been sent.
          if (event.reminderSentAt) {
            logger.warn('Reminder job: reminder already sent, discarding', {
              jobId: job.id,
              meetingId,
              reminderSentAt: event.reminderSentAt,
            });
            continue;
          }

          // 5. Claim delivery with a conditional update (10-minute claim expiry).
          const claimed = await repository.claim(meetingId, eventVersion);
          if (!claimed) {
            logger.warn('Reminder job: claim lost or expired, yielding', {
              jobId: job.id,
              meetingId,
              eventVersion,
            });
            continue;
          }

          logger.info('Reminder job: claim won, preparing delivery', {
            jobId: job.id,
            meetingId,
            eventVersion,
          });

          // 6. Build reminder content and send to #pluto.
          const content = buildReminderContent(event);
          let sendError: Error | null = null;
          let result: { messageId?: string } | null = null;
          try {
            result = await sendReminder(outputChannelId, content);
          } catch (error) {
            sendError = error instanceof Error ? error : new Error(String(error));
          }

          // If Discord send failed, throw so pg-boss retries. The claim
          // expires after 10 minutes, allowing recovery.
          if (sendError) {
            logger.error('Reminder job: Discord send failed, retrying', {
              jobId: job.id,
              meetingId,
              eventVersion,
              error: sendError.message,
            });
            throw sendError;
          }
          if (!result) {
            throw new Error('sendReminder returned no result');
          }

          // 7. Persist reminder_sent_at and reminder_message_id.
          // This is conditional (only sets if not already sent) so a retry
          // after a partial failure cannot create a duplicate delivery record.
          try {
            await repository.markSent(meetingId, result.messageId ?? '');
          } catch (error) {
            // Discord accepted the message but PostgreSQL failed to record
            // delivery. Do not retry: retrying would risk a duplicate reminder
            // in #pluto. Log clearly and acknowledge the job.
            logger.error('Reminder job: Discord sent but delivery state not persisted', {
              jobId: job.id,
              meetingId,
              eventVersion,
              reminderMessageId: result.messageId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          logger.info('Reminder job: reminder delivered', {
            jobId: job.id,
            meetingId,
            eventVersion,
            reminderMessageId: result.messageId,
          });
        } catch (error) {
          // Infrastructure (DB/Discord) failure: throw so pg-boss retries.
          // The claim expires after 10 minutes, allowing recovery.
          logger.error('Reminder job: delivery failed, retrying', {
            jobId: job.id,
            meetingId,
            eventVersion,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    },
  );
}

/**
 * Reminder content (contracts/meeting.md §6.4).
 * Never pings @everyone/@here; never reposts the full announcement.
 */
function buildReminderContent(event: {
  title: string;
  startAt: Date;
  timezone: string;
  sourceMessageUrl: string;
}): string {
  const start = new Date(event.startAt);
  const kolkata = new Date(start.getTime() + (5 * 60 * 60 + 30 * 60) * 1000);
  const hh = String(kolkata.getUTCHours()).padStart(2, '0');
  const mm = String(kolkata.getUTCMinutes()).padStart(2, '0');
  const day = String(kolkata.getUTCDate()).padStart(2, '0');
  const month = String(kolkata.getUTCMonth() + 1).padStart(2, '0');
  const year = kolkata.getUTCFullYear();
  return `**Meeting reminder** — ${event.title}

Starts at ${day}/${month}/${year} ${hh}:${mm} ${event.timezone}.
Original announcement: ${event.sourceMessageUrl}

This is a one-time reminder from Pluto. No action required.`;
}
