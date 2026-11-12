# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-12 after initialization)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records, always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** Phase 1 — Foundation & GitHub Repository Indexing

## Team
- Project Lead: Khushi
- Bot Development: Pragathi, Likhith
- UI & Showcase: Two additional members — joining after the bot is completed (status: pending)

## Technical Stack (hosted on heavencloud plan)
- Backend: TypeScript, Node.js 22, Express.js, Discord.js v14
- Database: Neon PostgreSQL (pgvector, tsvector, Drizzle ORM)
- Job Queue: pg-boss
- GitHub Integration: Read-only GitHub App via Ganju MCP + Octokit
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
| Phase 1: Foundation & GitHub Indexing | ○ Pending | INDEX-01 | 0/6 |
| Phase 2: Discord Indexing & Opt-Out | ○ Pending | INDEX-02, OPTO-01 | 0/4 |
| Phase 3: Meeting Transcript & Audio Ingestion | ○ Pending | INDEX-03 | 0/4 |
| Phase 4: /ask Q&A with Citations | ○ Pending | ASK-01 | 0/4 |
| Phase 5: /decisions & PR Notifications | ○ Pending | DECI-01, PRNT-01 | 0/3 |
| Phase 6: /digest Weekly Summaries | ○ Pending | DIGE-01 | 0/3 |
| Phase 7: Meeting Summaries & Action Items | ○ Pending | MEET-01 | 0/4 |
| Phase 8: Hardening & v1 Release | ○ Pending | All | 0/5 |

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
- Discord indexing method (webhooks vs polling) — pending
- Audio storage final decision (Cloudflare R2) — pending
- Citation format — link to original source (decided)
- Opt-out scope — opt out of message indexing (decided)
- UI & showcase team members — joining after bot completion (pending)

---

*Last updated: 2026-11-12 after initialization*
