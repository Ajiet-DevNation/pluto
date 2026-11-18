# Requirements: Pluto

**Defined:** 2026-11-12
**Revised:** 2026-11-18
**Core Value:** Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

Six Pluto capabilities belong to the first official release (v1). The 2026-11-18 revision removed the `/ask` command, answer runtime, retrieval modules and ask-specific tests from active v1 because the live answer path is not working reliably; the chunk schema and indexing pipeline are retained for `/digest` and corpus storage. The 2026-11-17 revision removed the `/decisions` command from active v1, deferred the transcript-based meeting pipeline (upload, transcription, summaries, action items, `/meeting actions`), and added the Automatic Meeting Announcer (MEET-02). Automatic PR notifications (PRNT-01) were cancelled on 2026-11-15. Deferred and removed capabilities are listed below.

## v1 Requirements

### Indexing

- [ ] **INDEX-01**: Index public GitHub repositories belonging to Ajiet-DevNation (read-only)
  - Acceptance Criteria:
    1. Bot connects to Ajiet-DevNation GitHub org via a read-only GitHub App
    2. Public repo READMEs, issues, pull requests, commit messages, contributors, and eligible text/source files are indexed and searchable
    3. No write operations are performed on GitHub (read-only verified)

- [ ] **INDEX-02**: Index selected Discord channels
  - Acceptance Criteria:
    1. An admin can select which Discord channels to index
    2. Messages from selected channels are indexed
    3. Messages from non-selected channels are not indexed
    4. The allowlist remains exactly five channels, including `#decisions`; `#pluto` is never indexed

- [ ] **INDEX-03**: Index Miro boards via REST v2 (read-only)
  - Acceptance Criteria:
    1. Bot connects to Miro via REST v2 with `boards:read` and issues GET requests only
    2. Typed board content (such as text boxes, cards, and frame titles) and connectors are indexed and searchable; hand-drawn ink is not treated as text because Miro does not convert handwriting to text
    3. No write operations are performed on Miro, and only approved public/shared boards are indexed

### Q&A (removed from active v1)

- [ ] **ASK-01**: Answer questions through /ask from indexed evidence, display one best supporting source, and keep citation markers out of the answer text (product decision 2026-11-16, superseding the 2026-11-14 answer-only decision)
  - Acceptance Criteria:
    1. /ask returns answers grounded in indexed content
    2. Source URLs are retained as internal evidence metadata; the reply displays one best supporting source by default (exact PR/issue for direct questions, README/docs for general questions, one per repository when needed for comparisons)
    3. When no relevant evidence exists, /ask explicitly states so
    4. No unsupported general knowledge is used in answers
    5. Contributor questions use the on-demand read-only GitHub contributors API, report anonymous contributions honestly, and never guess names from commits or PRs
    6. Internal prompt instructions never appear in the answer text
  - 2026-11-18 status: **removed from active v1.** The `/ask` command, handler, answer runtime, retrieval modules, evaluation scripts and ask-specific tests are removed because the live answer path is not working reliably. The chunk schema and embedding/indexing pipeline are retained for `/digest` and corpus storage. `#decisions` remains indexed evidence for `/digest`.

### Project Activity & Events

- [ ] **DIGE-01**: Provide on-demand project activity snapshots and event awareness through `/digest`, `/upcoming`, and `/event add`
  - Scope: `/digest` is an on-demand deterministic activity snapshot, not a scheduled AI-written summary. `/upcoming meetings` lists confirmed future meetings; `/upcoming events` lists manually added future events; `/event add` stores a manual event and posts a public record in the configured `#events` channel; `/event cancel` marks an event cancelled and posts a public notice. `/help` lists the available commands. No `/resource`, no `/upcoming all`, no channel scanning, no manual-event reminders, and no recurring events.
  - Acceptance Criteria:
    1. `/digest days:N` is guild-scoped; `N` is 1–30 and defaults to 7.
    2. The digest reports counts drawn only from indexed records: GitHub issues, Discord messages, `#decisions` messages, and upcoming meetings/events.
    3. The digest does not claim PR or commit activity until reliable occurrence dates are stored.
    4. An empty period produces a sensible response; no activity is fabricated.
    5. `/upcoming meetings` lists confirmed future meetings from `meeting_events`.
    6. `/upcoming events` lists scheduled future or ongoing manual events from the `events` table.
    7. `/event add` is available to every member, uses strict `YYYY-MM-DD` and either 12-hour `h:MM AM/PM` or 24-hour `HH:MM` time input in `Asia/Kolkata`, displays times in 12-hour IST, saves the event, sends an ephemeral confirmation, and posts a public record in `#events`.
    8. `/help` lists the available guild-scoped commands and examples.
    9. No `/resource`, `/upcoming all`, weekly digest scheduler, channel scanning, recurring events, or manual-event reminders in this scope.
    10. Opt-out, privacy, bot-author, and existing-command behavior remain unchanged.
    11. Tests and build pass.
    12. `/event cancel` is available to every member; creators can cancel their own events, and Manage Events can cancel any event. Cancellation marks the row cancelled, posts one public cancellation notice, never edits or deletes the original `#events` record, and is idempotent.
  - 2026-11-18 status: **complete** — deterministic digest, upcoming meetings/events, every-member manual events with cancellation, public activity replies, 12-hour input/display, and help are implemented, tested and live-verified. 318 tests pass, build is clean, and `0009_events` is recorded in the dev database. Guild command registration is verified; `/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`, public replies, and 12-hour display passed live acceptance. The 12-hour input/display change, every-member `/event add`, public replies, and `/event cancel` were approved by Khushi on 2026-11-18. The P3 PR (#18) is open for Khushi review/merge; DIGE-01 is not marked merged until that completes. ASK-01 and the `/ask` command are removed from active v1 on 2026-11-18; the retrieval engine is retained for future.

### Meetings

- [ ] **MEET-02**: Build the Automatic Meeting Announcer (MVP)
  - Scope: Monitor only the configured `#meeting-plans` channel, detect human-authored meeting announcements that use an actual Discord `@everyone` or `@here` mention, parse the date/time deterministically in `Asia/Kolkata`, auto-schedule one durable reminder to `#pluto` one hour before the meeting when a valid future date/time is confidently parsed. No confirmation, cancel, or reschedule controls.
  - The `#meeting-plans` and `#pluto` channel IDs come from `.planning/config.json`, never a hardcoded constant.
  - Announcement detection is independent of the ordinary Discord indexing pipeline. `#decisions` and the other indexed channels keep their existing intake rules.
  - No new slash command is introduced for meetings.
  - Acceptance Criteria:
    1. Meeting announcements are detected only in `#meeting-plans`
    2. Actual `@everyone` and `@here` mentions are checked correctly through Discord mention metadata
    3. Bot-authored and unrelated messages are ignored; meeting-related language is required in addition to the mention
    4. Supported date/time expressions are parsed correctly (for example "tomorrow at 4 PM", "Friday at 10:30 AM", "18 November at 3 PM"); a bare-hour expression such as "today at 5" is recognised and its AM/PM ambiguity is clarified rather than guessed
    5. Ambiguous or missing date/time information requires clarification; the parser never silently guesses
    6. No confirmation required — valid future events are auto-scheduled; invalid/ambiguous/past input gets a simple explanatory reply
    7. Confirmed meetings are persisted in `meeting_events` with a unique source announcement identity
    8. Reminder jobs are durable across restarts using pg-boss
    9. One-hour reminders are delivered to `#pluto` without repeating `@everyone` or `@here`
    10. Duplicate event creation and concurrent delivery are controlled
    11. Failures are logged safely and recovered where possible; the delivery guarantee is documented honestly
    12. Existing `/optout` and Discord indexing behavior remains unaffected
    13. Unit and integration tests pass

### Opt-Out

- [ ] **OPTO-01**: Allow members to opt out of message indexing through /optout
  - Acceptance Criteria:
    1. A member who runs /optout has their messages excluded from indexing
    2. Opted-out members' content does not appear in search or answers

## v2 Requirements

(None — deferred v1 capabilities may be reconsidered post-v1 but are not committed to v2.)

## Deferred from v1 (retained in repository, not active)

| ID | Feature | Status | Reason | Preserved |
|----|---------|--------|--------|-----------|
| INDEX-04 | Accept uploaded meeting transcripts and audio | Deferred 2026-11-17 | The announcer does not need uploads; v1 avoids a new user-facing transcription workflow | L2 code, `meeting_transcripts` table and existing transcript chunks remain |
| MEET-01 | Transcript-derived meeting summaries, action items with owners/due dates, `/meeting actions` | Deferred 2026-11-17 | Depends on deferred transcript uploads | No active assignment; old acceptance criteria are historical only |
| ASK-01 | `/ask` grounded Q&A with citations | Removed from active v1 2026-11-18 | Live answer path is not working reliably; command and answer/retrieval engine removed | Chunk schema and embedding/indexing pipeline retained for `/digest` and corpus storage |
| DECI-01 | Searchable project decisions through `/decisions` | Removed from active v1 2026-11-17 | Decisions remain useful as indexed evidence; a dedicated command is not in the focused v1 | `#decisions` stays in the allowlist and is used by `/digest` |
| PRNT-01 | Automatic GitHub PR notifications | Cancelled 2026-11-15 | Takoyaki already posts PR notices | PRs remain indexed for `/digest` and a future `/ask` |
| — | Voice-channel recording, automatic user-facing Whisper transcription, `/meetings`, `/meeting upload` | Not active v1 | Out of the focused announcer/activity scope | No implementation is required |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Modifying GitHub repositories, Discord history or Miro boards | Pluto is strictly read-only |
| Indexing private repositories or private Discord channels | Read-only boundary; privacy |
| Indexing or recording voice channels | Not required for the announcer; privacy and infrastructure risk |
| Generating answers from unsupported general knowledge | Answers must be based only on actual project records |
| Real-time chat | Not core to Pluto's knowledge-assistant value |
| Video posts | Storage/bandwidth costs, not in v1 scope |
| OAuth login | Email/password or Discord identity sufficient for v1 |
| Mobile app | Discord-first; web/mobile later |
| Automatic GitHub PR notifications (PRNT-01) | Cancelled 2026-11-15. The Takoyaki bot already posts PR notices in the server, so Pluto would duplicate them |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INDEX-01 | Phase 1 | Partial — GitHub code in place; App auth live verification and full reindex pending |
| INDEX-02 | Phase 2 | Complete — P1 merged and live-verified (PR #9) |
| INDEX-03 | Phase 1 | Partial — read-only client implemented; Miro token and live verification pending |
| ASK-01 | Phase 3 | Removed from active v1 (2026-11-18) — `/ask` command and answer/retrieval engine removed; chunk schema/indexing retained |
| DIGE-01 | Phase 4 | ✅ Complete (implementation, tests and live acceptance; PR #18 open for Khushi review/merge) |
| MEET-02 | Phase 5 | Pending — L3 |
| OPTO-01 | Phase 2 | Complete — P1 merged and live-verified (PR #9) |
| INDEX-04 | — | Deferred (2026-11-17) |
| MEET-01 | — | Deferred (2026-11-17) |
| DECI-01 | — | Removed from active v1 (2026-11-17) |
| PRNT-01 | — | Cancelled (2026-11-15) |

**Coverage:**
- Active v1 requirements: **6**
- Mapped to active phases: **6**
- Unmapped: **0** ✓
- Deferred: INDEX-04, MEET-01
- Removed from active v1: ASK-01, DECI-01
- Cancelled: PRNT-01

---

*Requirements defined: 2026-11-12*
*Last updated: 2026-11-18 — DIGE-01 is complete: on-demand activity/event awareness (`/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`) is implemented, tested and live-verified; 318 tests pass, build is clean, and `0009_events` is recorded. The P3 PR (#18) is open for Khushi review/merge, so DIGE-01 is not marked merged until that completes. ASK-01 and its `/ask` command/engine are removed from active v1 on 2026-11-18; the chunk schema/indexing pipeline is retained. Active v1 is six requirements.*
