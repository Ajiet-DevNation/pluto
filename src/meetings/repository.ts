/**
 * Meeting event persistence (L3).
 *
 * Wraps the meeting_events table with the announcer lifecycle: idempotent
 * creation on the unique source identity, confirmation, cancellation,
 * rescheduling (version bump), the conditional delivery claim, and delivery
 * bookkeeping. The conditional claim uses reminder_claimed_at with a 10-minute
 * expiry per contracts/background-jobs.md §8.
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { meetingEvents, type MeetingEvent, type NewMeetingEvent } from './schema.js';

export interface MeetingRepository {
  create(input: NewMeetingEvent): Promise<MeetingEvent | null>;
  getBySource(
    guildId: string,
    channelId: string,
    sourceMessageId: string,
  ): Promise<MeetingEvent | null>;
  getById(id: string): Promise<MeetingEvent | null>;
  confirm(id: string): Promise<MeetingEvent | null>;
  cancel(id: string, expectedVersion: number): Promise<MeetingEvent | null>;
  reschedule(
    id: string,
    expectedVersion: number,
    newStartAt: Date,
  ): Promise<MeetingEvent | null>;
  claim(id: string, expectedVersion: number): Promise<MeetingEvent | null>;
  markSent(id: string, messageId: string): Promise<MeetingEvent | null>;
  markCompleted(id: string): Promise<MeetingEvent | null>;
  listUnremindedFuture(): Promise<MeetingEvent[]>;
}

export function createMeetingRepository(db: NodePgDatabase<typeof schema>): MeetingRepository {
  return {
    async create(input) {
      const inserted = await db
        .insert(meetingEvents)
        .values(input)
        .onConflictDoNothing({
          target: [
            meetingEvents.guildId,
            meetingEvents.channelId,
            meetingEvents.sourceMessageId,
          ],
        })
        .returning();
      if (inserted.length > 0) {
        return inserted[0];
      }
      // Idempotent re-detection of the same announcement: return the existing row.
      return this.getBySource(input.guildId, input.channelId, input.sourceMessageId);
    },

    async getBySource(guildId, channelId, sourceMessageId) {
      const rows = await db
        .select()
        .from(meetingEvents)
        .where(
          and(
            eq(meetingEvents.guildId, guildId),
            eq(meetingEvents.channelId, channelId),
            eq(meetingEvents.sourceMessageId, sourceMessageId),
          ),
        );
      return rows[0] ?? null;
    },

    async getById(id) {
      const rows = await db.select().from(meetingEvents).where(eq(meetingEvents.id, id));
      return rows[0] ?? null;
    },

    async confirm(id) {
      const rows = await db
        .update(meetingEvents)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(eq(meetingEvents.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async cancel(id, expectedVersion) {
      const rows = await db
        .update(meetingEvents)
        .set({
          status: 'cancelled',
          eventVersion: sql`${meetingEvents.eventVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(meetingEvents.id, id), eq(meetingEvents.eventVersion, expectedVersion)))
        .returning();
      return rows[0] ?? null;
    },

    async reschedule(id, expectedVersion, newStartAt) {
      const rows = await db
        .update(meetingEvents)
        .set({
          startAt: newStartAt,
          eventVersion: sql`${meetingEvents.eventVersion} + 1`,
          status: 'confirmed',
          updatedAt: new Date(),
        })
        .where(and(eq(meetingEvents.id, id), eq(meetingEvents.eventVersion, expectedVersion)))
        .returning();
      return rows[0] ?? null;
    },

    async claim(id, expectedVersion) {
      const rows = await db
        .update(meetingEvents)
        .set({ reminderClaimedAt: new Date() })
        .where(
          and(
            eq(meetingEvents.id, id),
            eq(meetingEvents.status, 'confirmed'),
            eq(meetingEvents.eventVersion, expectedVersion),
            isNull(meetingEvents.reminderSentAt),
            sql`(${meetingEvents.reminderClaimedAt} IS NULL OR ${meetingEvents.reminderClaimedAt} < now() - interval '10 minutes')`,
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async markSent(id, messageId) {
      const rows = await db
        .update(meetingEvents)
        .set({
          reminderSentAt: new Date(),
          reminderMessageId: messageId,
          updatedAt: new Date(),
        })
        .where(eq(meetingEvents.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async markCompleted(id) {
      const rows = await db
        .update(meetingEvents)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(meetingEvents.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async listUnremindedFuture() {
      return db
        .select()
        .from(meetingEvents)
        .where(
          and(
            eq(meetingEvents.status, 'confirmed'),
            isNull(meetingEvents.reminderSentAt),
            gt(meetingEvents.startAt, new Date()),
          ),
        );
    },
  };
}

export type { MeetingEvent };
