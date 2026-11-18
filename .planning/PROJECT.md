# Pluto

## What This Is

Pluto is a read-only Discord knowledge assistant for the DevNation developer community at AJIET. It connects information from public GitHub repositories, selected Discord channels, and Miro boards into one searchable place accessible through Discord. Members can ask questions and receive answers with source citations, view on-demand project activity snapshots and upcoming meetings/events, and rely on an automatic meeting announcer that detects meeting announcements in `#meeting-plans` and posts a reminder in `#pluto` one hour before the meeting.

## Core Value

Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Index public GitHub repositories belonging to Ajiet-DevNation (read-only)
- [ ] Index selected Discord channels (allowlist only; `#decisions` messages remain indexed evidence)
- [ ] Index Miro boards via REST v2 (read-only) — boards, comments, texts, diagrams, and other board content
- [ ] `/ask` — answer questions with citations to original sources
- [ ] `/digest` + `/upcoming` + `/event add` + `/help` — on-demand deterministic activity snapshots, upcoming meetings/events, manual event creation with a public `#events` record, and command discoverability
- [ ] Automatic Meeting Announcer — detect `#meeting-plans` announcements, confirm date/time, and remind one hour before the meeting
- [ ] `/optout` — allow members to opt out of message indexing

### Deferred from active v1

These capabilities are **deferred, not deleted**. Existing implementation and database structures remain in the repository and must not be removed as part of the v1 scope change.

| Capability | Status | Reason | Preserved |
|------------|--------|--------|-----------|
| `/decisions` command (DECI-01) | Removed from active v1 (2026-11-17) | The focused v1 keeps decisions as indexed evidence rather than a separate command | `#decisions` remains in the five-channel allowlist; its human-authored messages are available to `/ask` and `/digest` |
| Meeting transcript/audio upload (INDEX-04) | Deferred (2026-11-17) | v1 prioritises the automatic announcer; uploads are not required for it | L2 upload/transcription code, `meeting_transcripts`, and `search_chunks` rows remain |
| Transcript summaries, action-item extraction, `/meeting actions` (MEET-01) | Deferred (2026-11-17) | Depends on transcript uploads, which are deferred | No active assignment; do not implement from the old PR plan |
| Voice-channel recording | Out of scope for v1 | Not required for the announcer; adds privacy and infrastructure risk | None planned |
| Automatic user-facing Whisper transcription | Deferred with uploads | Not an active v1 workflow | Existing transcription module retained for legacy L2 code |
| `/meetings` transcript search, `/meeting upload`, `/meeting actions` | Not active v1 commands | The announcer uses message detection plus confirmation controls, not a slash command | No implementation required |

### Out of Scope

- Modifying GitHub repositories, Discord history, or Miro boards — Pluto is strictly read-only
- Indexing private repositories or private Discord channels
- Indexing or recording voice channels
- Generating answers from unsupported general knowledge (if no relevant evidence exists, Pluto must explicitly say so)
- Real-time chat, video posts, OAuth login, mobile app — not core to Pluto's knowledge-assistant value
- Writing to Discord history (editing/deleting messages); posting new bot messages (answers, reminders, digests) is permitted
- Automatic GitHub PR notifications (PRNT-01) — cancelled 2026-11-15; the Takoyaki bot already posts PR notices in the server, so Pluto would duplicate them

## Context

- Community: DevNation developer community at AJIET
- Information is currently scattered across GitHub repositories, Discord discussions, pull requests, and team meetings
- Developers waste time searching across platforms to understand previous decisions, project updates, code changes, and pending tasks
- Meetings are announced manually in `#meeting-plans`; members miss the announcements or misread the date/time
- Technical stack decisions already made (see Constraints)

## Constraints

- **[Tech stack]**: TypeScript, Node.js 22, Express.js, Discord.js v14 hosted on heavencloud plan — backend language/runtime fixed
- **[Database]**: Neon PostgreSQL with pgvector and tsvector, Drizzle ORM — vector + full-text search required
- **[Job queue]**: pg-boss — background jobs for GitHub indexing and durable meeting reminders. `/digest` is on demand and adds no digest scheduler.
- **[GitHub integration]**: Read-only GitHub App via Octokit App authentication, with a fine-grained PAT fallback during rollout — no repository writes
- **[Miro integration]**: Read-only Miro access via REST v2 — boards, comments, texts, diagrams, and other board content; no write operations on Miro
- **[AI & embeddings]**: Cloudflare Workers AI (bge-base-en-v1.5 embeddings, instruct model) — AI provider fixed. Whisper remains in the repository for legacy L2 code but is not an active v1 user workflow
- **[Meeting timezone]**: `Asia/Kolkata` is the configured interpretation timezone for meeting announcements
- **[Date parsing]**: Deterministic, testable parsing in application code. No new AI provider is introduced to infer dates or times; ambiguous input asks the announcer to clarify
- **[Audio storage]**: No active v1 audio ingestion. The legacy L2 upload path discards the audio buffer after transcription; no R2 or disk persistence. This is not part of active v1 acceptance
- **[Read-only]**: No writes to GitHub repos or Discord history; no private repo/channel indexing; no unsupported general knowledge — hard compliance boundary
- **[Timeline]**: Prioritize quality over the original end-of-week target; all seven active v1 capabilities must ship in v1 (PRNT-01 cancelled 2026-11-15; transcript and `/decisions` features deferred 2026-11-17)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| All ten capabilities in v1 | Initial user requirement — no features excluded from first release | Superseded 2026-11-15 (nine) and 2026-11-17 (seven active; transcript and `/decisions` capabilities deferred) |
| Drop automatic PR notifications (PRNT-01) | Takoyaki bot already posts PR notices in the server; Pluto would duplicate them in the channel | — Decided 2026-11-15 (Khushi) |
| Automatic Meeting Announcer replaces the transcript pipeline | A focused reminder feature is reliably deliverable and directly useful; transcript ingestion, summaries and action items depend on uploads that are not ready | — Decided 2026-11-17 (Khushi) |
| Remove `/decisions` command but keep `#decisions` indexed | Decisions remain valuable evidence for `/ask` and `/digest`; a separate command is not needed in v1 | — Decided 2026-11-17 (Khushi) |
| Defer transcript uploads, summaries, action items, `/meeting actions` and voice recording | Keeps v1 focused on the announcer and activity/event awareness; existing L2 code and tables are retained | — Decided 2026-11-17 (Khushi) |
| L3 owns the announcer end-to-end; P3 owns the activity/event-awareness commands | One clear owner per feature; no duplicated implementation | — Decided 2026-11-17 (Khushi) |
| Simplify `/digest` and add event awareness | An on-demand deterministic snapshot is simpler, cheaper and safer than an AI-written weekly digest. `/upcoming` and `/event add` cover club event awareness without channel scanning. `/resource` and `/upcoming all` are out of scope. | — Decided 2026-11-18 (Khushi) |
| Deterministic date/time parsing, no new AI provider | Testable, predictable clarification behavior; avoids new infrastructure and hallucinated times | — Decided 2026-11-17 (Khushi) |
| Durable reminders via pg-boss, honest at-least-once delivery | In-memory timers do not survive restarts; Discord delivery cannot be made exactly-once across the send/persist gap | — Decided 2026-11-17 (Khushi) |
| Prioritize quality, extend timeline | Avoid sacrificing correctness for an aggressive deadline | — Pending |
| Read-only with new-message posting permitted | Protects source data integrity while allowing bot to respond in Discord | — Pending |
| Opt-out = exclude messages from indexing | Respects member privacy without over-engineering granular controls | — Pending |
| Citations link to original source | Verifiability — users can jump to GitHub commit/PR, Discord message, or Miro board | — Pending |
| TypeScript + Node.js 22 + discord.js v14 | Existing team stack decision (per provided stack table) | — Pending |
| Neon Postgres + pgvector + tsvector + Drizzle | Vector + full-text search for knowledge retrieval | — Pending |
| Cloudflare Workers AI | AI embeddings and generation; legacy Whisper code retained but not an active v1 workflow | — Resolved |

---

*Last updated: 2026-11-18 — P3 scope revised: weekly AI digest replaced by an on-demand deterministic `/digest`, plus `/upcoming meetings`, `/upcoming events`, `/event add`, and `/help`. Active v1 remains seven capabilities.*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
