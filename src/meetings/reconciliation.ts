/**
 * Startup reconciliation for meeting reminders (L3).
 *
 * On startup, after the queue and worker are ready, finds confirmed events with
 * reminder_sent_at IS NULL and start_at > now(), and ensures a reminder job
 * exists for the current event version at max(now, start_at - 1 hour).
 *
 * Idempotent: uses the singleton key so restarts never multiply jobs. Never
 * sends reminders itself — only schedules jobs for the worker to deliver.
 *
 * Returns a result object with the number of jobs scheduled and a list of
 * events that failed to schedule, so startup integration can detect incomplete
 * reconciliation and retry failed events safely.
 */

import type { PgBoss } from 'pg-boss';
import type { MeetingRepository } from './repository.js';
import { scheduleReminder } from './scheduling.js';

export interface ReconciliationDeps {
  repository: MeetingRepository;
  boss: PgBoss;
  logger?: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
    error(message: string, details?: Record<string, unknown>): void;
  };
}

export interface ReconciliationResult {
  /** Number of events for which a reminder job was scheduled. */
  scheduled: number;
  /** Events that were eligible but failed to schedule. */
  failed: Array<{
    meetingId: string;
    eventVersion: number;
    error: string;
  }>;
}

/**
 * Reconcile unreminded future confirmed events.
 */
export async function reconcileMeetingReminders(
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const { repository, boss } = deps;
  const logger = deps.logger ?? console;

  const events = await repository.listUnremindedFuture();
  logger.info('Startup reconciliation: found unreminded future events', {
    count: events.length,
  });

  let scheduled = 0;
  const failed: ReconciliationResult['failed'] = [];

  for (const event of events) {
    try {
      const jobId = await scheduleReminder(
        boss,
        event.id,
        event.eventVersion,
        event.startAt,
      );
      if (jobId) {
        logger.info('Startup reconciliation: scheduled reminder', {
          meetingId: event.id,
          eventVersion: event.eventVersion,
          jobId,
          startAt: event.startAt,
        });
        scheduled += 1;
      } else {
        // Meeting already started or startBefore now; not scheduled.
        logger.info('Startup reconciliation: no reminder scheduled (meeting due)', {
          meetingId: event.id,
          eventVersion: event.eventVersion,
          startAt: event.startAt,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Startup reconciliation: failed to schedule reminder', {
        meetingId: event.id,
        eventVersion: event.eventVersion,
        error: message,
      });
      failed.push({
        meetingId: event.id,
        eventVersion: event.eventVersion,
        error: message,
      });
    }
  }

  logger.info('Startup reconciliation: complete', {
    events: events.length,
    scheduled,
    failed: failed.length,
  });
  return { scheduled, failed };
}
