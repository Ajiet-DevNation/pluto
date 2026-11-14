# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-12 after initialization)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records (GitHub, Discord, Miro, meetings), always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** P2 — index all public Ajiet-DevNation repositories and support `/ask`. P1, L1, and L2 are merged. P2 PR #10 remains open; `fix/p2-github-indexing` is a local, unpushed takeover/fix branch. Build and 193 tests pass locally. App-backed full-corpus reindex and live Discord `/ask` acceptance remain pending.

## Team
- Project Lead: Khushi
- Bot Development: Pragathi, Likhith
- UI & Showcase: Two additional members — joining after the bot is completed (status: pending)

## Technical Stack (hosted on heavencloud plan)
- Backend: TypeScript, Node.js 22, Express.js, Discord.js v14
- Database: Neon PostgreSQL (pgvector, tsvector, Drizzle ORM)
- Job Queue: pg-boss
- GitHub Integration: Read-only GitHub App via Octokit App auth (implementation/live verification pending)
- Miro Integration: Read-only Miro access via MCP (boards, comments, texts, diagrams)
- AI & Embeddings: Cloudflare Workers AI (bge-base-en-v1.5, instruct model, Whisper)
- Audio Storage: None in v1; transcript-only ingestion

## Read-Only Boundary
- No writes to GitHub repositories
- No writes/edits to Discord history
- No indexing of private repositories or channels
- No unsupported general knowledge in answers
- Posting new Discord messages (answers, notifications, digests) is permitted

## Progress
| Phase | Status | Requirements | Progress |
|-------|--------|--------------|----------|
| Phase 1: Foundation & GitHub & Miro Indexing | ◐ Partial (GitHub code in place; App auth live check and Miro verification pending) | INDEX-01, INDEX-03 | 6/8 |
| Phase 2: Discord Indexing & Opt-Out | ✅ Complete (P1 merged and live-verified) | INDEX-02, OPTO-01 | 4/4 |
| Phase 3: Meeting Transcript & Audio Ingestion | ✅ Implemented (L2 merged; acceptance verification tracked) | INDEX-04 | 4/4 |
| Phase 4: /ask Q&A with Citations | ◐ In progress (P2 code and local tests ready; live full-corpus validation pending) | ASK-01 | 3/4 |
| Phase 5: /decisions & PR Notifications | ○ Pending | DECI-01, PRNT-01 | 0/3 |
| Phase 6: /digest Weekly Summaries | ○ Pending | DIGE-01 | 0/3 |
| Phase 7: Meeting Summaries & Action Items | ○ Pending | MEET-01 | 0/4 |
| Phase 8: Hardening & v1 Release | ○ Pending | All | 0/5 |

## Package Status

| Package | Owner | Status | Notes |
|---------|-------|--------|-------|
| K1 | Khushi | ✅ Merged (PR #1, #2) | Scaffold, Node 22, backend. PAT read access was verified. GitHub App is now installed; App auth code/live verification is still pending. |
| K2 | Khushi | ◐ Code merged (PR #3, #7); live Miro check pending | Read-only guards, citations, evidence gate, and tests are merged. Miro token/MCP/board allowlist and live read verification are still outstanding. |
| K3 | Khushi | ⬜ Pending | Depends on K2, P3, L3. |
| L1 | Likhith | ✅ Complete (PR #4 + #8, migration fix #12) | Neon/Drizzle, pg-boss, public issue indexing, scheduled worker, idempotent migrations, tests, `vector(768)`/`tsvector` migration. Latest `main` tests/build pass. |
| L2 | Likhith | ✅ Complete | Build audio file upload endpoint; transcribe via Cloudflare Workers AI Whisper; store transcripts in Neon (transcript-only, no R2); index meeting transcript content in Neon. Depends on L1. |
| L3 | Likhith | ⬜ Pending | Depends on L2, P2. |
| P1 | Pragathi | ✅ Merged and live-verified (PR #9) | Discord allowlist intake, startup backfill, bot-author exclusion, guild-scoped `/optout`; live verification passed. |
| P2 | Pragathi / Khushi takeover fix | ◐ In progress (PR #10 open; local `fix/p2-github-indexing`) | `/ask`, hybrid retrieval, App/PAT credential provider, paginated public-repository discovery, issues/PRs/commits/READMEs, and eligible source-file indexing with exclusions. Build and 193 tests pass locally; Khushi must run the App-backed full reindex and approve before any PR is opened. |
| P3 | Pragathi | ⬜ Pending | Depends on P2, L2. |

### Credentials inventory

Values are never recorded here — only existence, owner, scope and expiry.

| Credential | Status | Owner | Scope | Expiry |
|------------|--------|-------|-------|--------|
| Discord bot token | ✅ Active | Khushi | Bot, Message Content Intent | — |
| GitHub App | ✅ Created and installed; auth code/verification pending | Khushi | Ajiet-DevNation installation, read-only repo permissions; public repos | — |
| GitHub PAT (interim) | ✅ Active | Khushi | Fine-grained, public repos, Contents/Issues/Metadata read | 90 days |
| Neon `DATABASE_URL` | ✅ Active | Likhith | Dev database, pgvector | — |
| Miro access token | ❌ Missing | — | Board read | — |
| Cloudflare Workers AI | ✅ Active | Khushi | Workers AI: Read (account-wide); bge-base-en-v1.5 (768), llama-3.1-8b-instruct, whisper-large-v3-turbo | Token has no TTL — roll quarterly |
| Cloudflare R2 | ⛔ Not used in v1 | — | Transcript-only audio flow; no audio persistence | — |

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
- P2 full-corpus live reindex using the GitHub App; verify all public repos are enumerated and private repos/files remain excluded
- GitHub App live read-only verification; PAT remains fallback until it passes
- Miro access token, MCP server and board allowlist — pending
- P2 PR #10 — open and stale against latest `main`; takeover fix branch contains updated P2 work but is not pushed pending Khushi approval
- API contract #2, Miro contract #5, and Meeting contract #8 — pending
- Database contract #1 approval status — pending confirmation by Khushi
- Audio storage — decided: not needed for v1, transcript-only (audio goes directly to Whisper, buffer discarded)
- CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN — verified working via Live API check; need values in each .env for local runs
- UPLOAD_TOKEN — static upload auth token for v1; needs value in each .env
- UI & showcase team members — joining after bot completion (pending)

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
| Background job queues | `index-github-issues` (startup + 30min) + `index-transcript` (on upload); singleton, retryLimit 3, retryBackoff | `contracts/background-jobs.md` |
| Upload auth | Static `UPLOAD_TOKEN` bearer token for v1; per-user auth deferred to P3 | `contracts/database.md` (L2 contract) |
| Transcript storage | `meeting_transcripts` table + `search_chunks` chunks with `vector(768)` + `search_vector` tsvector | `contracts/database.md` (L2 contract), `contracts/search.md` |
| Audio persistence | None — audio buffer discarded after Whisper; no R2, no disk | `contracts/database.md` (L2 scope decision) |
| Citation URL for transcripts | `sourceUrl` from upload (e.g., Discord message link); gap tracked as pending if no real URL | `contracts/database.md` (L2 contract) |
| GitHub corpus scope | All public Ajiet-DevNation repos; README, issues, PRs, commits, and eligible text/source files; no private repos; paginated | `contracts/github.md`, `contracts/search.md` |

## Citation and channel safety rules
- `#pluto` is never indexed: the bot must not cite its own answers.
- The self-citation rule is about **bot-authored messages in any channel**, not only `#pluto`.
- `#pluto-bot` is excluded from v1 retrieval: operational noise, not project knowledge.

---

*Last updated: 2026-11-14 — P2 indexing fix in progress on local `fix/p2-github-indexing`; latest local validation: build clean, 193 tests pass. No push or PR opened; live App-backed reindex and Khushi approval are pending.*
