import { pgTable, serial, varchar, text, integer, bigint, timestamp, index, uuid, vector } from 'drizzle-orm/pg-core';

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  owner: varchar('owner', { length: 255 }).notNull(),
  htmlUrl: text('html_url').notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
});

export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
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

export const meetingTranscripts = pgTable('meeting_transcripts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  source: varchar('source', { length: 255 }).notNull(),
  sourceUrl: text('source_url'),
  audioFilename: varchar('audio_filename', { length: 500 }),
  audioDurationSeconds: integer('audio_duration_seconds'),
  language: varchar('language', { length: 50 }),
  transcribedAt: timestamp('transcribed_at', { withTimezone: true }).notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  titleIdx: index('meeting_transcripts_title_idx').on(table.title),
  sourceIdx: index('meeting_transcripts_source_idx').on(table.source),
  transcribedAtIdx: index('meeting_transcripts_transcribed_at_idx').on(table.transcribedAt),
}));

export const searchChunks = pgTable('search_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  sourceId: varchar('source_id', { length: 255 }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  sourceUrl: text('source_url').notNull(),
  channelId: varchar('channel_id', { length: 255 }),
  authorId: varchar('author_id', { length: 255 }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  searchVector: text('search_vector').notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  sourceIdx: index('search_chunks_source_type_source_id_chunk_idx').on(table.sourceType, table.sourceId, table.chunkIndex),
  authorIdx: index('search_chunks_author_id_idx').on(table.authorId),
}));