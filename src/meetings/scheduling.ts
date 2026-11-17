/**
 * Durable reminder scheduling (L3).
 *
 * Sends a singleton pg-boss job to the send-meeting-reminder queue. Uses a
 * stable singleton key derived from meeting ID and event version so obsolete
 * jobs never duplicate. Never uses setTimeout for production reminders.
 */

import type { PgBoss } from 'pg-boss';

export const MEETING_REMINDER_QUEUE = 'send-meeting-reminder';

export interface ReminderPayload {
  meetingId: string;
  eventVersion: number;
}

export interface SchedulingOpts {
  /** Claim expiry in seconds (10 minutes per background-jobs contract). */
  expireInSeconds?: number;
  retryLimit?: number;
  retryBackoff?: boolean;
}

export function singletonKey(meetingId: string, eventVersion: number): string {
  return `meeting:${meetingId}:v${eventVersion}`;
}

function msToSeconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

/**
 * Schedule a reminder for start_at - 1 hour.
 *
 * - If start_at - 1h is already in the past but the meeting is still future,
 *   schedule immediately (startAfter 0).
 * - If the meeting has already started, do not schedule (returns null).
 * - Returns the pg-boss job id, or null when not scheduled.
 */
export function scheduleReminder(
  boss: PgBoss,
  meetingId: string,
  eventVersion: number,
  startAt: Date,
  opts: SchedulingOpts = {},
): Promise<string | null> {
  const now = Date.now();
  const startMs = startAt.getTime();

  // If the meeting has already started, do not schedule.
  if (startMs <= now) {
    return Promise.resolve(null);
  }

  const reminderMs = startMs - 60 * 60 * 1000; // one hour before
  const startAfterSec = msToSeconds(Math.max(0, reminderMs - now));

  return boss.send(
    MEETING_REMINDER_QUEUE,
    { meetingId, eventVersion } as ReminderPayload,
    {
      startAfter: startAfterSec,
      singletonKey: singletonKey(meetingId, eventVersion),
      retryLimit: opts.retryLimit ?? 3,
      retryBackoff: opts.retryBackoff ?? true,
      expireInSeconds: opts.expireInSeconds ?? 600, // 10-minute claim expiry
    },
  );
}
