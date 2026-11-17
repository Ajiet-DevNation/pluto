# Requirements: Pluto

**Defined:** 2026-11-12
**Revised:** 2026-11-17
**Core Value:** Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

Seven Pluto capabilities belong to the first official release (v1). The 2026-11-17 revision removed the `/decisions` command from active v1, deferred the transcript-based meeting pipeline (upload, transcription, summaries, action items, `/meeting actions`), and added the Automatic Meeting Announcer (MEET-02). Automatic PR notifications (PRNT-01) were cancelled on 2026-11-15. Deferred and cancelled capabilities are listed below; none are deleted from the repository.

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

### Q&A

- [ ] **ASK-01**: Answer questions through /ask from indexed evidence, display one best supporting source, and keep citation markers out of the answer text (product decision 2026-11-16, superseding the 2026-11-14 answer-only decision)
  - Acceptance Criteria:
    1. /ask returns answers grounded in indexed content
    2. Source URLs are retained as internal evidence metadata; the reply displays one best supporting source by default (exact PR/issue for direct questions, README/docs for general questions, one per repository when needed for comparisons)
    3. When no relevant evidence exists, /ask explicitly states so
    4. No unsupported general knowledge is used in answers
    5. Contributor questions use the on-demand read-only GitHub contributors API, report anonymous contributions honestly, and never guess names from commits or PRs
    6. Internal prompt instructions never appear in the answer text
  - 2026-11-16 status: retrieval and grounding fixes implemented and locally validated. Verified eval gate 9/9; full-corpus reindex and live Discord acceptance still pending, so the requirement is not marked complete.

### Digest

- [ ] **DIGE-01**: Generate weekly summaries through /digest
  - Acceptance Criteria:
    1. `/digest` can be invoked through the agreed guild-scoped Discord command
    2. The digest summarizes the intended weekly period
    3. Relevant indexed GitHub activity and Discord discussions are included
    4. Relevant messages from the indexed `#decisions` channel remain available as source evidence
    5. Digest content is drawn only from indexed records; no decisions, updates, project progress or contributors are invented
    6. An empty period produces a sensible response rather than fabricated activity
    7. Delivery scheduling is persistent and does not create duplicate digests
    8. Existing Discord privacy, opt-out and bot-author restrictions are preserved
    9. Existing commands and bot behavior remain unaffected
    10. Tests and build pass

### Meetings

- [ ] **MEET-02**: Build the complete Automatic Meeting Announcer
  - Scope: Monitor only the configured `#meeting-plans` channel, detect human-authored meeting announcements that use an actual Discord `@everyone` or `@here` mention, parse the date/time deterministically in `Asia/Kolkata`, confirm ambiguous details with the announcer, persist confirmed events, and deliver one durable reminder to `#pluto` one hour before the meeting.
  - The `#meeting-plans` and `#pluto` channel IDs come from `.planning/config.json`, never a hardcoded constant.
  - Announcement detection is independent of the ordinary Discord indexing pipeline. `#decisions` and the other indexed channels keep their existing intake rules.
  - No new slash command is introduced for meetings.
  - Acceptance Criteria:
    1. Meeting announcements are detected only in `#meeting-plans`
    2. Actual `@everyone` and `@here` mentions are checked correctly through Discord mention metadata
    3. Bot-authored and unrelated messages are ignored; meeting-related language is required in addition to the mention
    4. Supported date/time expressions are parsed correctly (for example "tomorrow at 4 PM", "Friday at 10:30 AM", "18 November at 3 PM"); a bare-hour expression such as "today at 5" is recognised and its AM/PM ambiguity is clarified rather than guessed
    5. Ambiguous or missing date/time information requires clarification; the parser never silently guesses
    6. Confirmation is required before scheduling
    7. Confirmed meetings are persisted in `meeting_events` with a unique source announcement identity
    8. Reminder jobs are durable across restarts using pg-boss
    9. One-hour reminders are delivered to `#pluto` without repeating `@everyone` or `@here`
    10. Cancellation invalidates scheduled reminders
    11. Rescheduling invalidates the previous schedule and creates a new one
    12. Duplicate event creation and concurrent delivery are controlled
    13. Failures are logged safely and recovered where possible; the delivery guarantee is documented honestly
    14. Existing `/ask` and `/optout` behavior remains unaffected
    15. Unit and integration tests pass

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
| DECI-01 | Searchable project decisions through `/decisions` | Removed from active v1 2026-11-17 | Decisions remain useful as indexed evidence; a dedicated command is not in the focused v1 | `#decisions` stays in the allowlist and is used by `/ask` and `/digest` |
| PRNT-01 | Automatic GitHub PR notifications | Cancelled 2026-11-15 | Takoyaki already posts PR notices | PRs remain indexed for `/ask` and `/digest` |
| — | Voice-channel recording, automatic user-facing Whisper transcription, `/meetings`, `/meeting upload` | Not active v1 | Out of the focused announcer/digest scope | No implementation is required |

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
| ASK-01 | Phase 3 | Partial — retrieval/grounding fixes done; full-corpus live validation pending |
| DIGE-01 | Phase 4 | Pending — P3 |
| MEET-02 | Phase 5 | Pending — L3 |
| OPTO-01 | Phase 2 | Complete — P1 merged and live-verified (PR #9) |
| INDEX-04 | — | Deferred (2026-11-17) |
| MEET-01 | — | Deferred (2026-11-17) |
| DECI-01 | — | Removed from active v1 (2026-11-17) |
| PRNT-01 | — | Cancelled (2026-11-15) |

**Coverage:**
- Active v1 requirements: **7**
- Mapped to active phases: **7**
- Unmapped: **0** ✓
- Deferred: INDEX-04, MEET-01
- Removed from active v1: DECI-01
- Cancelled: PRNT-01

---

*Requirements defined: 2026-11-12*
*Last updated: 2026-11-17 — active v1 reduced to seven requirements; MEET-02 (Automatic Meeting Announcer) added; INDEX-04, MEET-01 and DECI-01 deferred/removed from active scope*
