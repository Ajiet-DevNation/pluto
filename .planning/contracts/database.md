# Database schema contract

Owner: Likhith proposes; Khushi approves.
Status: Draft — pending Khushi approval.
Consumers: L1 (storage + indexing), L2 (meeting transcripts), L3 (/decisions, notifications), P2 (/ask retrieval), P3 (/digest).

## Purpose

Define the Neon PostgreSQL schema used by Pluto v1: tables, columns, types, indexes,
naming conventions, and migration strategy. Every consumer stores and retrieves using
this schema — additions are added here first, not invented at the call site.

## Database provider

Neon PostgreSQL with `pgvector` and `pg_trgm` extensions. Connection via `DATABASE_URL`
from the environment. ORM: Drizzle ORM with `node-postgres` driver.

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

## Planned tables

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

## Planned search chunk table

### `search_chunks`

Searchable chunks backing `/ask`, `/decisions`, `/digest`. Not yet created.
Embeddings and full-text vectors stored here per `contracts/search.md`.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | primary key |
| `source_type` | text | NO | `github` \| `discord` \| `meeting` \| `miro` |
| `source_id` | text | NO | issue/pr number, message id, transcript id |
| `source_url` | text | NO | original URL, built by `src/citations` |
| `channel_id` | text | YES | Discord only; `null` for other sources |
| `author_id` | text | YES | used for opt-out filtering |
| `content` | text | NO | the chunk text |
| `embedding` | vector(768) | YES | nullable until indexed |
| `search_vector` | tsvector | YES | generated from `content` via `english` config |
| `indexed_at` | timestamptz | NO | default `now()` |

Indexes:
- `search_chunks_source_type_source_id_idx` (btree on `(source_type, source_id)`)
- `search_chunks_author_id_idx` (btree on `author_id`)
- GIN index on `search_vector` for full-text search
- IVFFlat index on `embedding` (cosine distance) for vector search

Constraints:
- `embedding` dimension is hard-constrained to **768** (verified live against
  `@cf/baai/bge-base-en-v1.5`). Changing it requires a migration + re-index.

Source: `contracts/search.md` §Chunk format, §Full-text search

## Migration strategy

- `scripts/migrate/index.ts` applies `drizzle/migrations/*.sql` in filename order
- A `schema_migrations` table tracks applied filenames so re-runs are idempotent
- Each migration file is run at most once
- Migrations that alter existing columns (e.g. `0001_dear_cerise.sql`) are safe to
  skip if already applied

## Idempotency rule

Re-indexing upserts on `github_id` (issues) and `message_id` (discord_messages).
Re-runs must not create duplicates.

## What is not in this contract

- Chunk size / overlap tuning (after P2 has real query data)
- Reranking (not in v1)
- Miro MCP table structure (pending token and live verification)
