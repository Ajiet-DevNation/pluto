# Roadmap: Pluto

The **seven** active v1 capabilities are covered across **six** phases. The 2026-11-17 revision removed the transcript upload milestone and the `/decisions` milestone from active v1 delivery, and replaced the transcript-based meeting phase with the Automatic Meeting Announcer (MEET-02). Automatic PR notifications (PRNT-01) were cancelled on 2026-11-15. Deferred work is listed separately and is not part of the v1 critical path. Each phase uses vertical MVP-style delivery — independently testable, end-to-end user value per phase — with **Mode: mvp** set on every phase.

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

## Phase 3: /ask Q&A with Citations
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
**Status (2026-11-17):** Partial — P2 merged (PR #10, `298e557`) and the retrieval audit is merged (PR #14). Verified eval gate 9/9. Full-corpus reindex and live Discord acceptance are still pending.

## Phase 4: /digest Weekly Summaries
**Goal:** Generate and deliver weekly summaries of indexed project activity.
**Mode:** mvp
**Depends on:** Phase 3 (and Phase 1 for jobs/storage)
**Owner:** Pragathi (P3)
**Success Criteria:**
1. `/digest` can be invoked through the agreed guild-scoped Discord command
2. The digest summarizes the intended weekly period from indexed GitHub and Discord activity
3. Messages from the indexed `#decisions` channel are usable as supporting evidence
4. Digest content is grounded in indexed records only — no invented decisions, progress or contributors
5. An empty period produces a sensible response
6. Delivery scheduling is persistent and does not create duplicate digests
7. Opt-out, privacy and bot-author restrictions are preserved
**Requirements:** DIGE-01
**Status (2026-11-17):** Pending — P3.

## Phase 5: Automatic Meeting Announcer
**Goal:** Detect meeting announcements in `#meeting-plans`, confirm the date/time with the announcer, persist the event, and deliver one reminder in `#pluto` one hour before the meeting.
**Mode:** mvp
**Depends on:** Phases 1–2 (database/jobs and Discord intake); **not** dependent on transcript uploads, `/ask`, or `/digest`
**Owner:** Likhith (L3)
**Success Criteria:**
1. Only human-authored messages in the configured `#meeting-plans` channel are considered
2. Detection requires an actual Discord `@everyone`/`@here` mention (metadata, not text matching) plus meeting-related language
3. Supported date/time expressions are parsed deterministically in `Asia/Kolkata`; ambiguity asks the announcer to clarify
4. Confirmation is required before scheduling; only the original announcer or an authorized moderator can confirm, cancel or reschedule
5. Confirmed events are stored in `meeting_events` with a unique source announcement identity and event version
6. Reminder jobs are durable through pg-boss and survive restarts
7. One reminder is delivered to `#pluto` one hour before the meeting without repeating `@everyone`/`@here`
8. Cancellation and rescheduling invalidate obsolete jobs
9. Duplicate announcements and concurrent delivery are controlled
10. Failures are logged safely, recovered where possible, and the delivery guarantee is documented honestly
11. Existing `/ask`, `/optout` and Discord indexing behavior is unaffected
12. Unit and integration tests pass
**Requirements:** MEET-02
**Status (2026-11-17):** Pending — L3.

## Phase 6: Hardening, Quality Verification & v1 Release
**Goal:** Verify all seven active v1 capabilities, enforce the read-only boundary, and release v1.
**Mode:** mvp
**Depends on:** Phases 1–5
**Owner:** Khushi (K2, K3)
**Success Criteria:**
1. All seven active v1 requirements are implemented and tested
2. Read-only boundary verified: no GitHub writes, no Discord history edits, no Miro writes, no private indexing, no unsupported answers
3. Citations consistently link to original sources
4. Meeting announcer safety verified: no mass mention, no history edits, no voice recording, no duplicate reminders
5. All acceptance criteria across phases pass verification
6. v1 release deployed to heavencloud plan
**Requirements:** All active v1 (INDEX-01..03, ASK-01, DIGE-01, MEET-02, OPTO-01)

---

## Deferred / not a v1 delivery phase

These items are retained in the repository but are **not** active v1 milestones and have no active assignment:

| Deferred item | Original requirement | Note |
|---------------|----------------------|------|
| Meeting transcript/audio upload and transcription | INDEX-04 | L2 code and `meeting_transcripts` remain; no new upload workflow is active |
| Transcript-derived summaries, action items, `/meeting actions` | MEET-01 | Depends on deferred uploads; do not implement from the old PR plan |
| `/decisions` command | DECI-01 | `#decisions` remains indexed evidence for `/ask` and `/digest` |

## Phase dependencies

| Phase | Depends on | Notes |
|-------|------------|-------|
| 1 | — | Foundation, database, jobs, GitHub/Miro clients |
| 2 | 1 | Discord bot and allowlist intake |
| 3 | 1, 2 | `/ask` uses indexed data and Discord command routing |
| 4 | 1, 3 | `/digest` reuses retrieval, database and job scheduling; not dependent on transcripts |
| 5 | 1, 2 | Announcer uses database/jobs and Discord message intake; independent of transcripts, `/ask` and `/digest` |
| 6 | 1–5 | Release verification |

## Coverage Summary

| # | Phase | Requirements | Success Criteria |
|---|-------|--------------|------------------|
| 1 | Foundation & GitHub Repository Indexing | INDEX-01, INDEX-03 | 8 |
| 2 | Discord Channel Indexing & Opt-Out | INDEX-02, OPTO-01 | 4 |
| 3 | /ask Q&A with Citations | ASK-01 | 5 |
| 4 | /digest Weekly Summaries | DIGE-01 | 7 |
| 5 | Automatic Meeting Announcer | MEET-02 | 12 |
| 6 | Hardening, Quality Verification & v1 Release | All active v1 | 6 |

**Total:** 6 active phases | **7 active v1 requirements** | All active v1 requirements covered ✓

**Deferred:** INDEX-04, MEET-01. **Removed from active v1:** DECI-01. **Cancelled:** PRNT-01.

---

*Last updated: 2026-11-17 — transcript upload and `/decisions` milestones removed from active v1; Automatic Meeting Announcer milestone added for L3; digest milestone owned by P3; active v1 is seven requirements across six phases*
