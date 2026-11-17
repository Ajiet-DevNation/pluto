/**
 * Startup reconciliation for meeting reminders (L3).
 *
 * On startup, after the queue and worker are ready, finds confirmed events with
 * reminder_sent_at IS NULL and start_at > now(), and ensures a reminder job
 * exists for the current event version at max(now, start_at - 1 hour).
 *
 * Idempotent: uses the singleton key so restarts never multiply jobs. Never
 * sends reminders itself — only schedules jobs for the worker to deliver.
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

/**
 * Reconcile unreminded future confirmed events. Returns the number of jobs
 * scheduled/ensured.
 */
export async function reconcileMeetingReminders(
  deps: ReconciliationDeps,
): Promise<number> {
  const { repository, boss } = deps;
  const logger = deps.logger ?? console;

  const events = await repository.listUnremindedFuture();
  logger.info('Startup reconciliation: found unreminded future events', {
    count: events.length,
  });

  let scheduled = 0;
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
      logger.error('Startup reconciliation: failed to schedule reminder', {
        meetingId: event.id,
        eventVersion: event.eventVersion,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Startup reconciliation: complete', {
    events: events.length,
    scheduled,
  });
  return scheduled;
}
