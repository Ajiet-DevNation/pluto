# Pluto — PR Plan Per Person (Final Team Collaboration & Integration Workflow)

Git workflow and branch strategy for the Pluto v1 release. All ten capabilities ship in v1. Hosting is heavencloud plan. Each person has exactly one feature branch and at least three work packages (PRs). Packages may merge separately or as one PR once the set is complete; a defect found after merge is fixed in a small follow-up PR on the same branch. Unresolved items are marked pending; nothing is assumed decided.

## Team and Branch Ownership

| Person | Role | Branch | Responsible For |
|--------|------|--------|-----------------|
| Khushi | Project Lead | `feat/khushi` | K1, K2, K3 (includes Miro MCP read-only access) |
| Pragathi | Bot Development | `feat/pragathi` | P1, P2, P3 |
| Likhith | Bot Development | `feat/likhith` | L1, L2, L3 |
| UI Member 1 | UI & Showcase | TBD (joins after bot complete) | — |
| UI Member 2 | UI & Showcase | TBD (joins after bot complete) | — |

**Rule:** Each person maintains their own feature branch and completes their assigned work packages on that branch. Work packages may be opened as separate PRs targeting `main`, or as one PR once the set is complete and verified. A defect discovered after a package merges is fixed in a small follow-up PR on the same branch — it does not reopen the merged package.

---

## PR Rules (Approval and Merging)

1. **No direct pushes or unapproved merges into `main`.**
2. **Khushi** is the project lead and has final approval authority over all three PRs (K, P, L).
3. The branch owner must review and address all feedback from Khushi before approval.
4. Only after Khushi approves can the branch owner merge their own PR into `main`.
   - Khushi does **not** merge everyone else's PRs. The respective branch owner performs the merge after approval.
5. Each person must sync their feature branch with the latest `main` and run relevant tests before merging.
6. Each PR must include an update to `STATE.md` reflecting phase progress and completed requirements.
7. PRs are not mergeable until `STATE.md` is updated and acceptance criteria are verified.

---

## Khushi — Project Lead (`feat/khushi`)

| PR | Content | Files | Acceptance | Depends on | Target hour |
|----|---------|-------|------------|------------|-------------|
| K1 | Initialize TypeScript/Express backend scaffold; configure Node.js 22 runtime; establish read-only GitHub access | `src/cmd/pluto/**`, `tsconfig.json`, `.nvmrc`, `scripts/build.sh`, `src/github/app.ts` | Backend builds and runs locally; Node.js 22 pinned; read-only GitHub credential verified (`GET` 200, write attempt 403) | — | 5 |
| K2 | Enforce the read-only boundary in code: guard the GitHub and Miro clients, prove no write operation is reachable, build the citation layer, verify Miro read access | `src/guardrails/**`, `src/citations/**`, `src/github/**`, `src/miro/**`, `tests/**`, `.planning/contracts/security.md` | Write operations impossible by guard and by credential; static scan finds no write verbs in client modules; citation URLs correct and self-citation blocked; Miro live verification pending (no token) | K1 | 7 |
| K3 | v1 release hardening; full acceptance verification across all ten requirements; deploy v1 release to heavencloud plan | `.planning/**`, `scripts/deploy.sh`, `scripts/test-all.sh` | All ten v1 requirements implemented and tested; read-only boundary verified; citations consistently link to original sources; v1 deployed to heavencloud plan | K2, P3, L3 | 8 |

**Cross-cutting responsibilities (Khushi):**
- Owns overall architecture, integration, shared interfaces, Miro MCP setup, and final technical decisions
- Reviews and approves all three PRs (K, P, L) before merge
- Resolves disagreements on shared contracts
- Approves changes to shared contracts
- Updates `STATE.md` at phase transitions
- Maintains `.planning/` source of truth
- Handles release tagging

---

## Pragathi — Bot Development (`feat/pragathi`)

| PR | Content | Files | Acceptance | Depends on | Target hour |
|----|---------|-------|------------|------------|-------------|
| P1 | Connect Discord bot via discord.js v14; join DevNation server; index selected Discord channels; implement /optout command to exclude member messages from indexing | `src/cmd/pluto/**`, `src/discord/**`, `src/optout/**`, `tests/discord/` | Discord bot connected and joined; admin-selected channels indexed; non-selected channels excluded; opted-out members' messages excluded from search and answers | K1 | 5 |
| P2 | Implement /ask Q&A; index all public-org GitHub READMEs, issues, PRs, commits, and eligible text/source files; ground answers in indexed content | `src/cmd/pluto/**`, `src/ask/**`, `src/search/**`, `tests/ask/`, `tests/search/` | `/ask` answers from indexed sources with original citations; all public Ajiet-DevNation repositories and API pages are included; private repositories and excluded/sensitive files remain out; missing GitHub credentials fail reindex visibly; no-evidence response is explicit | P1, L1 | 7 |
| P3 | Generate /digest weekly summaries; generate meeting summaries; extract action items with owners and due dates; implement /meeting actions command with mark-complete | `src/cmd/pluto/**`, `src/digest/**`, `src/meetings/**`, `tests/digest/**, tests/meetings/` | Weekly digest summarizes indexed GitHub/Discord/decisions and delivers to Discord; meeting transcripts summarized; action items extracted with owners and due dates; /meeting actions lists pending tasks; action items can be marked complete | P2, L2 | 6 |

**Contract ownership (Pragathi):**
- Proposes and implements Discord and bot-command contracts
- Reviews shared interfaces before dependent implementation begins

---

## Likhith — Bot Development (`feat/likhith`)

| PR | Content | Files | Acceptance | Depends on | Target hour |
|----|---------|-------|------------|------------|-------------|
| L1 | Provision Neon Postgres with pgvector and tsvector; connect via Drizzle ORM; configure pg-boss job queue; index GitHub issues from Ajiet-DevNation public repos | `src/db/**`, `src/jobs/**`, `scripts/migrate/**`, `tests/db/` | Neon Postgres provisioned and connected; pg-boss configured for background indexing jobs; GitHub issues indexed and searchable | K1 | 5 |
| L2 | Build audio file upload endpoint; transcribe via Cloudflare Workers AI Whisper; store transcripts in Neon (transcript-only, no R2); index meeting transcript content in Neon | `src/upload/**`, `src/transcription/**`, `src/db/**`, `src/jobs/**`, `tests/upload/**, tests/transcription/` | Users can upload meeting transcripts and audio; audio transcribed via Whisper; transcripts stored and indexed in Neon alongside GitHub and Discord content | L1 | 6 |
| L3 | Implement /decisions searchable project decisions; send automatic GitHub PR notifications; extract action items with owners and due dates; verify no Discord history edits; verify no private repo/channel indexing | `src/cmd/pluto/**`, `src/decisions/**`, `src/notifications/**`, `src/actions/**`, `tests/decisions/**, tests/notifications/` | /decisions returns searchable decisions with source citations; new PRs trigger Discord notifications with PR and repo links; action items have owners and due dates; no Discord history edits; no private indexing | L2, P2 | 7 |

**Contract ownership (Likhith):**
- Proposes and implements database and job-queue contracts
- Reviews shared interfaces before dependent implementation begins

---

## UI & Showcase Members (2)

**Status:** Joining after the bot is completed (after K3, P3, L3). No v1 PRs assigned yet.

**Branches:** None assigned for v1. Upon joining, each member will receive:
- `ui-member-1/phase4-ui-showcase` — TBD
- `ui-member-2/phase4-ui-showcase` — TBD

**PR targets:** To be determined when they join.

---

## Shared Technical Contracts (Document Before Implementation)

The following contracts must be documented and agreed by all three bot members before dependent implementation begins. Khushi owns final technical decisions and resolves disagreements.

| # | Contract | Owner | Must Include | Status |
|---|----------|-------|--------------|--------|
| 1 | Database schema | Likhith proposes; Khushi approves | Tables, columns, relationships, indexes, migrations, naming conventions | Pending validation |
| 2 | API contracts | Khushi owns | Endpoints, request/response formats, validation, errors | Pending validation |
| 3 | Discord contracts | Pragathi proposes; Khushi approves | Bot command interfaces, channel configuration, permissions | Pending validation |
| 4 | GitHub contracts | Khushi owns | GitHub App access, webhook/event payloads, repository allowlist | Drafted in `contracts/github.md`; review pending |
| 5 | Miro MCP contracts | Khushi proposes; Khushi approves | Miro MCP server connection, board allowlist, read-only enforcement, board/comment/text/diagram access | Pending validation |
| 6 | Search contracts | Khushi owns | Document/chunk formats, embedding dimensions, retrieval, citation references | Approved; GitHub corpus scope updated for P2 |
| 7 | Background jobs | Likhith proposes; Khushi approves | Job names, payloads, retries, idempotency, scheduling | Approved (`contracts/background-jobs.md`) |
| 8 | Meeting contracts | Pragathi proposes; Khushi approves | Upload, transcription, summary, action-item formats | Pending validation |
| 9 | Security contracts | Khushi owns | Read-only boundaries, visibility enforcement, opt-out behavior | Active/approved for K2 (`contracts/security.md`) |

**Contract review rule:** All three must review shared interfaces before dependent implementation begins. Khushi resolves disagreements and approves changes to shared contracts.

---

## Dependency and Integration Sequence

### Phase A — Before Any Coding (Contracts First)
All shared contracts (1–8 above) must be drafted and reviewed by all three members before anyone begins dependent implementation. Khushi approves final versions.

Prerequisite order:
1. Database schema (Likhith proposes, Khushi approves) — must be done before L1, P2, L2 depend on it
2. API contracts (Khushi owns) — must be done before K1, P1, L1 build against them
3. Discord contracts (Pragathi proposes, Khushi approves) — must be done before P1
4. GitHub contracts (Khushi owns) — must be done before K1
5. Miro MCP contracts (Khushi proposes, Khushi approves) — must be done before K1
6. Search contracts (Khushi owns) — must be done before P2, L2
7. Background jobs (Likhith proposes, Khushi approves) — must be done before L1, P3
8. Meeting contracts (Pragathi proposes, Khushi approves) — must be done before L2, P3
9. Security contracts (Khushi owns) — must be done before K2, all PRs

### Phase B — Implementation Order with Dependencies

| Step | PR | Owner | Depends On | Integration Checkpoint |
|------|-----|-------|------------|----------------------|
| 1 | K1 | Khushi | GitHub contract, API contract, DB schema | Backend scaffold builds locally; Node.js 22 pinned; read-only GitHub credential verified |
| 2 | L1 | Likhith | K1, DB schema, background jobs contract | Neon + pg-boss connected; issues indexed |
| 3 | P1 | Pragathi | K1, Discord contract | Discord bot joined; /optout working |
| 4 | L2 | Likhith | L1, meeting contract, search contract | Audio uploaded, transcribed, indexed in Neon |
| 5 | P2 | Pragathi | P1, L1, search contract | /ask returns cited answers |
| 6 | L3 | Likhith | L2, P2 | /decisions searchable; PR notifications sent |
| 7 | P3 | Pragathi | P2, L2 | /digest delivered; /meeting actions working |
| 8 | K2 | Khushi | K1 | Read-only boundary enforced; guard rails verified |
| 9 | K3 | Khushi | K2, P3, L3 | All ten capabilities tested; v1 deployed to heavencloud plan |

### Phase C — Integration Checkpoints (Catch Incompatible Implementations Early)

| Checkpoint | When | Participants | What Is Verified |
|------------|------|--------------|------------------|
| CP1: Contract sign-off | Before step 1 | Khushi, Pragathi, Likhith | All 9 shared contracts documented and approved |
| CP2: DB + backend integration | After L1, before P2 | Khushi, Likhith | Neon schema matches API expectations; migrations apply cleanly |
| CP3: Discord + backend integration | After P1, before P2 | Khushi, Pragathi | Discord commands route through backend; /optout enforced in retrieval |
| CP4: Search + retrieval integration | After L2, before P2 | Khushi, Pragathi, Likhith | Embeddings stored correctly; /ask citations resolve to indexed chunks |
| CP5: Jobs + digest integration | After L1, before P3 | Khushi, Pragathi, Likhith | pg-boss jobs schedule and run; /digest produced on cadence |
| CP6: Pre-release integration | Before K3 | All three | All ten capabilities work together; read-only boundary holds end-to-end |

### Phase D — Final Integration and Release Verification Checklist (K3)

- [ ] All ten v1 requirements implemented and mapped to phases
- [ ] Read-only boundary verified: no GitHub writes, no Discord history edits, no Miro writes, no private indexing, no unsupported answers
- [ ] Citations consistently link to original sources (GitHub commit/PR URL, Discord message link, Miro board URL, meeting transcript)
- [ ] All acceptance criteria for K1–K3, P1–P3, L1–L3 verified and marked in REQUIREMENTS.md traceability
- [ ] `STATE.md` updated with final phase progress
- [ ] v1 release deployed to heavencloud plan
- [ ] Smoke test on heavencloud plan: /ask, /decisions, /digest, /meeting actions, /optout, Miro board search all functional
- [ ] Rollback plan documented if deployment fails

---

## PR Lifecycle

1. Person creates their feature branch from `main` (`feat/khushi`, `feat/pragathi`, or `feat/likhith`)
2. Person completes all three work packages on their branch, updates `STATE.md`, commits
3. Person syncs branch with latest `main` and runs relevant tests
4. Person opens one PR targeting `main` (K, P, or L) with linked requirements (REQ-IDs), updated `STATE.md`, and verification notes
5. Khushi reviews and approves (or requests changes)
6. Branch owner addresses feedback
7. After Khushi approves, the branch owner merges their own PR into `main`
8. Branch owner deletes the feature branch
9. `STATE.md` reflects merged phase progress before the next person merges

---

## Conflicts and Risks in Current Ownership Distribution

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Khushi bottleneck** | Khushi has final approval on all three PRs plus cross-cutting architecture duties. If Khushi is unavailable, P and L PRs cannot merge. | Khushi should review PRs in a timely window; branch owners can prepare feedback responses in advance. |
| **K3 depends on P3 and L3** | Khushi's final release PR (K3) cannot complete until both Pragathi and Likhith finish their last work packages. Any delay in P3 or L3 blocks the v1 release. | Integration checkpoint CP6 before K3; early warning if P3/L3 slip. |
| **P2 depends on L1** | Pragathi's /ask work package (P2) needs Likhith's database + job queue (L1) first. If L1 slips, P2 is blocked. | CP2 checkpoint; Likhith prioritizes L1 early. |
| **L3 depends on P2** | Likhith's final work package (L3) needs Pragathi's /ask (P2) for citation grounding. Circular-ish dependency between P2 and L3 via search contract. | Search contract (CP1) must be frozen early so both can implement against it independently. |
| **Shared contract disagreements** | Disagreements on database schema, API formats, or search contracts could cause rework. | All three review contracts at CP1; Khushi has final decision authority. |
| **Unresolved providers** | Miro token/MCP and the App-backed GitHub live test remain pending. Discord gateway ingestion and transcript-only audio have been decided. | Record decisions in their contracts; keep Miro and GitHub App live acceptance pending until verified. |
| **Beginner onboarding** | All three members need clear responsibility documentation to avoid stepping on each other's work. | This PR-PLAN.md plus STATE.md handoff requirements; branch-per-person isolation. |

---

## Unresolved / Pending

- Miro token, MCP connection, board allowlist, and live read verification — pending
- GitHub App auth live verification and full public-repository reindex — pending
- Contracts #2 (API), #5 (Miro), and #8 (Meeting) — pending
- Database contract #1 approval status — pending confirmation by Khushi
- UI & showcase member names: pending — branches to be created when they join

**Constraints confirmed:**
- All ten agreed capabilities remain in v1. None removed, postponed, or reduced.
- Hosting is heavencloud plan. Kerit Cloud is not referenced anywhere.
- Unresolved technical decisions are explicitly marked as pending validation.
- No confirmed provider capabilities are invented.

---

*Last updated: 2026-11-12 after initialization*
