# Roadmap: Pluto

All ten v1 capabilities are covered across eight phases. Each phase uses vertical MVP-style delivery — independently testable, end-to-end user value per phase — with **Mode: mvp** set on every phase.

## Phase 1: Foundation & GitHub Repository Indexing
**Goal:** Set up the Pluto backend scaffold and index the first public Ajiet-DevNation GitHub repository (read-only).
**Mode:** mvp
**Success Criteria:**
1. TypeScript/Express/Discord.js backend scaffold runs on heavencloud plan (Node 22)
2. Neon Postgres (pgvector, tsvector, Drizzle) database is provisioned and connected
3. pg-boss job queue is configured for background indexing jobs
4. Read-only GitHub App via Ganju MCP + Octokit can access Ajiet-DevNation public repos
5. Read-only Miro access via MCP can access boards, comments, texts, diagrams, and other board content
6. First public repository's commits, PRs, and issues are indexed and searchable
7. Miro board content is indexed and searchable alongside GitHub content
8. No write operations are performed on GitHub or Miro (read-only verified)
**Requirements:** INDEX-01, INDEX-03

## Phase 2: Discord Channel Indexing & Opt-Out
**Goal:** Connect Discord, index selected channels, and implement /optout.
**Mode:** mvp
**Success Criteria:**
1. Discord bot (discord.js v14) connects and joins the DevNation server
2. Admin-selected Discord channels are indexed; non-selected channels are not
3. /optout excludes a member's messages from indexing
4. Opted-out members' content does not appear in search or answers
**Requirements:** INDEX-02, OPTO-01

## Phase 3: Meeting Transcript & Audio Ingestion
**Goal:** Accept uploaded meeting transcripts and audio for indexing.
**Mode:** mvp
**Success Criteria:**
1. Users can upload meeting transcript text or audio files
2. Audio is transcribed via Cloudflare Workers AI Whisper
3. Transcripts are stored (Cloudflare R2 temporary, pending) and indexed in Neon
4. Meeting content is searchable alongside GitHub and Discord content
**Requirements:** INDEX-03

## Phase 4: /ask Q&A with Citations
**Goal:** Answer questions through /ask with citations to original sources.
**Mode:** mvp
**Success Criteria:**
1. /ask returns answers grounded in indexed content
2. Each answer cites links to original sources (GitHub commit/PR URL, Discord message link, meeting transcript)
3. When no relevant evidence exists, /ask explicitly states so
4. No unsupported general knowledge is used in answers
**Requirements:** ASK-01

## Phase 5: /decisions & GitHub PR Notifications
**Goal:** Provide searchable project decisions and automatic PR notifications.
**Mode:** mvp
**Success Criteria:**
1. /decisions returns searchable past technical/project decisions with source citations
2. New PRs in indexed Ajiet-DevNation repos trigger automatic Discord notifications
3. PR notifications include links to the PR and related repo
**Requirements:** DECI-01, PRNT-01

## Phase 6: /digest Weekly Summaries
**Goal:** Generate and deliver weekly summaries of community activity.
**Mode:** mvp
**Success Criteria:**
1. A weekly digest summarizes indexed GitHub changes, Discord discussions, and decisions
2. Digest is delivered to Discord on a weekly schedule
3. Digest content is drawn only from indexed sources (no unsupported knowledge)
**Requirements:** DIGE-01

## Phase 7: Meeting Summaries & Action Items
**Goal:** Summarize meetings, extract action items, and display pending tasks.
**Mode:** mvp
**Success Criteria:**
1. Meeting transcripts are summarized automatically
2. Action items are extracted with assigned owners and due dates
3. /meeting actions lists pending tasks with owner, due date, and source meeting
4. Action items can be marked complete
**Requirements:** MEET-01

## Phase 8: Hardening, Quality Verification & v1 Release
**Goal:** Verify all ten capabilities, enforce the read-only boundary, and release v1.
**Mode:** mvp
**Success Criteria:**
1. All ten v1 requirements are implemented and tested
2. Read-only boundary verified: no GitHub writes, no Discord history edits, no private indexing, no unsupported answers
3. Citations consistently link to original sources
4. All acceptance criteria across phases pass verification
5. v1 release deployed to heavencloud plan
**Requirements:** All (INDEX-01..03, ASK-01, DECI-01, DIGE-01, PRNT-01, MEET-01, OPTO-01)

## Coverage Summary

| # | Phase | Requirements | Success Criteria |
|---|-------|--------------|------------------|
| 1 | Foundation & GitHub Repository Indexing & Miro MCP Indexing | INDEX-01, INDEX-03 | 8 |
| 2 | Discord Channel Indexing & Opt-Out | INDEX-02, OPTO-01 | 4 |
| 3 | Meeting Transcript & Audio Ingestion | INDEX-03 | 4 |
| 4 | /ask Q&A with Citations | ASK-01 | 4 |
| 5 | /decisions & GitHub PR Notifications | DECI-01, PRNT-01 | 3 |
| 6 | /digest Weekly Summaries | DIGE-01 | 3 |
| 7 | Meeting Summaries & Action Items | MEET-01 | 4 |
| 8 | Hardening, Quality Verification & v1 Release | All | 5 |

**Total:** 8 phases | 10 requirements | All v1 requirements covered ✓
