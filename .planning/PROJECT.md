# Pluto

## What This Is

Pluto is a read-only Discord knowledge assistant for the DevNation developer community at AJIET. It connects information from public GitHub repositories, selected Discord channels, and meeting transcripts into one searchable place accessible through Discord. Members can ask questions and receive answers with source citations, track important decisions, receive automatic PR notifications and weekly digests, and convert meeting discussions into summaries and action items with owners and due dates.

## Core Value

Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Index public GitHub repositories belonging to Ajiet-DevNation (read-only)
- [ ] Index selected Discord channels
- [ ] Accept uploaded meeting transcripts and audio
- [ ] `/ask` — answer questions with citations to original sources
- [ ] `/decisions` — searchable project decisions
- [ ] `/digest` — weekly summaries
- [ ] Automatic GitHub PR notifications
- [ ] Generate meeting summaries and extract action items with owners and due dates
- [ ] `/meeting actions` — display pending meeting tasks
- [ ] `/optout` — allow members to opt out of message indexing

### Out of Scope

- Modifying GitHub repositories or Discord history — Pluto is strictly read-only
- Indexing private repositories or private Discord channels
- Generating answers from unsupported general knowledge (if no relevant evidence exists, Pluto must explicitly say so)
- Real-time chat, video posts, OAuth login, mobile app — not core to Pluto's knowledge-assistant value
- Writing to Discord history (editing/deleting messages); posting new bot messages (answers, notifications, digests) is permitted

## Context

- Community: DevNation developer community at AJIET
- Information is currently scattered across GitHub repositories, Discord discussions, pull requests, and team meetings
- Developers waste time searching across platforms to understand previous decisions, project updates, code changes, and pending tasks
- Technical stack decisions already made (see Constraints)

## Constraints

- **[Tech stack]**: TypeScript, Node.js 22, Express.js, Discord.js v14 hosted on heavencloud plan — backend language/runtime fixed
- **[Database]**: Neon PostgreSQL with pgvector and tsvector, Drizzle ORM — vector + full-text search required
- **[Job queue]**: pg-boss — background jobs for indexing and digests
- **[GitHub integration]**: Read-only GitHub App via Ganju MCP endpoint and Octokit — no write access to GitHub
- **[AI & embeddings]**: Cloudflare Workers AI (bge-base-en-v1.5 embeddings, instruct model, Whisper transcription) — AI provider fixed
- **[Audio storage]**: Cloudflare R2 (temporary, under consideration) — audio storage pending final decision
- **[Read-only]**: No writes to GitHub repos or Discord history; no private repo/channel indexing; no unsupported general knowledge — hard compliance boundary
- **[Timeline]**: Prioritize quality over the original end-of-week target; all nine capabilities must ship in v1

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| All nine capabilities in v1 | User requirement — no features excluded from first release | — Pending |
| Prioritize quality, extend timeline | Avoid sacrificing correctness for an aggressive deadline | — Pending |
| Read-only with new-message posting permitted | Protects source data integrity while allowing bot to respond in Discord | — Pending |
| Opt-out = exclude messages from indexing | Respects member privacy without over-engineering granular controls | — Pending |
| Citations link to original source | Verifiability — users can jump to GitHub commit/PR, Discord message, or meeting transcript | — Pending |
| TypeScript + Node.js 22 + discord.js v14 | Existing team stack decision (per provided stack table) | — Pending |
| Neon Postgres + pgvector + tsvector + Drizzle | Vector + full-text search for knowledge retrieval | — Pending |
| Cloudflare Workers AI + Whisper + R2 | AI embeddings, transcription, and temporary audio storage | — Pending |

---

*Last updated: 2026-11-12 after initialization*

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
