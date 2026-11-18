/**
 * Manual club event persistence (P3).
 *
 * `/event add` writes rows and `/event cancel` marks a scheduled row cancelled.
 * Rows are never deleted, there is no channel scanning, no recurring event
 * model and no reminder lifecycle: `events` is a simple listing table,
 * separate from L3's `meeting_events`.
 */

import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { events, type ManualEvent, type NewManualEvent } from './schema';

export const DEFAULT_UPCOMING_LIMIT = 10;
export const MAX_UPCOMING_LIMIT = 25;

export interface EventRepository {
  create(input: NewManualEvent): Promise<ManualEvent>;
  getById(guildId: string, id: number): Promise<ManualEvent | null>;
  /**
   * Conditionally cancel a scheduled event. Returns the updated row, or
   * `null` when the event is missing, belongs to another guild, or is no
   * longer scheduled.
   */
  cancel(guildId: string, id: number): Promise<ManualEvent | null>;
  /**
   * Scheduled events that are upcoming or ongoing for one guild, sorted by
   * start. An event is ongoing when its end is still in the future.
   */
  listUpcoming(
    guildId: string,
    now: Date,
    limit?: number,
  ): Promise<ManualEvent[]>;
  countUpcoming(guildId: string, now: Date): Promise<number>;
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_UPCOMING_LIMIT;
  if (!Number.isFinite(requested)) {
    return DEFAULT_UPCOMING_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(requested), MAX_UPCOMING_LIMIT));
}

function upcomingCondition(now: Date) {
  return or(
    and(isNull(events.endAt), gte(events.startAt, now)),
    gte(events.endAt, now),
  );
}

export function createEventRepository(db: Db): EventRepository {
  return {
    async create(input) {
      const inserted = await db.insert(events).values(input).returning();
      if (inserted.length === 0) {
        throw new Error('Failed to save the manual event');
      }
      return inserted[0];
    },

    async getById(guildId, id) {
      const rows = await db
        .select()
        .from(events)
        .where(and(eq(events.guildId, guildId), eq(events.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },

    async cancel(guildId, id) {
      const updated = await db
        .update(events)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.id, id),
            eq(events.status, 'scheduled'),
          ),
        )
        .returning();
      return updated[0] ?? null;
    },

    async listUpcoming(guildId, now, limit) {
      return db
        .select()
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            upcomingCondition(now),
          ),
        )
        .orderBy(asc(events.startAt), asc(events.id))
        .limit(clampLimit(limit));
    },

    async countUpcoming(guildId, now) {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            upcomingCondition(now),
          ),
        );
      return rows[0]?.value ?? 0;
    },
  };
}
