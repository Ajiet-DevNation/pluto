# Roadmap: Pluto

The **six** active v1 capabilities are covered across **six** phases. The 2026-11-18 revision removed `/ask` and ASK-01 from active v1; the retrieval engine is retained for a future re-enable. The 2026-11-17 revision removed the transcript upload milestone and the `/decisions` milestone from active v1 delivery, and replaced the transcript-based meeting phase with the Automatic Meeting Announcer (MEET-02). Automatic PR notifications (PRNT-01) were cancelled on 2026-11-15. Deferred work is listed separately and is not part of the v1 critical path. Each phase uses vertical MVP-style delivery — independently testable, end-to-end user value per phase — with **Mode: mvp** set on every phase.

## Phase 1: Foundation & GitHub Repository Indexing
**Goal:** Set up the Pluto backend scaffold and index the first public Ajiet-DevNation GitHub repository (read-only).
**Mode:** mvp
**Depends on:** —
**Owner:** Khushi (K1) with Likhith (L1 database/jobs)
**Success Criteria:**
1. TypeScript/Express/Discord.js backend scaffold runs locally (Node 22); deployment to heavencloud plan is Phase 6
2. Neon Postgres (pgvector, tsvector, Drizzle) database is provisioned and connected
3. pg-boss job queue is configured for background indexing jobs
4. Read-only GitHub credential can access Ajiet-DevNation public repos (App pending org owner; read-only PAT verified)
5. Read-only Miro access can read boards, comments, texts, diagrams (REST client in place; token and live verification pending)
6. First public repository's commits, PRs, and issues are indexed and searchable
7. Miro board content is indexed and searchable alongside GitHub content
8. No write operations are performed on GitHub or Miro (read-only verified)
**Requirements:** INDEX-01, INDEX-03
**Status (2026-11-17):** Partial — 6/8. GitHub indexing code and migrations are in place; App-backed live verification and a full reindex are pending. Miro is blocked on a token and approved board IDs.

## Phase 2: Discord Channel Indexing & Opt-Out
**Goal:** Connect Discord, index the five allowlisted channels, and implement `/optout`.
**Mode:** mvp
**Depends on:** Phase 1
**Owner:** Pragathi (P1)
**Success Criteria:**
1. Discord bot (discord.js v14) connects and joins the DevNation server
2. Exactly the five configured channels are indexed; non-selected channels are not, and `#pluto` is never indexed
3. `/optout` excludes a member's messages from indexing
4. Opted-out members' content does not appear in search or answers
**Requirements:** INDEX-02, OPTO-01
**Status (2026-11-17):** Complete — P1 merged and live-verified (PR #9). `#decisions` was added to the allowlist on 2026-11-15 and remains indexed.

## Phase 3: /ask Q&A with Citations (removed from active v1)
**Goal:** Answer questions through `/ask` with citations to original sources.
**Mode:** mvp
**Depends on:** Phases 1–2
**Owner:** Pragathi (P2)
**Success Criteria:**
1. /ask returns answers grounded in indexed content
2. Each answer displays one best supporting source (GitHub commit/PR URL, Discord message link, or Miro board URL)
3. When no relevant evidence exists, /ask explicitly states so
4. No unsupported general knowledge is used in answers
5. Contributor questions use the read-only contributors API and never guess names
**Requirements:** ASK-01
**Status (2026-11-18):** ⏸ Removed from active v1. The `/ask` command and handler are removed because the live answer path is not working reliably. The retrieval/indexing engine, schema, contracts, evaluation scripts and tests are retained for a possible future re-enable. P2 implementation (PR #10) and the retrieval audit (PR #14) remain merged historically.

## Phase 4: Project Activity & Event Awareness
**Goal:** Provide on-demand project activity snapshots and simple upcoming-event awareness without AI-written summaries or a weekly scheduler.
**Mode:** mvp
**Depends on:** Phase 3 (indexed retrieval) and Phase 5's `meeting_events` schema for `/upcoming meetings`; not dependent on transcripts.
**Owner:** Pragathi (P3)
**Success Criteria:**
1. `/digest days:N` returns a deterministic activity snapshot for 1–30 days (default 7).
2. `/upcoming meetings` lists confirmed future meetings from `meeting_events`.
3. `/upcoming events` lists scheduled future or ongoing manual events from `events`.
4. `/event add` is guild-scoped and available to every member, validates strict date/time input, saves the event, sends an ephemeral confirmation, and posts a public record in `#events`; `/event cancel` lets creators cancel their own events and Manage Events cancel any event, updates the row without deleting it, and posts a public cancellation notice.
5. `/help` lists the available commands.
6. Digest and event output is grounded in indexed records; empty periods are handled honestly.
7. Opt-out, privacy, bot-author, and existing-command rules are preserved.
**Requirements:** DIGE-01
**Status (2026-11-18):** ✅ Complete — P3. `/digest`, `/upcoming meetings`, `/upcoming events`, `/event add`, `/event cancel`, and `/help` are implemented with unit and database integration coverage; 421 tests pass, build clean. Migration `0009_events` is recorded. Live Discord acceptance passed for all P3 flows, public replies, and the 12-hour display. The P3 PR (#18) is open for Khushi review/merge.

## Phase 5: Automatic Meeting Announcer
**Goal:** Detect eligible meeting announcements in `#meeting-plans`, deterministically parse the date/time, persist the event, and deliver one reminder in `#pluto` one hour before the meeting. Valid future announcements are auto-scheduled; no confirmation or slash command is used.
**Mode:** mvp
**Depends on:** Phases 1–2 (database/jobs and Discord intake); **not** dependent on transcript uploads, `/ask`, or activity/event commands
**Owner:** Likhith (L3)
**Success Criteria:**
1. Only human-authored messages in the configured `#meeting-plans` channel are considered
2. Detection requires an actual Discord `@everyone`/`@here` mention (metadata, not text matching) plus meeting-related language
3. Supported date/time expressions are parsed deterministically in `Asia/Kolkata`; ambiguity asks the announcer to clarify
4. Ambiguous or invalid date/time input receives a clarification; valid future events are auto-scheduled without a confirmation step
5. Events are stored in `meeting_events` with a unique source announcement identity and event version
6. Reminder jobs are durable through pg-boss; a real worker is registered and startup reconciliation recovers missing jobs
7. One reminder is delivered to `#pluto` one hour before the meeting without repeating `@everyone`/`@here`
8. Duplicate announcements and concurrent delivery are controlled; the at-least-once delivery guarantee is documented honestly
9. Failures are logged safely and recovered where possible
10. Existing `/optout` and Discord indexing behavior is unaffected
11. Unit and integration tests pass
**Requirements:** MEET-02
**Status (2026-11-18):** Implementation, shared-file integration, migration, and test-guild end-to-end acceptance complete. A real Discord announcement was persisted and its pg-boss reminder delivered to the test server; the reminder did not repeat a mass mention. Late reminder jobs now skip delivery, and events are marked completed after reminder delivery or meeting start. TypeScript/build pass; 366 tests pass (0 fail, 0 skip). Production/deployment acceptance and contract approvals remain pending.

## Phase 6: Hardening, Quality Verification & v1 Release
**Goal:** Verify all six active v1 capabilities, enforce the read-only boundary, and release v1.
**Mode:** mvp
**Depends on:** Phases 1–5
**Owner:** Khushi (K2, K3)
**Success Criteria:**
1. All six active v1 requirements are implemented and tested
2. Read-only boundary verified: no GitHub writes, no Discord history edits, no Miro writes, no private indexing, no unsupported answers
3. Citations consistently link to original sources
4. Meeting announcer safety verified: no mass mention, no history edits, no voice recording, no duplicate reminders
5. All acceptance criteria across phases pass verification
6. v1 release deployed to heavencloud plan
**Requirements:** All active v1 (INDEX-01..03, DIGE-01, MEET-02, OPTO-01)

---

## Deferred / not a v1 delivery phase

These items are retained in the repository but are **not** active v1 milestones and have no active assignment:

| Deferred item | Original requirement | Note |
|---------------|----------------------|------|
| Meeting transcript/audio upload and transcription | INDEX-04 | L2 code and `meeting_transcripts` remain; no new upload workflow is active |
| Transcript-derived summaries, action items, `/meeting actions` | MEET-01 | Depends on deferred uploads; do not implement from the old PR plan |
| `/ask` grounded Q&A | ASK-01 | Command/handler removed 2026-11-18; retrieval/indexing engine, schema, contracts and tests retained for future |
| `/decisions` command | DECI-01 | `#decisions` remains indexed evidence for `/digest` and a future `/ask` |

## Phase dependencies

| Phase | Depends on | Notes |
|-------|------------|-------|
| 1 | — | Foundation, database, jobs, GitHub/Miro clients |
| 2 | 1 | Discord bot and allowlist intake |
| 3 | 1, 2 | Removed from active v1; `/ask` command removed, retrieval engine retained for future |
| 4 | 1, 2, 5 | Activity snapshot uses indexed issues/Discord storage; `/upcoming meetings` reads the `meeting_events` schema delivered by Phase 5. No digest scheduler. |
| 5 | 1, 2 | Announcer uses database/jobs and Discord message intake; independent of transcripts, `/ask`, and activity commands |
| 6 | 1–5 | Release verification |

## Coverage Summary

| # | Phase | Requirements | Success Criteria |
|---|-------|--------------|------------------|
| 1 | Foundation & GitHub Repository Indexing | INDEX-01, INDEX-03 | 8 |
| 2 | Discord Channel Indexing & Opt-Out | INDEX-02, OPTO-01 | 4 |
| 3 | /ask Q&A with Citations (removed) | ASK-01 | 0 active |
| 4 | Project Activity & Event Awareness | DIGE-01 | 12 |
| 5 | Automatic Meeting Announcer | MEET-02 | 12 |
| 6 | Hardening, Quality Verification & v1 Release | All active v1 | 6 |

**Total:** 6 phases | **6 active v1 requirements** | All active v1 requirements covered ✓

**Deferred:** INDEX-04, MEET-01. **Removed from active v1:** ASK-01, DECI-01. **Cancelled:** PRNT-01.

---

*Last updated: 2026-11-18 — P3 activity and event-awareness is complete (`/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`); 421 tests pass, build clean, migration `0009_events` recorded, and live acceptance passed. The P3 PR (#18) is open for Khushi review/merge. ASK-01 and its `/ask` command are removed from active v1 on 2026-11-18; the retrieval engine is retained for future. L3 implementation, shared integration, and real test-guild acceptance are recorded; production/deployment acceptance and contract approval remain pending. Active v1 is six requirements across six phases.*
