import { index, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * events — P3 manual club events.
 *
 * Defined per contracts/database.md §events. Created through
 * drizzle/migrations/0009_events.sql; never by editing an applied migration.
 * This table is deliberately separate from meeting_events: meetings keep the
 * announcer lifecycle and reminder claims, while manual events are simple
 * listings. `/upcoming events` and `/digest` read this table.
 */
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  guildId: text('guild_id').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
  createdBy: text('created_by').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildStartIdx: index('events_guild_start_idx').on(table.guildId, table.startAt),
}));

export type ManualEvent = typeof events.$inferSelect;
export type NewManualEvent = typeof events.$inferInsert;
