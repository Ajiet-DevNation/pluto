import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * meeting_events — L3 Automatic Meeting Announcer.
 *
 * Defined per contracts/database.md §meeting_events. Created through a new
 * migration (drizzle/migrations/0008_meeting_events.sql), never by editing an
 * applied migration.
 */
export const meetingEvents = pgTable('meeting_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  sourceMessageId: text('source_message_id').notNull(),
  sourceMessageUrl: text('source_message_url').notNull(),
  createdBy: text('created_by').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  eventVersion: integer('event_version').notNull().default(1),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  reminderMessageId: text('reminder_message_id'),
  reminderClaimedAt: timestamp('reminder_claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceMessageUnique: uniqueIndex(
    'meeting_events_source_message_unique',
  ).on(table.guildId, table.channelId, table.sourceMessageId),
  statusStartAtIdx: index('meeting_events_status_start_at_idx').on(
    table.status,
    table.startAt,
  ),
  startAtIdx: index('meeting_events_start_at_idx').on(table.startAt),
}));

export type MeetingEvent = typeof meetingEvents.$inferSelect;
export type NewMeetingEvent = typeof meetingEvents.$inferInsert;
