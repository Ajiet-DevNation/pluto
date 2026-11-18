/**
 * Read-only upcoming queries for `/upcoming meetings` and `/upcoming events`.
 *
 * Meetings come from L3's `meeting_events` (confirmed, future only). Manual
 * events come from P3's `events` (scheduled, future or ongoing). No writes and
 * no reminders live here.
 */

import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { events, type ManualEvent } from '../events/schema';
import { meetingEvents } from '../meetings/schema';

export const DEFAULT_UPCOMING_LIMIT = 10;
export const MAX_UPCOMING_LIMIT = 25;

export interface UpcomingMeeting {
  id: string;
  title: string;
  startAt: Date;
  sourceMessageUrl: string;
}

export interface UpcomingEvent {
  id: number;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
}

export interface UpcomingRepository {
  listMeetings(
    guildId: string,
    now: Date,
    limit?: number,
  ): Promise<UpcomingMeeting[]>;
  countMeetings(guildId: string, now: Date): Promise<number>;
  listEvents(
    guildId: string,
    now: Date,
    limit?: number,
  ): Promise<UpcomingEvent[]>;
  countEvents(guildId: string, now: Date): Promise<number>;
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_UPCOMING_LIMIT;
  if (!Number.isFinite(requested)) {
    return DEFAULT_UPCOMING_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), MAX_UPCOMING_LIMIT));
}

function eventUpcomingCondition(now: Date) {
  return or(
    and(isNull(events.endAt), gte(events.startAt, now)),
    gte(events.endAt, now),
  );
}

export function createUpcomingRepository(db: Db): UpcomingRepository {
  return {
    async listMeetings(guildId, now, limit) {
      return db
        .select({
          id: meetingEvents.id,
          title: meetingEvents.title,
          startAt: meetingEvents.startAt,
          sourceMessageUrl: meetingEvents.sourceMessageUrl,
        })
        .from(meetingEvents)
        .where(
          and(
            eq(meetingEvents.guildId, guildId),
            eq(meetingEvents.status, 'confirmed'),
            gte(meetingEvents.startAt, now),
          ),
        )
        .orderBy(asc(meetingEvents.startAt), asc(meetingEvents.id))
        .limit(clampLimit(limit));
    },

    async countMeetings(guildId, now) {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(meetingEvents)
        .where(
          and(
            eq(meetingEvents.guildId, guildId),
            eq(meetingEvents.status, 'confirmed'),
            gte(meetingEvents.startAt, now),
          ),
        );
      return rows[0]?.value ?? 0;
    },

    async listEvents(guildId, now, limit) {
      const rows: ManualEvent[] = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            eventUpcomingCondition(now),
          ),
        )
        .orderBy(asc(events.startAt), asc(events.id))
        .limit(clampLimit(limit));
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        startAt: row.startAt,
        endAt: row.endAt,
      }));
    },

    async countEvents(guildId, now) {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            eventUpcomingCondition(now),
          ),
        );
      return rows[0]?.value ?? 0;
    },
  };
}
