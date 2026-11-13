# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-12 after initialization)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records (GitHub, Discord, Miro, meetings), always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** K2 — read-only enforcement, citation layer, Miro read client

## Team
- Project Lead: Khushi
- Bot Development: Pragathi, Likhith
- UI & Showcase: Two additional members — joining after the bot is completed (status: pending)

## Technical Stack (hosted on heavencloud plan)
- Backend: TypeScript, Node.js 22, Express.js, Discord.js v14
- Database: Neon PostgreSQL (pgvector, tsvector, Drizzle ORM)
- Job Queue: pg-boss
- GitHub Integration: Read-only GitHub App via Ganju MCP + Octokit
- Miro Integration: Read-only Miro access via MCP (boards, comments, texts, diagrams)
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
| Phase 1: Foundation & GitHub & Miro Indexing | ○ Pending | INDEX-01, INDEX-03 | 0/8 |
| Phase 2: Discord Indexing & Opt-Out | ○ Pending | INDEX-02, OPTO-01 | 0/4 |
| Phase 3: Meeting Transcript & Audio Ingestion | ○ Pending | INDEX-04 | 0/4 |
| Phase 4: /ask Q&A with Citations | ○ Pending | ASK-01 | 0/4 |
| Phase 5: /decisions & PR Notifications | ○ Pending | DECI-01, PRNT-01 | 0/3 |
| Phase 6: /digest Weekly Summaries | ○ Pending | DIGE-01 | 0/3 |
| Phase 7: Meeting Summaries & Action Items | ○ Pending | MEET-01 | 0/4 |
| Phase 8: Hardening & v1 Release | ○ Pending | All | 0/5 |

## Package Status

| Package | Owner | Status | Notes |
|---------|-------|--------|-------|
| K1 | Khushi | ✅ Merged (PR #1, #2) | Scaffold, Node 22, working `npm start`, README. GitHub App not created — org role is `member`; interim read-only fine-grained PAT verified (`GET` 200 / write attempt 403). |
| K2 | Khushi | 🟡 In progress | Security contract, read-only guard, GitHub/Miro read clients, citation layer, tests. Miro live verification **pending** — no token, no MCP server, no board allowlist. |
| K3 | Khushi | ⬜ Pending | Depends on K2, P3, L3. |
| L1 | Likhith | 🟡 In progress | Neon provisioned and connected (PostgreSQL 18.7). Drizzle schema, pg-boss queue and issue-indexing code written. pg-boss hangs (under investigation) and GitHub issue indexing needs a real credential. |
| L2 | Likhith | ⬜ Pending | Depends on L1. |
| L3 | Likhith | ⬜ Pending | Depends on L2, P2. |
| P1 | Pragathi | ⬜ Not started | Depends on K1 only — unblocked. Discord contract must be approved first. |
| P2 | Pragathi | ⬜ Pending | Depends on P1, L1. |
| P3 | Pragathi | ⬜ Pending | Depends on P2, L2. |

### Credentials inventory

Values are never recorded here — only existence, owner, scope and expiry.

| Credential | Status | Owner | Scope | Expiry |
|------------|--------|-------|-------|--------|
| Discord bot token | ✅ Active | Khushi | Bot, Message Content Intent | — |
| GitHub App | ❌ Not created | — | Requires Ajiet-DevNation org owner | — |
| GitHub PAT (interim) | ✅ Active | Khushi | Fine-grained, public repos, Contents/Issues/Metadata read | 90 days |
| Neon `DATABASE_URL` | ✅ Active | Likhith | Dev database, pgvector | — |
| Miro access token | ❌ Missing | — | Board read | — |
| Cloudflare Workers AI | ❌ Not provisioned | — | Embeddings, instruct, Whisper | — |
| Cloudflare R2 | ❌ Pending decision | — | Audio storage | — |

## Discord Channel Policy

| Role | Channel | ID |
|------|---------|-----|
| Bot output + commands | `#pluto` | `1570721649538502686` |
| Indexed | `#project-stack` | `1423323863093088407` |
| Indexed | `#resources` | `1422593926367547487` |
| Indexed | `#announcements` | `1422593926367547486` |
| Excluded | `#pluto`, `#pluto-bot`, `#general` (text + media), `#off-topic`, `#assets`, `#welcome-and-rules`, `#takoyaki`, voice channels | — |
| Unresolved | `#meeting-plans` — not visible to the bot; replacement pending (candidate `#event-ideation` = `1471543039326683329`) | — |

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
- `#meeting-plans` channel — not visible to the bot; replacement not chosen — pending
- GitHub App creation — blocked on Ajiet-DevNation org owner — pending
- Miro access token, MCP server and board allowlist — pending
- Cloudflare Workers AI account/API token — no owner assigned in `PR-PLAN.md` — pending
- Discord indexing method (webhooks vs polling) — pending
- Audio storage final decision (Cloudflare R2) — pending
- Citation format — link to original source (decided)
- Opt-out scope — opt out of message indexing (decided)
- UI & showcase team members — joining after bot completion (pending)

---

*Last updated: 2026-11-13 after K2 implementation*
