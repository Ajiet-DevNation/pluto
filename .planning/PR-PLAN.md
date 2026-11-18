# Pluto — PR Plan Per Person (Final Team Collaboration & Integration Workflow)

Git workflow and branch strategy for the Pluto v1 release. **Seven capabilities ship in v1**: INDEX-01, INDEX-02, INDEX-03, ASK-01, DIGE-01, MEET-02 (Automatic Meeting Announcer) and OPTO-01. Automatic PR notifications (PRNT-01) were cancelled on 2026-11-15. On 2026-11-17 the `/decisions` command (DECI-01) and the transcript-based meeting pipeline (INDEX-04, MEET-01, `/meeting actions`) were removed from active v1 and deferred. Hosting is heavencloud plan. Each person has one feature branch and at least three work packages (PRs). Packages may merge separately or as one PR once the set is complete; a defect found after merge is fixed in a small follow-up PR on the same branch. Unresolved items are marked pending; nothing is assumed decided. Historical merged packages are identified explicitly so a completed package is not mistaken for new work.

## Team and Branch Ownership

| Person | Role | Branch | Current responsibility |
|--------|------|--------|------------------------|
| Khushi | Project Lead | `feat/khushi` | K1, K2, K3; contracts, architecture approval, shared integration, final PR review |
| Pragathi | Bot Development | `feat/pragathi` | P1, P2 (merged); **P3 — on-demand `/digest`, `/upcoming`, `/event add`, `/help`** |
| Likhith | Bot Development | `feat/likhith` | L1, L2 (merged, L2 legacy/deferred); **L3 — complete Automatic Meeting Announcer** |
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
8. **Do not mark a feature complete because a contract or plan was written.** Completion requires implementation, tests, and the acceptance criteria below.

---

## Khushi — Project Lead (`feat/khushi`)

| PR | Content | Files | Acceptance | Depends on | Target hour | Status |
|----|---------|-------|------------|------------|-------------|--------|
| K1 | Initialize TypeScript/Express backend scaffold; configure Node.js 22 runtime; establish read-only GitHub access | `src/cmd/pluto/**`, `tsconfig.json`, `.nvmrc`, `scripts/build.sh`, `src/github/app.ts` | Backend builds and runs locally; Node.js 22 pinned; read-only GitHub credential verified (`GET` 200, write attempt 403) | — | 5 | ✅ Merged (PR #1, #2) |
| K2 | Enforce the read-only boundary in code: guard the GitHub and Miro clients, prove no write operation is reachable, build the citation layer, verify Miro read access | `src/guardrails/**`, `src/citations/**`, `src/github/**`, `src/miro/**`, `tests/**`, `.planning/contracts/security.md` | Write operations impossible by guard and by credential; static scan finds no write verbs in client modules; citation URLs correct and self-citation blocked; Miro live verification pending (no token) | K1 | 7 | ◐ Code merged (PR #3, #7); live Miro check pending |
| K3 | v1 release hardening; full acceptance verification across all seven active requirements; deploy v1 release to heavencloud plan | `.planning/**`, `scripts/deploy.sh`, `scripts/test-all.sh`, shared integration files | All seven active v1 requirements implemented and tested; read-only boundary verified; citations consistently link to original sources; announcer safety verified; v1 deployed to heavencloud plan | K2, P3, L3 | 8 | ⬜ Pending |

**Cross-cutting responsibilities (Khushi):**
- Owns overall architecture, integration, shared interfaces, Miro REST setup, and final technical decisions
- Reviews and approves all three PRs (K, P, L) before merge
- Resolves disagreements on shared contracts
- Approves changes to shared contracts
- **Owns final integration of shared command registration, Discord interaction routing, and shared worker startup** (`src/discord/bot.ts`, `src/discord/commands.ts`, `src/jobs/worker.ts`, `src/db/schema.ts`, `drizzle/migrations/`)
- Updates `STATE.md` at phase transitions
- Maintains `.planning/` source of truth
- Handles release tagging

---

## Pragathi — Bot Development (`feat/pragathi`)

| PR | Content | Files | Acceptance | Depends on | Target hour | Status |
|----|---------|-------|------------|------------|-------------|--------|
| P1 | Connect Discord bot via discord.js v14; join DevNation server; index selected Discord channels; implement `/optout` command to exclude member messages from indexing | `src/cmd/pluto/**`, `src/discord/**`, `src/optout/**`, `tests/discord/` | Discord bot connected and joined; admin-selected channels indexed; non-selected channels excluded; opted-out members' messages excluded from search and answers | K1 | 5 | ✅ Merged and live-verified (PR #9) |
| P2 | Implement `/ask`; index all public-org GitHub READMEs, issues, PRs, commits, contributors, and eligible text/source files; ground answers in indexed content | `src/cmd/pluto/**`, `src/ask/**`, `src/search/**`, `tests/ask/`, `tests/search/` | `/ask` answers from indexed sources with one supporting citation; all public Ajiet-DevNation repositories and API pages are included; repo-specific questions stay scoped to that repo; private repositories and excluded/sensitive files remain out; missing credentials fail reindex visibly | P1, L1 | 7 | ✅ Merged (PR #10, #14); full-corpus reindex and live Discord acceptance pending |
| P3 | Implement on-demand project activity and event awareness: `/digest days:N` deterministic snapshot, `/upcoming meetings`, `/upcoming events`, `/event add` with a public record in `#events`, and `/help`. **No weekly scheduler, AI-written digest, `/resource`, `/upcoming all`, channel scanning, or manual-event reminders.** | `src/digest/**`, `src/upcoming/**`, `src/events/**`, `src/help/**`, `tests/digest/**`, `tests/upcoming/**`, `tests/events/**`, `tests/help/**`; command registration coordinated with Khushi in `src/discord/commands.ts` | `/digest` is guild-scoped and deterministic; `/upcoming meetings` lists confirmed future meetings; `/upcoming events` lists scheduled manual events; `/event add` validates strict date/time input, saves the event, sends an ephemeral confirmation, and posts a public record in `#events`; `/help` lists commands; no unsupported content; empty periods handled; privacy/opt-out/bot-author restrictions preserved; existing commands unaffected; tests and build pass | P2, L1, L3 (`meeting_events` schema) | 6 | ⬜ Pending (current assignment) |

**P3 acceptance criteria (authoritative):**
1. `/digest days:N` is guild-scoped; `N` is 1–30 and defaults to 7.
2. The digest is deterministic and reports only counts and links drawn from indexed records: GitHub issues, Discord messages, `#decisions` messages, and upcoming meetings/events.
3. The digest does not claim PR or commit activity until reliable occurrence dates exist.
4. Empty periods produce a sensible response; no activity is fabricated.
5. `/upcoming meetings` lists confirmed future meetings from `meeting_events`.
6. `/upcoming events` lists scheduled future or ongoing manual events from `events`.
7. `/event add` requires Manage Events, accepts strict `YYYY-MM-DD` and `HH:MM` input in `Asia/Kolkata`, saves the event, sends an ephemeral confirmation, and posts a public record in `#events`.
8. `/help` lists the available guild-scoped commands and examples.
9. No `/resource`, `/upcoming all`, weekly digest scheduler, channel scanning, recurring events, or manual-event reminders.
10. Existing Discord privacy, opt-out and bot-author restrictions are preserved.
11. Existing commands and bot behavior remain unaffected.
12. Tests and build pass.

**P3 boundaries:**
- Pragathi may consume `#decisions` messages from the existing indexed store; she must **not** build `/decisions` and must **not** depend on a Likhith-owned `decisions` service module.
- No dependency on newly uploaded meeting audio or transcripts.
- Do not remove decision records or exclude the `#decisions` channel.
- Reuse existing retrieval, database and command-routing interfaces. Do not fork or replace the command registry; export isolated modules and request Khushi's integration. `/digest` is on demand, so P3 adds no background worker or scheduler.

**Contract ownership (Pragathi):**
- Proposes Discord contract changes; Khushi approves. Shared interaction routing is Khushi's integration responsibility.

---

## Likhith — Bot Development (`feat/likhith`)

| PR | Content | Files | Acceptance | Depends on | Target hour | Status |
|----|---------|-------|------------|------------|-------------|--------|
| L1 | Provision Neon Postgres with pgvector and tsvector; connect via Drizzle ORM; configure pg-boss job queue; index GitHub issues from Ajiet-DevNation public repos | `src/db/**`, `src/jobs/**`, `scripts/migrate/**`, `tests/db/` | Neon Postgres provisioned and connected; pg-boss configured for background indexing jobs; GitHub issues indexed and searchable | K1 | 5 | ✅ Complete (PR #4, #8, #12) |
| L2 | Build audio file upload endpoint; transcribe via Cloudflare Workers AI Whisper; store transcripts in Neon (transcript-only, no R2); index meeting transcript content in Neon | `src/upload/**`, `src/transcription/**`, `src/db/**`, `src/jobs/**`, `tests/upload/**`, `tests/transcription/**` | Users can upload meeting transcripts and audio; audio transcribed via Whisper; transcripts stored and indexed in Neon alongside GitHub and Discord content | L1 | 6 | ✅ Merged historically (PR #11, #12); **deferred from active v1** — code and tables retained, no new user workflow |
| L3 | **Build the Automatic Meeting Announcer MVP**: detect eligible `#meeting-plans` announcements, parse date/time, auto-persist valid future meetings, schedule durable pg-boss reminders, deliver to `#pluto`, and test the lifecycle. No confirmation/cancel/reschedule controls, slash command, `/decisions`, transcript work, or `/meeting actions`. | `src/meetings/**`, `tests/meetings/**`, migration `0008_meeting_events.sql`, shared startup integration in `src/cmd/pluto/index.ts` and `src/jobs/worker.ts` | See MEET-02 acceptance criteria in `.planning/REQUIREMENTS.md` | L1, P1 | 7 | ◐ Implemented, integrated & test-guild verified; production/deployment acceptance pending |

**L3 MVP acceptance criteria (authoritative: `.planning/REQUIREMENTS.md` → MEET-02):**
1. Announcements are detected only in configured `#meeting-plans`, from human authors, with actual Discord mention metadata and meeting-related language.
2. Supported date/time expressions are parsed deterministically in `Asia/Kolkata`, anchored to the announcement timestamp; ambiguous or invalid input gets a clarification.
3. Valid future events are auto-scheduled without confirmation, then persisted with unique source identity.
4. Durable pg-boss jobs survive restarts through startup reconciliation and a registered worker.
5. Reminders go to configured `#pluto` without repeating mass mentions.
6. Duplicate event creation and concurrent delivery are controlled; delivery is honestly documented as at-least-once.
7. Failures are handled safely; existing `/ask`, `/optout`, and indexing behavior remains unaffected.
8. Unit and integration tests pass.

**L3 scope details:**
- Detection is independent of the ordinary Discord indexing pipeline. Do not change existing intake filters or the startup backfill contract.
- Channel IDs come from `.planning/config.json`. Do not hardcode `#meeting-plans` or `#pluto`.
- Require meeting-related language **and** an actual mention. Ignore bot authors and other channels.
- Use deterministic date/time parsing with `Asia/Kolkata`; interpret relative dates from the original message's `createdAt`.
- Valid future announcements are auto-scheduled; ambiguity receives a simple clarification. No confirmation, cancellation, rescheduling, or moderator-action UI exists in the MVP.
- Reminder queue: `send-meeting-reminder`, payload `{ meetingId, eventVersion }`. Register the worker with `boss.work`; creating the queue alone is insufficient.
- No new slash command; no `@everyone`/`@here` repeat; never edit/delete the original announcement; no voice recording.
- Document the realistic delivery guarantee (at-least-once). Do not claim exactly-once Discord delivery.

**Explicitly not in L3:**
- `/decisions`
- Meeting-transcript embedding fixes
- New upload or transcription workflows
- Transcript summaries, action items, `/meeting actions`
- Voice recording

**Contract ownership (Likhith):**
- Proposes and implements database, background-job and meeting contracts
- Reviews shared interfaces before dependent implementation begins
- Coordinates any `bot.ts` / `commands.ts` / `worker.ts` / schema change with Khushi before implementation

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
| 1 | Database schema | Likhith proposes; Khushi approves | Tables, columns, relationships, indexes, migrations, naming conventions, `meeting_events` | Draft in `contracts/database.md`; approval pending |
| 2 | API contracts | Khushi owns | Endpoints, request/response formats, validation, errors | Pending validation |
| 3 | Discord contracts | Pragathi proposes; Khushi approves | Bot command interfaces, channel configuration, permissions, meeting-announcer detection/interaction rules | Approved; announcer behavior added 2026-11-17 |
| 4 | GitHub contracts | Khushi owns | GitHub App access, webhook/event payloads, repository allowlist | Drafted in `contracts/github.md`; review pending |
| 5 | Miro contracts | Khushi owns | Miro REST connection, board allowlist, read-only enforcement, board/comment/text/diagram access | Pending validation |
| 6 | Search contracts | Khushi owns | Document/chunk formats, embedding dimensions, retrieval, citation references | Approved; consumers updated 2026-11-17 |
| 7 | Background jobs | Likhith proposes; Khushi approves | Job names, payloads, retries, idempotency, scheduling, reminder recovery | Approved; `send-meeting-reminder` added 2026-11-17 |
| 8 | Meeting contract | Likhith proposes; Khushi approves | Detection, parsing, confirmation, event lifecycle, reminders, cancellation/rescheduling, tests, exclusions | Drafted in `contracts/meeting.md`; review pending |
| 9 | Security contracts | Khushi owns | Read-only boundaries, visibility enforcement, opt-out behavior | Active/approved for K2 (`contracts/security.md`) |

**Contract review rule:** All three must review shared interfaces before dependent implementation begins. Khushi resolves disagreements and approves changes to shared contracts.

---

## Shared-File Coordination

Both features touch common infrastructure. These files are **Khushi-owned integration points**; feature owners must not independently replace their contents.

| Shared file | Final owner | Rule |
|-------------|-------------|------|
| `src/discord/bot.ts` | Khushi | Khushi wires detection and command handlers. Likhith/Pragathi export handlers or service interfaces; they do not rewrite the startup flow or listener registration. |
| `src/discord/commands.ts` | Khushi | One command registry. P3 adds `/digest`, `/upcoming`, `/event`, and `/help` through a reviewed patch; L3 adds no slash command. No one replaces the registry wholesale. |
| `src/jobs/worker.ts` | Khushi | Khushi integrates worker registration. Likhith supplies `send-meeting-reminder` registration and startup reconciliation; P3 adds no worker because `/digest` is on demand. Do not overwrite existing GitHub/transcript startup code. |
| `src/db/schema.ts` | Khushi approves; Likhith proposes | Likhith adds the `meeting_events` Drizzle definition. Pragathi reads existing tables and adds no competing event schema. |
| `drizzle/migrations/` | Khushi approves; feature owner authors | One new migration per feature, never edit an already-applied migration. The `meeting_events` migration is Likhith's. |

**Integration contract:** Each developer builds an isolated module with exported interfaces, tests and clear integration instructions. Khushi performs the final merge into `bot.ts`, `commands.ts`, `worker.ts`, `schema.ts` and the migration sequence.

---

## Dependency and Integration Sequence

### Phase A — Before Any Coding (Contracts First)

All shared contracts (1–9 above) must be drafted and reviewed by all three members before dependent implementation begins. Khushi approves final versions.

Prerequisite order:
1. Database schema (Likhith proposes, Khushi approves) — before L1, L3, P2, P3
2. API contracts (Khushi owns) — before K1, P1, L1
3. Discord contracts (Pragathi proposes, Khushi approves) — before P1, and for announcer routing before L3
4. GitHub contracts (Khushi owns) — before K1
5. Miro contracts (Khushi owns) — before K1
6. Search contracts (Khushi owns) — before P2, P3
7. Background jobs (Likhith proposes, Khushi approves) — before L1, L3, P3
8. Meeting contract (Likhith proposes, Khushi approves) — before L3
9. Security contracts (Khushi owns) — before K2 and all PRs

### Phase B — Implementation Order with Dependencies

| Step | PR | Owner | Depends On | Integration Checkpoint |
|------|-----|-------|------------|----------------------|
| 1 | K1 | Khushi | GitHub contract, API contract, DB schema | Backend scaffold builds locally; Node.js 22 pinned; read-only GitHub credential verified |
| 2 | L1 | Likhith | K1, DB schema, background jobs contract | Neon + pg-boss connected; issues indexed |
| 3 | P1 | Pragathi | K1, Discord contract | Discord bot joined; `/optout` working |
| 4 | P2 | Pragathi | P1, L1, search contract | `/ask` returns grounded answers with one supporting source |
| 5 | L3 | Likhith + Khushi integration | L1, P1, meeting contract, background jobs, DB schema | Announcer detects, parses, auto-persists, schedules, reminds one hour before; shared integration and test-guild end-to-end flow verified; production/deployment acceptance pending |
| 6 | P3 | Pragathi | P2, L1, L3 (`meeting_events`), search contract | `/digest` returns a deterministic snapshot; `/upcoming meetings` and `/upcoming events` list correctly; `/event add` saves and posts once; `/help` lists commands |
| 7 | K2 | Khushi | K1 | Read-only boundary enforced; guard rails verified |
| 8 | K3 | Khushi | K2, P3, L3 | All seven active capabilities tested; v1 deployed to heavencloud plan |

**Note:** L2 is historically merged (PR #11, #12) but is **not** in the v1 critical path. Its upload/transcription user workflow is deferred. It must not be treated as a prerequisite for L3 or P3.

### Phase C — Integration Checkpoints (Catch Incompatible Implementations Early)

| Checkpoint | When | Participants | What Is Verified |
|------------|------|--------------|------------------|
| CP1: Contract sign-off | Before step 1 | Khushi, Pragathi, Likhith | All 9 shared contracts documented and approved |
| CP2: DB + backend integration | After L1, before P2/L3 | Khushi, Likhith | Neon schema matches API expectations; migrations apply cleanly; `meeting_events` design fits the same migration runner |
| CP3: Discord + backend integration | After P1, before P2/L3 | Khushi, Pragathi | Discord commands route through backend; `/optout` enforced in retrieval; existing intake unchanged |
| CP4: Search + retrieval integration | After P2, before P3 | Khushi, Pragathi, Likhith | Embeddings stored correctly; `/ask` citations resolve; `/digest` can reuse retrieval |
| CP5: Jobs + announcer integration | After L1/P1, before L3 merge | Khushi, Likhith | `meeting_events` migration applies; `send-meeting-reminder` queue is created **and** a worker is registered; reminder posts only to `#pluto`; restart recovery works. Test-guild integration verified; production/deployment acceptance pending. |
| CP6: Activity + event integration | After P2/L3, before P3 merge | Khushi, Pragathi | Command registration is reviewed; `/digest` is deterministic; `/upcoming meetings` reads `meeting_events`; `/event add` writes once and posts one public record; no scheduler is added |
| CP7: Pre-release integration | Before K3 | All three | All seven active capabilities work together; read-only boundary, no-mass-mention and no-voice rules hold end-to-end |

### Phase D — Final Integration and Release Verification Checklist (K3)

- [ ] All **seven** active v1 requirements implemented and mapped to phases
- [ ] Read-only boundary verified: no GitHub writes, no Discord history edits, no Miro writes, no private indexing, no unsupported answers
- [ ] Citations consistently link to original sources (GitHub commit/PR URL, Discord message link, Miro board URL)
- [ ] Meeting announcer: unique source announcement identity; event versioning; no `@everyone`/`@here` repeat; no voice recording; no original-announcement edits; no confirmation/cancel/reschedule controls in MVP
- [ ] Reminder delivery guarantee documented and tested (at-least-once; no exactly-once claim)
- [ ] All acceptance criteria for K1–K3, P1–P3, L1–L3 verified and marked in REQUIREMENTS.md traceability
- [ ] `STATE.md` updated with final phase progress
- [ ] v1 release deployed to heavencloud plan
- [ ] Smoke test on heavencloud plan: `/ask`, `/digest`, `/upcoming meetings`, `/upcoming events`, `/event add`, `/help`, announcer auto-detection and reminder delivery, `/optout`, Miro board search all functional
- [ ] Legacy L2 upload code is present but not presented as an active v1 workflow
- [ ] Rollback plan documented if deployment fails

---

## PR Lifecycle

1. Person creates their feature branch from `main` (`feat/khushi`, `feat/pragathi`, or `feat/likhith`)
2. Person completes the active work packages on their branch, updates `STATE.md`, commits
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
| **Khushi bottleneck** | Khushi has final approval on all three PRs plus shared integration. If Khushi is unavailable, P and L PRs cannot merge. | Khushi reviews in a timely window; branch owners prepare feedback responses in advance. |
| **K3 depends on P3 and L3** | Khushi's final release PR (K3) cannot complete until Pragathi's activity/event package and Likhith's announcer finish. Any delay blocks v1. | CP7 before K3; early warning if P3/L3 slip. |
| **Shared-file collisions** | L3 touches `worker.ts`/`schema.ts`/migrations, P3 touches the command registry, and both need `bot.ts` routing. Independent replacement would break existing `/ask`/`/optout`. | Khushi owns final integration; isolated modules; one command registry; one migration per feature; CP5/CP6 reviews. |
| **P3 depends on P2 and L3** | `/digest` needs P2's indexed corpus; `/upcoming meetings` needs L3's `meeting_events` schema. If either slips, P3 slips. | Merge PR #16 before P3; CP4/CP6; handle empty/partial periods honestly. |
| **Announcer date/time ambiguity** | Relative dates ("tomorrow"), missing AM/PM, and timezone mistakes could schedule the wrong reminder. | Deterministic parser, `Asia/Kolkata`, relative to original `createdAt`, explicit clarification, and tests for past/invalid/<1-hour cases. |
| **Reminder duplication or missed delivery** | A crash between Discord send and database update can duplicate a reminder; a failed send can miss one. | pg-boss retries, versioned events, conditional DB claim, startup reconciliation, honest at-least-once documentation. Never use in-memory `setTimeout`. |
| **Announcer incorrectly treats conversation as an event** | Ordinary discussion about a meeting could trigger a false event. | Require an actual mention **and** meeting language; ignore bot authors/other channels; only schedule after deterministic parsing yields a valid future date/time. |
| **Legacy L2 confusion** | Upload/transcription code exists in the repository, so someone may assume it is active v1 work. | STATE/PR-PLAN mark it legacy/deferred; no active acceptance criteria; do not delete it. |
| **Decisions data mistaken for the command** | Removing `/decisions` could be misread as removing `#decisions`. | `#decisions` stays in the five-channel allowlist; contracts and requirements state it remains indexed evidence. |
| **Unresolved providers** | Miro token and App-backed GitHub live verification remain pending. | Record decisions in contracts; keep live acceptance pending until verified. |
| **Beginner onboarding** | All three members need clear responsibility documentation to avoid stepping on each other's work. | This PR-PLAN.md plus STATE.md handoff requirements; branch-per-person isolation; shared-file ownership table. |

---

## Unresolved / Pending

- L3 implementation, shared startup integration, and real test-guild acceptance are verified; production/deployment acceptance — pending
- P3 (on-demand activity snapshot, `/upcoming`, `/event add`, `/help`) implementation — pending; assignment for Pragathi
- `contracts/meeting.md` — drafted 2026-11-17; Khushi approval pending
- Database contract #1 approval status — pending confirmation by Khushi
- Contracts #2 (API) and #5 (Miro) — pending
- Miro token, approved board IDs, and live read verification — pending (no shared DevNation Miro workspace exists)
- GitHub App auth live verification and full public-repository reindex — pending
- P2 full-corpus reindex, `content_hash` backfill and live Discord acceptance — pending manual approval
- UI & showcase member names — pending; branches to be created when they join
- Legacy L2 code disposition (keep vs. remove) — post-v1 decision; not part of this documentation change
- Whether to reintroduce `/decisions`, transcript uploads or transcript summaries after v1 — post-v1 decision; not committed
- `.planning/config.json` still records `all_ten_capabilities_in_v1: true` and a pending R2/audio-storage decision. These are stale but intentionally unchanged because this documentation task forbids editing `config.json`; Khushi must approve a config update

**Constraints confirmed:**
- **Seven** active capabilities remain in v1: INDEX-01, INDEX-02, INDEX-03, ASK-01, DIGE-01, MEET-02, OPTO-01.
- PRNT-01 (PR notifications) was cancelled by Khushi on 2026-11-15.
- INDEX-04, MEET-01 and DECI-01 are deferred/removed from active v1 as of 2026-11-17.
- Hosting is heavencloud plan. Kerit Cloud is not referenced anywhere.
- No new infrastructure (Redis, Docker, external schedulers) without approval.
- Unresolved technical decisions are explicitly marked as pending validation.
- No confirmed provider capabilities are invented.

---

*Last updated: 2026-11-18 — revised L3 status and P3 scope. L3 implementation, shared integration, and test-guild acceptance are complete; production/deployment acceptance and contract approvals are pending. P3 is now the on-demand activity and event-awareness package (`/digest`, `/upcoming`, `/event add`, `/help`), replacing the weekly AI digest. Active v1 remains seven requirements.*
