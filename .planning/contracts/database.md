# Database schema contract

Owner: Likhith proposes; Khushi approves.
Status: Draft — pending Khushi approval (revised 2026-11-17 to add `meeting_events` and mark transcript storage legacy/deferred).
Consumers: L1 (storage + indexing), L2 (legacy meeting transcripts, deferred), L3 (Automatic Meeting Announcer: `meeting_events`), P2 (`/ask` retrieval), P3 (`/digest`).

## Purpose

Define the Neon PostgreSQL schema used by Pluto v1: tables, columns, types, indexes,
naming conventions, and migration strategy. Every consumer stores and retrieves using
this schema — additions are added here first, not invented at the call site.

## Database provider

Neon PostgreSQL with `pgvector`. Connection via `DATABASE_URL` from the
environment. ORM: Drizzle ORM with `node-postgres` driver. `pg_trgm` was dropped
by migration `0007_drop_pg_trgm.sql` because nothing uses it.

## Naming conventions

- Tables: snake_case, plural (`repositories`, `issues`, `discord_messages`, `search_chunks`)
- Columns: snake_case
- Primary keys: `id` serial, except `search_chunks.id` which is uuid
- Foreign keys: `<table>_id` referencing `<table>.id`
- Unique constraints: `<table>_<column>_unique`
- Indexes: `<table>_<column>_idx`
- Migration files: `drizzle/migrations/<timestamp>_<name>.sql`, applied in filename order

## Existing tables

### `repositories`

Indexed public GitHub repositories belonging to Ajiet-DevNation.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | serial | NO | primary key |
| `github_id` | bigint | NO | unique; GitHub node id, `mode: 'number'` |
| `name` | varchar(255) | NO | repository short name |
| `full_name` | varchar(255) | NO | `owner/repo` |
| `owner` | varchar(255) | NO | GitHub org/user login |
| `html_url` | text | NO | repository URL |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `repositories_github_id_unique` (unique on `github_id`)

Source: `src/db/schema.ts`, migration `0000_nifty_stryfe.sql`

### `issues`

Indexed public GitHub issues (not pull requests) from Ajiet-DevNation repos.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | serial | NO | primary key |
| `github_id` | bigint | NO | unique; GitHub issue node id, `mode: 'number'` |
| `repository_id` | integer | NO | FK → `repositories.id` ON DELETE cascade |
| `number` | integer | NO | issue number within repo |
| `title` | varchar(500) | NO | issue title |
| `body` | text | YES | issue body |
| `state` | varchar(50) | NO | `open` / `closed` |
| `html_url` | text | NO | issue URL |
| `created_at` | timestamptz | NO | GitHub created_at |
| `updated_at` | timestamptz | NO | GitHub updated_at |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `issues_github_id_unique` (unique on `github_id`)
- `issues_repository_id_idx` (btree on `repository_id`)
- FK: `issues_repository_id_repositories_id_fk`

Source: `src/db/schema.ts`, migrations `0000_nifty_stryfe.sql` + `0001_dear_cerise.sql`

Migration `0001_dear_cerise.sql` alters `github_id` columns from `integer` to `bigint`
because GitHub node ids exceed `integer` range (observed value: 2627377453).

## Additional tables

`discord_messages` below remains planned/not created (P1 uses a JSON store). `meeting_transcripts` is implemented but legacy/deferred. `meeting_events` is the active v1 addition for L3.

### `discord_messages`

Indexed messages from allowlisted Discord channels. Not yet created.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | serial | NO | primary key |
| `message_id` | bigint | NO | unique; Discord snowflake id |
| `channel_id` | text | NO | Discord channel id |
| `channel_name` | varchar(255) | NO | channel name for display |
| `author_id` | text | NO | Discord user id (used for opt-out filtering) |
| `author_name` | varchar(255) | NO | display name at index time |
| `content` | text | NO | message text |
| `message_url` | text | NO | Discord message jump URL |
| `created_at` | timestamptz | NO | Discord message timestamp |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `discord_messages_message_id_unique` (unique on `message_id`)
- `discord_messages_channel_id_idx` (btree on `channel_id`)
- `discord_messages_author_id_idx` (btree on `author_id`)

### `meeting_transcripts`

**Legacy/deferred (not an active v1 workflow).** Stored meeting transcripts from
uploaded audio or text files. Merged by L2 (PR #11, #12) and retained in the
repository. Audio was transcribed via Cloudflare Workers AI Whisper and only the
transcript text is stored — no audio files are retained (Cloudflare R2 was never
used). The upload/transcription user workflow is deferred from active v1
(2026-11-17); do not drop this table or its existing rows as part of the meeting
announcer work.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | primary key, default `gen_random_uuid()` |
| `title` | varchar(500) | NO | transcript title / meeting name |
| `content` | text | NO | full transcript text from Whisper |
| `source` | varchar(255) | NO | upload source (e.g. `upload`, `meeting-plans`) |
| `audio_filename` | varchar(500) | YES | original uploaded audio filename |
| `audio_duration_seconds` | integer | YES | duration of source audio |
| `language` | varchar(50) | YES | detected/transcription language |
| `transcribed_at` | timestamptz | NO | when Whisper completed transcription |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `meeting_transcripts_title_idx` (btree on `title`)
- `meeting_transcripts_source_idx` (btree on `source`)
- `meeting_transcripts_transcribed_at_idx` (btree on `transcribed_at`)

### `meeting_events`

**Active v1 — L3 Automatic Meeting Announcer.** Persisted confirmed meeting
events and their reminder delivery state. Defined here first; implemented by a
new Drizzle migration. No second event table or competing identity system is
allowed without documenting why.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | primary key, default `gen_random_uuid()` |
| `guild_id` | text | NO | Discord guild snowflake |
| `channel_id` | text | NO | source channel; must be the configured `#meeting-plans` ID |
| `source_message_id` | text | NO | original Discord announcement snowflake |
| `source_message_url` | text | NO | link to the original announcement |
| `created_by` | text | NO | announcing member's Discord user ID |
| `title` | varchar(500) | NO | meeting title/description |
| `start_at` | timestamptz | NO | timezone-aware meeting start |
| `timezone` | varchar(64) | NO | default `'Asia/Kolkata'`; check constraint |
| `status` | varchar(20) | NO | `pending` \| `confirmed` \| `cancelled` \| `completed` |
| `event_version` | integer | NO | default `1`; incremented on reschedule/cancel |
| `reminder_sent_at` | timestamptz | YES | set only after Discord accepts the reminder |
| `reminder_message_id` | text | YES | resulting `#pluto` message ID, where available |
| `reminder_claimed_at` | timestamptz | YES | proposed delivery-claim timestamp for concurrency control; final approval pending |
| `created_at` | timestamptz | NO | default `now()` |
| `updated_at` | timestamptz | NO | default `now()`, updated on change |

Constraints and indexes:
- `meeting_events_source_message_unique` — **unique** on `(guild_id, channel_id, source_message_id)`. The same Discord announcement cannot create duplicate events.
- `meeting_events_status_start_at_idx` — btree on `(status, start_at)` for due/confirmed-event lookup and startup reconciliation.
- `meeting_events_start_at_idx` — btree on `start_at`.
- Check constraint on `status` for the four allowed values.
- Check constraint that `timezone = 'Asia/Kolkata'` (or a documented allowlist if this ever expands).

Lifecycle:
- `pending` → `confirmed` on authorization; `cancelled` from pending/confirmed; `completed` after the meeting start/reminder handling.
- `event_version` starts at `1` and increments on every reschedule or cancellation. Reminder jobs carry the version they were scheduled for; a mismatch makes the job obsolete.
- `reminder_sent_at` and `reminder_message_id` are delivery tracking, not proof of exactly-once delivery. See `contracts/background-jobs.md` for the honest at-least-once guarantee.

Migration expectations:
- Add `drizzle/migrations/<timestamp>_meeting_events.sql`; use `CREATE TABLE IF NOT EXISTS`, the unique constraint, checks and indexes.
- Do not edit an applied migration.
- Do not drop or rewrite `meeting_transcripts` or existing meeting `search_chunks` rows.
- Apply through `scripts/migrate/index.ts`; re-runs must be idempotent.

## Search chunk table

### `search_chunks`

Searchable chunks backing `/ask` and `/digest`. The table is created
by `drizzle/migrations/0004_search_chunks.sql` and represented in
`src/db/schema.ts`. Embeddings and generated full-text vectors are stored here per
`contracts/search.md`. Existing chunks from meeting transcripts use
`source_type = 'meeting'` and are legacy/deferred: no new transcript ingestion is
active in v1, and the announcer does not write chunks. `#decisions` messages are
ordinary `source_type = 'discord'` chunks and remain eligible evidence.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | primary key |
| `source_type` | text | NO | `github` \| `discord` \| `meeting` \| `miro` |
| `source_id` | text | NO | stable source key (issue, PR, commit, README, repo file, Discord message, transcript) |
| `chunk_index` | integer | NO | zero-based position within the source |
| `source_url` | text | YES | original source URL; nullable for records without a citable URL |
| `channel_id` | text | YES | Discord only; `null` for other sources |
| `author_id` | text | YES | used for opt-out filtering |
| `content` | text | NO | the chunk text |
| `content_hash` | text | YES | model-versioned content hash for resume and vector reuse |
| `embedding` | vector(768) | YES | nullable until indexed |
| `search_vector` | tsvector | YES | generated from `content` via `english` config |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `search_chunks_source_type_source_id_chunk_idx` (unique btree on `(source_type, source_id, chunk_index)`)
- `search_chunks_author_id_idx` (btree on `author_id`)
- GIN index on `search_vector` for full-text search
- IVFFlat index on `embedding` (cosine distance) for vector search

`search_vector` is a generated `tsvector` column over `content`; callers never write it.

Constraints:
- `embedding` dimension is hard-constrained to **768** (verified live against
  `@cf/baai/bge-base-en-v1.5`). Changing it requires a migration + re-index.
- Chunk identity: `(source_type, source_id, chunk_index)` must be unique.
  Re-indexing upserts; it must not create duplicates.

Source: `contracts/search.md` §Chunk format, §Full-text search

### IVFFlat index operations (2026-11-16 audit)

Live index metadata:

- `search_chunks_embedding_idx` is `USING ivfflat (embedding vector_cosine_ops)`.
- `reloptions` is `null`, so it was created without an explicit `lists` option.
- PostgreSQL's default `ivfflat.probes` is `1`.
- The index's computed list count is not exposed by a catalog view. During the
  audit, a temporary transaction-local `enable_seqscan=off` was used to force
  index probes; recall stopped changing between probes 64 and 1000, so the
  effective count is at most ~64–100 on the current 7,880-chunk table.
  It is **not** 8: probes=8 recalls only 65.6% of exact top-5.

The application sets `ivfflat.probes` with
`set_config('ivfflat.probes', …, true)` inside the same transaction as the
vector query. The default is `IVFFLAT_PROBES=100`, which is effectively exact
for this index. No standalone `SET` is used. `enable_seqscan` is intentionally
not forced: measured plans show PostgreSQL choosing exact sequential/Bitmap
scans for this small table, and forcing the index could make a future rebuilt
index approximate. Re-tune `IVFFLAT_PROBES` if `lists` grows.

No index rebuild, replacement, or migration was performed. If one is needed:

1. Take a fresh `ANALYZE search_chunks`.
2. Create the replacement with `CREATE INDEX CONCURRENTLY` **outside** a
   transaction block (therefore not inside a Drizzle migration transaction).
3. For the current ~7.9k rows, a small explicit `lists` value (e.g. 64–100) is
   reasonable; for a much larger corpus follow pgvector guidance (rows/1000 up
   to 1M, `sqrt(rows)` above).
4. Validate recall against an exact scan with `npm run eval:retrieval` before
   dropping the old index.
5. Re-tune `IVFFLAT_PROBES` to cover the new list count.

### `content_hash` backfill (pending approval)

All 7,880 existing rows currently have `content_hash = NULL` because they were
embedded before migration `0005_search_chunk_hash.sql`. A normal reindex will
therefore re-embed every chunk instead of skipping unchanged content. Backfilling
the hash does **not** require re-embedding, but it is a production data write and
has not been executed. Proposed one-time operation, to be reviewed and approved:

```sql
UPDATE search_chunks
SET content_hash = encode(
  digest(
    convert_to('@cf/baai/bge-base-en-v1.5:768', 'UTF8')
      || '\x00'::bytea
      || convert_to(content, 'UTF8'),
    'sha256'
  ),
  'hex'
)
WHERE content_hash IS NULL;
```

`pgcrypto` (which provides `digest`) is already installed. PostgreSQL `text`
cannot contain a NUL byte, so the separator must be concatenated as `bytea`;
`chr(0)` would fail.

## Migration strategy

- `scripts/migrate/index.ts` applies `drizzle/migrations/*.sql` in filename order
- A `schema_migrations` table tracks applied filenames so re-runs are idempotent
- Each migration file is run at most once
- Migrations that alter existing columns (e.g. `0001_dear_cerise.sql`) are safe to
  skip if already applied
- L3 adds one new migration for `meeting_events`. It must not modify or drop the
  existing transcript tables or `search_chunks`.
- No migration is created by the 2026-11-17 documentation task; this section
  records the implementation requirement.

## Idempotency rule

Re-indexing upserts on `github_id` (issues) and message identity for Discord.
Re-runs must not create duplicates. Meeting events are idempotent on
`(guild_id, channel_id, source_message_id)` and reminder delivery is guarded by
`event_version` plus a conditional claim. Re-detecting the same announcement
must not create a second event.

## What is not in this contract

- Chunk size / overlap tuning (after P2 has real query data)
- Reranking (not in v1)
- Miro table structure (pending token and live verification)
- Transcript-derived summary or action-item tables (deferred with MEET-01)
- A second meeting-event table or alternative event identity (not permitted without documented justification)
