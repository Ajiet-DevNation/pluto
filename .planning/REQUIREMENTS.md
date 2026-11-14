# Requirements: Pluto

**Defined:** 2026-11-12
**Core Value:** Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

All ten Pluto capabilities belong to the first official release (v1). None are deferred to v2.

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

- [ ] **INDEX-03**: Index Miro boards via MCP (read-only)
  - Acceptance Criteria:
    1. Bot connects to Miro via MCP with read-only access
    2. Miro boards, comments, texts, diagrams, and other board content are indexed and searchable
    3. No write operations are performed on Miro (read-only verified)

- [ ] **INDEX-04**: Accept uploaded meeting transcripts and audio
  - Acceptance Criteria:
    1. Users can upload meeting transcript text or audio files
    2. Audio is transcribed via Whisper
    3. Transcripts are stored and indexed alongside GitHub, Discord, and Miro content

### Q&A

- [ ] **ASK-01**: Answer questions through /ask from indexed evidence, without visible source links or citation markers in the answer (product decision 2026-11-14; source URLs remain internal evidence metadata)
  - Acceptance Criteria:
    1. /ask returns answers grounded in indexed content
    2. Each answer cites links to original sources (GitHub commit/PR URL, Discord message link, or meeting transcript)
    3. When no relevant evidence exists, /ask explicitly states so
    4. No unsupported general knowledge is used in answers

### Decisions

- [ ] **DECI-01**: Provide searchable project decisions through /decisions
  - Acceptance Criteria:
    1. Past technical/project decisions extracted from indexed sources are searchable via /decisions
    2. Each decision cites its source

### Digest

- [ ] **DIGE-01**: Generate weekly summaries through /digest
  - Acceptance Criteria:
    1. A weekly digest summarizes indexed GitHub changes, Discord discussions, and decisions
    2. Digest is delivered to Discord on a weekly schedule
    3. Digest content is drawn only from indexed sources

### PR Notifications

- [ ] **PRNT-01**: Send automatic GitHub PR notifications
  - Acceptance Criteria:
    1. New PRs in indexed Ajiet-DevNation repos trigger automatic Discord notifications
    2. Notifications include links to the PR and related repository

### Meetings

- [ ] **MEET-01**: Generate meeting summaries, extract action items with owners and due dates, and display pending tasks through /meeting actions
  - Acceptance Criteria:
    1. Meeting transcripts are summarized automatically
    2. Action items are extracted with assigned owners and due dates
    3. /meeting actions lists pending tasks with owner, due date, and source meeting
    4. Action items can be marked complete

### Opt-Out

- [ ] **OPTO-01**: Allow members to opt out of message indexing through /optout
  - Acceptance Criteria:
    1. A member who runs /optout has their messages excluded from indexing
    2. Opted-out members' content does not appear in search or answers

## v2 Requirements

(None — all capabilities are in v1)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Modifying GitHub repositories or Discord history | Pluto is strictly read-only |
| Indexing private repositories or private Discord channels | Read-only boundary; privacy |
| Generating answers from unsupported general knowledge | Answers must be based only on actual project records |
| Real-time chat | Not core to Pluto's knowledge-assistant value |
| Video posts | Storage/bandwidth costs, not in v1 scope |
| OAuth login | Email/password or Discord identity sufficient for v1 |
| Mobile app | Discord-first; web/mobile later |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INDEX-01 | Phase 1 | Pending |
| INDEX-02 | Phase 2 | Pending |
| INDEX-03 | Phase 1 | Pending |
| INDEX-04 | Phase 3 | Pending |
| ASK-01 | Phase 4 | Pending |
| DECI-01 | Phase 5 | Pending |
| PRNT-01 | Phase 5 | Pending |
| DIGE-01 | Phase 6 | Pending |
| MEET-01 | Phase 7 | Pending |
| OPTO-01 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-12*
*Last updated: 2026-11-12 after initial definition*
