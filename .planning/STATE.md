# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-12 after initialization)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records (GitHub, Discord, Miro, meetings), always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** P1 (Pragathi) implemented and **live-verified** on `feat/pragathi` — Discord allowlist intake, startup backfill, bot-author exclusion and guild-scoped `/optout`. 114 tests pass, build clean; PR #9 open for review. Discord contract still pending Khushi approval. P2 pending.

## Team
- Project Lead: Khushi
- Bot Development: Pragathi, Likhith
- UI & Showcase: Two additional members — joining after the bot is completed (status: pending)

## Technical Stack (hosted on heavencloud plan)
- Backend: TypeScript, Node.js 22, Express.js, Discord.js v14
- Database: Neon PostgreSQL (pgvector, tsvector, Drizzle ORM)
- Job Queue: pg-boss
- GitHub Integration: Read-only GitHub App via Ganju MCP + Octokit
- Miro Integration: Read-only Miro access via MCP (boards, comments, texts, diagrams)
- AI & Embeddings: Cloudflare Workers AI (bge-base-en-v1.5, instruct model, Whisper)
- Audio Storage: Cloudflare R2 (temporary, under consideration)

## Read-Only Boundary
- No writes to GitHub repositories
- No writes/edits to Discord history
- No indexing of private repositories or channels
- No unsupported general knowledge in answers
- Posting new Discord messages (answers, notifications, digests) is permitted

## Progress
| Phase | Status | Requirements | Progress |
|-------|--------|--------------|----------|
| Phase 1: Foundation & GitHub & Miro Indexing | ● Complete (L1 done) | INDEX-01, INDEX-03 | 6/8 |
| Phase 2: Discord Indexing & Opt-Out | ✅ Complete (P1 live-verified; PR #9 open) | INDEX-02, OPTO-01 | 4/4 |
| Phase 3: Meeting Transcript & Audio Ingestion | ○ Pending | INDEX-04 | 0/4 |
| Phase 4: /ask Q&A with Citations | ○ Pending | ASK-01 | 0/4 |
| Phase 5: /decisions & PR Notifications | ○ Pending | DECI-01, PRNT-01 | 0/3 |
| Phase 6: /digest Weekly Summaries | ○ Pending | DIGE-01 | 0/3 |
| Phase 7: Meeting Summaries & Action Items | ○ Pending | MEET-01 | 0/4 |
| Phase 8: Hardening & v1 Release | ○ Pending | All | 0/5 |

## Package Status

| Package | Owner | Status | Notes |
|---------|-------|--------|-------|
| K1 | Khushi | ✅ Merged (PR #1, #2) | Scaffold, Node 22, working `npm start`, README. GitHub App not created — org role is `member`; interim read-only fine-grained PAT verified (`GET` 200 / write attempt 403). |
| K2 | Khushi | ✅ Merged (PR #3, `b3761d9`) | Security contract, read-only guard, GitHub/Miro read clients, citation layer, evidence gate, live citation check, 40 tests. Deferred: Miro live verification (`pending`, last in sequence); opt-out verification moved to CP3 (needs P1 `/optout` and L1 retrieval). |
| K3 | Khushi | ⬜ Pending | Depends on K2, P3, L3. |
| L1 | Likhith | ✅ Merged (PR #4, `73b06b7`) | Neon provisioned and connected. Drizzle schema, pg-boss queue (polling mode, verified on Neon), GitHub issues indexing code written and verified live. 8 repositories, 366 issues indexed in Neon. **Open follow-ups:** no worker/scheduler (indexing runs manually), migrations do not create `vector`/`tsvector` columns. **Completed follow-ups:** migrate runner is now idempotent (schema_migrations tracking table), indexer has test coverage (tests/db/index-github-issues.test.ts), database contract drafted at .planning/contracts/database.md (pending Khushi approval). |
| L2 | Likhith | ⬜ Pending | Depends on L1. |
| L3 | Likhith | ⬜ Pending | Depends on L2, P2. |
| P1 | Pragathi | ✅ Verified — PR #9 open | Branch `feat/pragathi`. discord.js v14 client, allowlist intake for the 4 configured channels, one startup backfill, bot-author exclusion, guild-scoped `/optout`, JSON state. 114 tests pass, build clean. Live verification 2026-11-14: `pluto#6497` online in DevNation; backfill 57/11/5/0; 0 records in `#core-secrets`/other non-allowlisted channels; guild commands `["optout"]`, global `[]`; member opt-out purged 2 records and blocked a later message. Pre-test state restored afterward. |
| P2 | Pragathi | ⬜ Pending | Depends on P1, L1. |
| P3 | Pragathi | ⬜ Pending | Depends on P2, L2. |

### Credentials inventory

Values are never recorded here — only existence, owner, scope and expiry.

| Credential | Status | Owner | Scope | Expiry |
|------------|--------|-------|-------|--------|
| Discord bot token | ✅ Active | Khushi | Bot, Message Content Intent | — |
| GitHub App | ❌ Not created | — | Requires Ajiet-DevNation org owner | — |
| GitHub PAT (interim) | ✅ Active | Khushi | Fine-grained, public repos, Contents/Issues/Metadata read | 90 days |
| Neon `DATABASE_URL` | ✅ Active | Likhith | Dev database, pgvector | — |
| Miro access token | ❌ Missing | — | Board read | — |
| Cloudflare Workers AI | ✅ Active | Khushi | Workers AI: Read (account-wide); bge-base-en-v1.5 (768), llama-3.1-8b-instruct, whisper-large-v3-turbo | Token has no TTL — roll quarterly |
| Cloudflare R2 | ❌ Pending decision | — | Audio storage | — |

## Discord Channel Policy

| Role | Channel | ID |
|------|---------|-----|
| Bot output + commands | `#pluto` | `1570721649538502686` |
| Indexed | `#project-stack` | `1423323863093088407` |
| Indexed | `#resources` | `1422593926367547487` |
| Indexed | `#announcements` | `1422593926367547486` |
| Indexed | `#meeting-plans` (created 2026-11-14, under Projects) | `1570872485933752502` |
| Excluded | `#pluto`, `#pluto-bot`, `#general` (text + media), `#off-topic`, `#assets`, `#welcome-and-rules`, `#takoyaki`, voice channels | — |
| Not in policy | `#core-general`, `#code-wars`, `#event-ideation`, `#core-secrets`, `#dn-orbit-website`, `#server-hub`, `#bumblebee` — the bot can see them, but they are **not** indexed | — |

**Indexing is allowlist-only.** Index exactly the 4 channels in `config.json → discord.indexed_channels`. Never infer from `excluded_channels`: that list is documentation and is not exhaustive. Verified against the live channel list on 2026-11-14 — the bot sees 29 channels, 4 of which are indexed.

`#pluto` is never indexed: the bot must not cite its own answers.

## Fresh-Session Workflow
At the start of each development session:

1. Read `.planning/PROJECT.md` for core value, constraints, and key decisions.
2. Read `.planning/STATE.md` for current focus, phase status, and team context.
3. Read `.planning/ROADMAP.md` for the active phase's goal, success criteria, and requirements.
4. Read `.planning/REQUIREMENTS.md` for the acceptance criteria of requirements in the active phase.
5. Confirm the active phase and next task before writing code.
6. After completing a task, update `STATE.md` progress and mark requirements complete when verified.

## Repository-Based Handoff Requirements
- All planning documents (`.planning/`) live in this repository and are the source of truth.
- Each phase's work must be committed to this repository before handoff.
- `STATE.md` must be updated at the end of each session to reflect current phase, completed requirements, and pending items.
- The next session resumes by reading `PROJECT.md`, `STATE.md`, `ROADMAP.md`, and `REQUIREMENTS.md` — no out-of-band context required.
- Cross-session handoff is complete when: (a) code is committed, (b) `STATE.md` is updated, (c) acceptance criteria for completed requirements are verified and marked.
- Pending/unresolved decisions are marked `"pending"` in `PROJECT.md` Key Decisions and `config.json`, and are not assumed resolved across sessions.

## Unresolved / Pending Items
- GitHub App creation — blocked on Ajiet-DevNation org owner — pending
- Miro access token, MCP server and board allowlist — pending
- Background jobs worker/scheduler — contract written at `.planning/contracts/background-jobs.md`; code not started — pending (Likhith, task 2 — waiting on database contract approval)
- Migrations do not create `vector`/`tsvector` extension or columns; Neon has pgvector enabled out-of-band, so a fresh database is not reproducible — pending (Likhith, Phase 2 task 5)
- Discord contract (#3) — draft at `.planning/contracts/discord.md`; Khushi approval pending
- P1 PR #9 — open, live-verified, awaiting review/merge
- Audio storage final decision (Cloudflare R2) — pending
- UI & showcase team members — joining after bot completion (pending)
- Database contract `.planning/contracts/database.md` — drafted by Likhith, pending Khushi approval

## Decisions (2026-11-13)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| Background job worker placement | Same process as the Discord bot | `contracts/background-jobs.md` |
| GitHub indexing cadence | On startup + every 30 minutes | `contracts/background-jobs.md` |
| pg-boss mode | Polling (`useListenNotify: false`) — deliberate, because `DATABASE_URL` uses the Neon pooler | `contracts/background-jobs.md` |
| Retry policy | 3 attempts, exponential backoff | `contracts/background-jobs.md` |
| Job idempotency | Upsert on `github_id`; singleton jobs, no overlapping runs | `contracts/background-jobs.md` |
| Embedding model + dimension | `@cf/baai/bge-base-en-v1.5`, **768** (verified live) | `contracts/search.md` |
| Evidence threshold | `EVIDENCE_MIN_SCORE = 0.4` (v1 starting value, tuned after P2) | `contracts/search.md` |
| `#pluto-bot` | Logs-only for v1; never indexed. Revisit post-v1 with a bot-author filter | `config.json` channel policy |
| Cloudflare credential | Provisioned by Khushi; Workers AI Read token | `config.json` credentials |
| `#meeting-plans` | Created 2026-11-14 under Projects, `1570872485933752502`, **indexed** — replaces the unresolved state; `#event-ideation` not used | `config.json` discord.resolved |
| Channel indexing mode | **allowlist only** — never derive indexing from the exclusion list | `config.json` discord.indexing_mode |
| Discord indexing method | Gateway `MessageCreate` + one startup backfill per allowlisted channel (`after=<last_id>`); no webhooks | `contracts/discord.md` |
| Discord command scope | Guild-scoped `guild.commands.set`; global registration forbidden | `contracts/discord.md` |
| Bot-authored messages | Rejected at intake; stored records carry `author_is_bot=false` and are never retrieved or cited | `contracts/discord.md` |
| P1 persistence | Atomic JSON at `PLUTO_DATA_DIR` (default `~/.pluto`); Neon swap at P2 | `contracts/discord.md` |
| `/optout` reversibility | One-way in v1; `/optin` deferred to a later contract change | `contracts/discord.md` |

## Citation and channel safety rules
- `#pluto` is never indexed: the bot must not cite its own answers.
- The self-citation rule is about **bot-authored messages in any channel**, not only `#pluto`.
- `#pluto-bot` is excluded from v1 retrieval: operational noise, not project knowledge.

---

*Last updated: 2026-11-14 — P1 Discord indexing + `/optout` implemented and live-verified on `feat/pragathi` (114 tests pass, build clean; PR #9 open); L1 follow-ups complete: database contract drafted, migrate runner made idempotent, indexer tests added. Waiting on contract approval before task 2 (worker/scheduler).*
