import { pgTable, serial, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  owner: varchar('owner', { length: 255 }).notNull(),
  htmlUrl: text('html_url').notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
});

export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  repositoryId: integer('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  number: integer('number').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  body: text('body'),
  state: varchar('state', { length: 50 }).notNull(),
  htmlUrl: text('html_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  repoIdx: index('issues_repository_id_idx').on(table.repositoryId),
}));
