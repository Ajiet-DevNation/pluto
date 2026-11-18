# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-17 with the revised v1 scope)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records (GitHub, Discord, Miro), always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** Revised v1 scope (base scope 2026-11-17; P3 revised 2026-11-18). **Six capabilities are active in v1**: INDEX-01, INDEX-02, INDEX-03, DIGE-01, MEET-02 (Automatic Meeting Announcer) and OPTO-01. ASK-01 is removed from active v1 on 2026-11-18: the `/ask` command is removed and its retrieval engine is retained for a future re-enable. The `/decisions` command and transcript-based meeting pipeline (upload, transcription, summaries, action items, `/meeting actions`) are removed from active v1; `#decisions` remains in the five-channel allowlist and is indexed evidence for `/digest`, and legacy L2 code/tables are retained. **L3 implementation, shared-file integration, and live test-guild acceptance are complete locally.** A real Discord message was detected, persisted in `meeting_events`, and delivered by pg-boss to the test server’s `#pluto`; the delivered message contained no mass mention. The worker now skips late reminders and marks events completed after delivery or when meetings have started. TypeScript/build pass; all 421 tests pass, including database integration tests. Production deployment acceptance and meeting/database contract approval remain pending. **P3 (Pragathi) is the on-demand activity and event-awareness package: `/digest days:N`, `/upcoming meetings`, `/upcoming events`, `/event add`, `/event cancel`, and `/help`. P3 is complete: implementation, 421 passing tests, build, migration and live Discord acceptance all pass. Migration `0009_events` is recorded in the dev DB. Guild command registration is verified; `/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`, public replies, and the approved 12-hour input/display have been live-verified. `/ask` was removed from active v1 and its command is no longer registered; the retrieval engine is retained for a future re-enable. The P3 PR (#18) is open for Khushi's review and merge.** P2 is merged to `main` (`298e557`, PR #10) and the retrieval audit is merged (`2ff2871`, PR #14); full-corpus reindex and live Discord acceptance remain pending. P1 is merged and live-verified (PR #9). L1 is complete. L2 is historically merged but deferred from active v1. Remaining before K3 include P3 live acceptance, INDEX-03 (Miro REST, blocked on token), P2 live acceptance, and L3 production/deployment acceptance/approval.

## Team
- Project Lead: Khushi
- Bot Development: Pragathi, Likhith
- UI & Showcase: Two additional members — joining after the bot is completed (status: pending)

## Technical Stack (hosted on heavencloud plan)
- Backend: TypeScript, Node.js 22, Express.js, Discord.js v14
- Database: Neon PostgreSQL (pgvector, tsvector, Drizzle ORM)
- Job Queue: pg-boss
- GitHub Integration: Read-only GitHub App via Octokit App auth (implementation/live verification pending)
- Miro Integration: Read-only Miro REST v2, GET only, `boards:read`; typed board content and connectors are in scope, hand-drawn ink is not readable as text. MCP and OCR are dropped.
- AI & Embeddings: Cloudflare Workers AI (bge-base-en-v1.5, instruct model); Whisper code retained for legacy L2, not an active v1 workflow
- Audio Storage: None in v1. The legacy L2 upload path discards audio after transcription; no active upload workflow
- Meeting Announcer: deterministic date/time parsing in `Asia/Kolkata`; durable reminders through pg-boss

## Read-Only Boundary
- No writes to GitHub repositories
- No writes/edits to Discord history
- No indexing of private repositories or channels
- No unsupported general knowledge in answers
- Posting new Discord messages (answers, notifications, digests) is permitted

## Progress
| Phase | Status | Requirements | Progress |
|-------|--------|--------------|----------|
| Phase 1: Foundation & GitHub & Miro Indexing | ◐ Partial (GitHub code in place; App auth live check and Miro verification pending) | INDEX-01, INDEX-03 | 6/8 |
| Phase 2: Discord Indexing & Opt-Out | ✅ Complete (P1 merged and live-verified) | INDEX-02, OPTO-01 | 4/4 |
| Phase 3: /ask Q&A with Citations | ⏸ Removed from active v1 (2026-11-18; `/ask` command removed, retrieval engine retained for future) | ASK-01 | Removed |
| Phase 4: Project Activity & Event Awareness | ✅ Complete (implementation, tests and live Discord acceptance; PR #18 open for Khushi review/merge) | DIGE-01 | 12/12 implemented and live-verified; cancellation and approved additions included |
| Phase 5: Automatic Meeting Announcer | ◐ Implemented, integrated & test-guild verified | MEET-02 | Shared startup/worker wiring complete; migration 0008 recorded; 421 tests pass (0 fail, 0 skip); typecheck/build pass; real Discord test-guild message detected and reminder delivered by pg-boss; late jobs skip delivery and events complete. Production/deployment acceptance and contract approvals pending. |
| Phase 6: Hardening & v1 Release | ○ Pending | All active v1 (7) | 0/6 |

**Deferred / not active v1 phases:** transcript upload and ingestion (INDEX-04), transcript summaries/action items/`/meeting actions` (MEET-01), and the `/decisions` command (DECI-01). L2's upload code remains in the repository but is not in the v1 critical path.

## `/ask` Retrieval Audit (2026-11-16)

> Historical note (2026-11-18): the `/ask` command is removed from active v1.
> The retrieval/indexing engine and this audit remain in the repository for a
> possible future re-enable.

Branch: `feature/phase-2-retrieval` (no commits, no merges, no pushes made).

### Confirmed problems

1. **IVFFlat was effectively missing most of the corpus.** The live index was
   created with no explicit `lists` option, and `ivfflat.probes` was left at the
   PostgreSQL default `1`. Against exact sequential-scan ground truth, Recall@5
   was **0.311** and Recall@10 **0.322** on the 18 curated questions. A 60-vector
   sample scored 0.517 / 0.440. Repository-scoped queries returned zero rows for
   2 of 14 questions because the filter is applied after the approximate scan.
2. **Full-text search was dead for real questions.** `plainto_tsquery` ANDs every
   term. Repository qualifiers tokenise into `ajiet-devn & ajiet & devnat &
   /pluto`, which no chunk satisfies. It returned zero rows for 15/18 curated
   questions and every repository-scoped question.
3. **Repository scope parsing kept sentence punctuation.** `Ajiet-DevNation/
   pluto.` became a repository name, so the scoped query searched a non-existent
   repository.
4. **No exact lookup for issue/PR numbers.** "What does pull request #12
   change?" relied on similarity search and returned no evidence even though the
   PR was indexed.
5. **Lexical scoring admitted one common word.** Any non-zero `ts_rank_cd`
   received at least 0.4, so a chunk matching only "capital" or "notifications"
   could become evidence.
6. **No duplicate-content removal.** Identical files from several repositories
   could consume the answer context.
7. **Visible URL leak.** The model repeated a health-check URL from the README;
   the answer-only contract says no URLs.
8. **Unsupported facts slipped through.** The model invented "TypeScript 4" and
   "an educated guess"; the post-checks only normalised explicit no-evidence
   phrasing.
9. **Contributor fallback could guess.** With no indexed contributor rows, the
   request fell through to top-N retrieval and the model named the org owner.
10. **Corpus gaps.** `dn-orbit` has no indexed README or `package.json`; `pluto`
    has no `package.json`; `pluto` contributor rows are absent. All 7,880 rows
    have `content_hash = NULL`.

### Fixes

- `src/search/postgres.ts`: run vector search in a transaction and set
  `ivfflat.probes` with `set_config(..., true)`; default `IVFFLAT_PROBES=100`;
  **do not force `enable_seqscan=off`**; add exact `findBySourceIds`; rebuild the FTS SQL
  around strict/broad tsqueries and IDF-weighted coverage with zero-DF terms
  excluded from the denominator.
- `src/search/query.ts` (new): stopword/repository/organization cleanup, safe
  term expansion, issue/PR/commit reference parsing, duplicate-content removal.
- `src/search/retrieval.ts`: exact source lookup for named issues/PRs (and no
  evidence when absent), **filter before content dedupe**, so a blocked
  high-scoring duplicate cannot discard the allowed copy.
- `src/search/relevance.ts`: FTS calibration now uses IDF-weighted coverage and
  caps broad-only single terms below the gate.
- `src/search/ask.ts`: trailing-punctuation and multi-repository scope fixes,
  URL stripping with dangling-prose cleanup, richer evidence labels, conflict/
  uncertainty prompt rules, repository-list and multi-repository retrieval,
  speculative/version guards (major-only version support), on-demand contributor
  detection for "who has contributed", display-source selection, comparison
  purpose filtering, prompt-leakage cleanup, and mixed-answer cleanup.
- `src/search/cloudflare.ts`: system prompt now forbids URLs, citation markers,
  guesses and speculation, and requires the standard no-evidence reply.
- `src/search/runtime.ts`: pass probes and organization name to the store;
  resolve every named repository scope.
- `tests/eval/questions.json`, `scripts/eval-ask.ts`,
  `scripts/eval-retrieval.ts`: add `must_include_all`, `uncertainty`,
  `expect_structured_contributors`, `required_source_any`; remove the
  `contributor-dn-orbit` and `dependency-pluto-typescript` false passes; keep
  the stale-evidence test as an explicit uncertainty case.
- `.env.example`: document `IVFFLAT_PROBES=100`.

### Remediation round (post-review, 2026-11-16)

The independent review confirmed additional defects, now fixed:

1. Dedupe ran before blocked-channel/opt-out filtering, so a blocked
   high-scoring duplicate could discard the allowed copy. Filtering now runs
   first; regression test added.
2. Version validation rejected valid major claims (`Next.js 16` vs `16.4.2`)
   and missed unnamed claims (`The version is 9`). It now compares major
   components and checks unnamed claims; regression tests cover all named cases.
3. Contributor detection missed “who has contributed”; it now uses the
   structured index and returns no evidence when rows are absent.
4. Evaluation expectations allowed false passes (`TypeScript 4` passed the
   `typescript`-only check; empty contributor expectations passed any answer).
   Added `must_include_all`, `uncertainty`, `expect_structured_contributors`
   and `required_source_any`; no expectation was weakened. The stale-evidence
   entry now uses the explicit `uncertainty` expectation (standard no-evidence
   or disclosed uncertainty), preserving the conflict/uncertainty test instead
   of silently accepting any answer.
5. `enable_seqscan=off` was removed. It did not force IVFFlat for scoped
   queries, and forcing an index can become approximate after a rebuild.
6. Zero-document-frequency terms no longer inflate the IDF denominator.
7. Guards no longer suppress grounded negative/partial answers or “I cannot
   speculate”, and no longer strip code arrays like `[1, 2]`. A mixed
   partial/no-evidence answer is cleaned without discarding the supported part.
8. Explicit multi-repository questions now retrieve from every named scope and
   tell the model when a scope has no evidence. The six-source cap was raised
   dynamically (hard cap 12) so a seven-repository comparison includes all
   seven; beyond 12, omitted repos are disclosed in the prompt.
9. Evaluation uncertainty is now semantic: a confident current-version claim
   that merely mentions commit history fails; explicit uncertainty or a
   historical-vs-current distinction passes.
10. Version expectations are version-aware: TypeScript 7 and 7.0.2 satisfy
    major 7; TypeScript 4 and “TypeScript 4, not 7” do not.

### Measurements (real local database, 7,880 chunks)

| Metric | Before | After |
|--------|--------|-------|
| ANN Recall@5, 18 curated questions | 0.311 | 1.000 |
| ANN Recall@10, 18 curated questions | 0.322 | 1.000 |
| ANN Recall@5, 20-vector sample (after planner-choice change) | 0.517 (60-sample baseline) | 1.000 |
| ANN Recall@10, 20-vector sample (after planner-choice change) | 0.440 (60-sample baseline) | 1.000 |
| Scoped zero-result rate | 2/14 (starvation) | 2/19, both deliberate (unknown issue, private repo) |
| FTS plainto zero-hit | 15/18 | n/a (replaced) |
| Verified `/ask` eval gate | n/a | 9/9 |
| Whole eval set (23 entries) | 11/18 on old 18-entry set | 18/23 on the last evaluation-integrity run; verified gate 9/9; failures are four corpus gaps plus one model-variance no-evidence case |

Exact vs approximate, probe sweep, latency, and source-hit methodology are in
`contracts/evaluation.md`. Approximate retrieval reaches exact-set recall at
probes=100; no index was rebuilt.

### `/ask` follow-up improvements (2026-11-16)

Four targeted changes were implemented on `feature/phase-2-retrieval` without
schema, indexing, Discord-gateway, command-registration, environment, or GitHub
permission changes:

1. **On-demand contributor lookup.** `src/search/runtime.ts` builds a read-only
   `GitHubReader` lazily on the first contributor question and calls the existing
   `listContributors()` endpoint. Anonymous entries become an anonymous
   contribution count. Missing `owner/repo` asks for clarification; 404,
   rate-limit, empty, and network failures return honest messages and never fall
   back to commits, PRs, or guesses. Ordinary questions do not call GitHub.
2. **One visible source.** `AskService` now returns `displaySources` while
   keeping full internal `sources`/`chunks`. `src/ask/command.ts` appends one
   supporting source by default, the exact PR/issue for direct questions,
   README/docs for general questions, and one per represented repository for
   comparisons. This supersedes the 2026-11-14 answer-only product decision.
3. **Prompt-leakage cleanup.** Shared prompt text lives in
   `src/search/prompt.ts`; `stripInternalPromptLeakage()` removes echoed ask and
   system instructions before guards run. Regression tests cover the observed
   `The evidence was retrieved for this question` leak and system-prompt text.
4. **Comparison honesty.** Purpose questions use only authoritative current
   README/documentation evidence. Comparisons retrieve every named repository as
   before, but disclose repositories that have only historical commit/PR
   evidence and forbid inferring overall purpose from those snippets.

Files changed: `src/search/ask.ts`, `src/search/runtime.ts`,
`src/search/cloudflare.ts`, `src/search/contributors.ts` (new),
`src/search/prompt.ts` (new), `src/ask/command.ts`,
`tests/search/ask.test.ts`, `tests/ask/command.test.ts`,
`.planning/contracts/search.md`, `.planning/contracts/evaluation.md`,
`.planning/REQUIREMENTS.md`, `.planning/STATE.md`.

### Pre-smoke hardening (2026-11-16)

Three residual issues were addressed before live smoke testing:

1. **Discord length.** `formatAskReply()` keeps answer plus footer within the
   2,000-character limit. It truncates the answer at a safe word/code-point
   boundary with a visible `[truncated]` marker while preserving the source
   link; if the source block cannot fit, it preserves the answer and says the
   link was omitted instead of emitting a broken URL.
2. **GitHub 403 distinction.** `GitHubReadError` now records `rateLimited`,
   classified from `x-ratelimit-remaining`, `retry-after`, GitHub's error
   message, and status 429. Contributor lookup maps non-rate-limit 403s to an
   honest access-denied message instead of claiming rate limiting. Retry policy
   and GitHub permissions are unchanged.
3. **Contributor cache disclosure.** Contributor answers use the existing answer
   cache (default 15 minutes) and now state that GitHub contributor data may be
   reused for identical questions and can lag recent changes. The note is only
   added when answer caching is enabled.

Files changed in this hardening pass: `src/ask/command.ts`,
`src/github/reader.ts`, `src/search/ask.ts`, `src/search/contributors.ts`,
`src/search/runtime.ts`, `tests/ask/command.test.ts`,
`tests/github/reader.test.ts`, `tests/search/ask.test.ts`,
`.planning/contracts/search.md`, `.planning/STATE.md`.

### Validation

- `npm test`: **273 pass, 0 fail** (267 before the pre-smoke hardening pass).
- `npm run build`: clean.
- `git diff --check`: clean.
- `npm run eval:retrieval -- --samples=20`: questions ANN Recall@5 1.000,
  Recall@10 1.000; sample 1.000 / 1.000 after letting the planner choose exact
  scans; expected-source hit rate 0.867 (13/15); required README-source hit 0
  for the missing `dn-orbit` README; zero-result rate 2/23, both deliberate
  (unknown issue and private repo).
- Live answer evaluation: last run 18/23, verified gate 9/9. Unverified failures
  are four corpus gaps plus one model-variance no-evidence on
  `readme-pluto-purpose`; `dependency-pluto-typescript` no longer false-passes
  on historical `typescript@7`, and `contributor-dn-orbit` no longer false-passes
  through commit/PR retrieval.

### Still requires manual approval

- Full GitHub App-backed reindex (writes `search_chunks`, spends embedding
  quota). This is required to index the missing README/package files.
- One-time `content_hash` backfill (production data write); SQL is prepared in
  `contracts/database.md`. Without it, the next reindex re-embeds all 7,880
  chunks.
- Any IVFFlat index rebuild. No rebuild was performed; runtime probes are the
  fix. If a rebuild is approved, use `CREATE INDEX CONCURRENTLY` outside a
  transaction and re-run `npm run eval:retrieval`.

### Remaining limitations

- The corpus is incomplete for several evaluated questions. Missing indexed
  contributor rows no longer block `/ask` contributor questions, which use the
  on-demand GitHub API instead.
- Non-version unsupported factual statements can still pass; the post-generation
  checks are heuristics, not a full entailment verifier.
- Answer quality is model-dependent; the eval set is small and the live model is
  nondeterministic.
- No reranking or cross-encoder; no BGE-M3 migration (explicitly out of Phase 2).
- FTS uses the `english` configuration; non-English meeting content is handled
  by vector search only.

## P3 Activity & Event Awareness (2026-11-18)

Branch `feat/p3-activity-events`. No commits, pushes or merges were made.

Implemented modules:

- `src/digest/**` — on-demand deterministic `/digest` with a 1–30 day rolling
  window (default 7), GitHub issue counts/links, indexed Discord message counts,
  a `#decisions` subset, and upcoming meeting/event counts. Pull requests and
  commits are explicitly not reported because reliable occurrence dates are not
  stored.
- `src/upcoming/**` — `/upcoming meetings` (confirmed future `meeting_events`)
  and `/upcoming events` (scheduled future or ongoing `events`).
- `src/events/**` — `events` Drizzle schema and repository, strict
  `YYYY-MM-DD` plus 12-hour/24-hour time validation in Asia/Kolkata, 12-hour IST
  display, every-member `/event add`, `/event cancel` (creator or Manage
  Events), ephemeral confirmations, one public `#events` record/notice with
  `allowedMentions.parse = []`, and keep-the-row behaviour when a public post
  fails.
- `src/help/**` — guild-scoped `/help` listing the six v1 commands with examples.
- `drizzle/migrations/0009_events.sql` — manual event table, status/timezone/
  end-after-start checks and the `(guild_id, start_at)` index.

Shared integration (minimal, single-registry rule preserved):

- `src/discord/commands.ts` registers `/digest`, `/upcoming`, `/event`, `/help`
  alongside `/optout` and `/ask`; no global application commands.
- `src/discord/bot.ts` routes the four new interactions, validates `#events`
  access at startup, and sends the public event record with mass mentions
  disabled.
- `src/discord/policy.ts` reads `events_channel_id` and refuses to index it.
- `src/cmd/pluto/index.ts` composes the P3 services from the shared database
  handle; P3 adds no worker or scheduler.

Validation performed locally:

- `npm test` equivalent: **421 pass, 0 fail, 0 skip** (55 new P3 tests covering
  command metadata, strict date/time parsing including 12-hour AM/PM input and
  display, digest counts/windows/formatting, upcoming queries, event validation,
  permissions, public-post failure and database constraints).
- `npm run build`: clean.
- `npm run migrate`: applied `0009_events.sql` and recorded it in
  `schema_migrations` on the dev database.
- Real-database checks: `events` migration applies, the event repository
  round-trips, upcoming meeting/event queries filter correctly, and the digest
  issue query counts only in-window rows.
- A read-only dry run of the digest and upcoming services against the dev
  database produced the expected empty-period output.
- A full `/event add` handler run against the dev database saved one temporary
  event, produced the ephemeral confirmation and public record, appeared in
  `/upcoming events`, and was cleaned up afterwards.

Verification completed:

- `/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`, public replies, and the approved 12-hour input/display are live-verified in the guild.
- `#events` remains outside the five-channel allowlist and has zero `search_chunks` rows.
- `/ask` routes correctly; its live answer check is blocked by the separate Cloudflare AI allowance issue tracked for P2, not by P3.
- Known interaction: L3 marks a meeting `completed` after its one-hour reminder
  is delivered, so `/upcoming meetings` stops listing it in that final hour. This
  follows the P3 contract's `confirmed`-only wording; changing it needs a
  contract decision.

## Package Status

| Package | Owner | Status | Notes |
|---------|-------|--------|-------|
| K1 | Khushi | ✅ Merged (PR #1, #2) | Scaffold, Node 22, backend. PAT read access was verified. GitHub App is now installed; App auth code/live verification is still pending. |
| K2 | Khushi | ◐ Code merged (PR #3, #7); live Miro check pending | Read-only guards, citations, evidence gate, and tests are merged. Miro REST token, approved board IDs, and live read verification are outstanding; there is no shared DevNation Miro workspace yet. |
| K3 | Khushi | ⬜ Pending | Depends on K2, P3, L3. |
| L1 | Likhith | ✅ Complete (PR #4 + #8, migration fix #12) | Neon/Drizzle, pg-boss, public issue indexing, scheduled worker, idempotent migrations, tests, `vector(768)`/`tsvector` migration. Latest `main` tests/build pass. |
| L2 | Likhith | ✅ Merged historically (PR #11, #12); ⏸ **deferred from active v1** | Upload endpoint, Whisper transcription, `meeting_transcripts` storage and transcript chunk indexing exist in the repository. No new upload/transcription user workflow is active in v1. The code and tables must not be deleted; L2 is not a prerequisite for L3 or P3. |
| L3 | Likhith (feature implementation); Khushi (shared integration) | ◐ Implemented, integrated & test-guild verified | **Automatic Meeting Announcer, MVP.** Detects real @everyone/@here mentions plus meeting language in configured #meeting-plans; deterministic Asia/Kolkata parsing anchored to message createdAt; persists valid events; schedules durable pg-boss reminders; registers worker and runs startup reconciliation. Late jobs are skipped; delivered or started meetings are marked completed. Integration wired through `src/cmd/pluto/index.ts` and `src/jobs/worker.ts`; safe listener error boundary and shutdown. Migration `0008_meeting_events.sql` is recorded in the dev DB. 421 tests pass, 0 fail, 0 skip; typecheck/build pass. A real Discord test-guild message was detected, persisted, and delivered to test #pluto by pg-boss; the sent message had no mass mention. No `/meeting` slash command, confirmation, cancel, or reschedule controls in MVP. Remaining: production/deployment acceptance and Khushi approval of meeting/database contracts. |
| P1 | Pragathi | ✅ Merged and live-verified (PR #9) | Discord allowlist intake, startup backfill, bot-author exclusion, guild-scoped `/optout`; live verification passed. |
| P2 | Pragathi / Khushi takeover fix | ✅ Merged (PR #10 `298e557`; retrieval audit PR #14 `2ff2871`); ⏸ `/ask` command removed from active v1 2026-11-18 | `/ask` implementation and retrieval audit were merged, then the `/ask` command was removed from active v1 on 2026-11-18 because it is not working reliably; the search/retrieval engine, indexing, schema, contracts and tests are retained for a future re-enable. Full-corpus reindex remains pending but is not an active command dependency. |
| P3 | Pragathi | ✅ Complete (implementation, tests and live acceptance; PR #18 open for Khushi review/merge) | **On-demand activity and event awareness.** `/digest days:N` returns a deterministic 1–30 day snapshot (default 7) using GitHub issues, indexed Discord messages, a `#decisions` subset, and upcoming meetings/events; no AI narrative and no scheduler. `/upcoming meetings` reads confirmed future `meeting_events`. `/upcoming events` reads scheduled future/ongoing `events` and shows each event ID. `/event add` and `/event cancel` are available to every member; creators can cancel their own events and Manage Events can cancel any event. `/event add` validates strict `YYYY-MM-DD` plus 12-hour or 24-hour time input in `Asia/Kolkata`, displays 12-hour IST, saves the event, sends an ephemeral confirmation, and posts one public record in `#events`. Cancellation marks the row cancelled, posts one public notice, never edits/deletes the original record, and is excluded from upcoming lists. `/help` lists the five active v1 commands. Migration `0009_events.sql` is recorded in the dev DB; commands are registered through the single guild registry. No `/resource`, `/upcoming all`, channel scanning, recurring events, or manual-event reminders. 421 tests pass, 0 fail, 0 skip; build/typecheck pass. `/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`, public replies, and 12-hour display are live-verified. ASK-01 is removed from active v1; the `/ask` command is no longer registered and its retrieval engine is retained for future work. |

### Credentials inventory

Values are never recorded here — only existence, owner, scope and expiry.

| Credential | Status | Owner | Scope | Expiry |
|------------|--------|-------|-------|--------|
| Discord bot token | ✅ Active | Khushi | Bot, Message Content Intent | — |
| GitHub App | ✅ Created and installed; auth code/verification pending | Khushi | Ajiet-DevNation installation, read-only repo permissions; public repos | — |
| GitHub PAT (interim) | ✅ Active | Khushi | Fine-grained, public repos, Contents/Issues/Metadata read | 90 days |
| Neon `DATABASE_URL` | ✅ Active | Likhith | Dev database, pgvector | — |
| Miro access token | ❌ Missing | — | Board read | — |
| Cloudflare Workers AI | ✅ Active | Khushi | Workers AI: Read (account-wide); bge-base-en-v1.5 (768), llama-3.1-8b-instruct, whisper-large-v3-turbo | Token has no TTL — roll quarterly |
| Cloudflare R2 | ⛔ Not used in v1 | — | Legacy L2 transcript-only flow; no audio persistence | — |

## Discord Channel Policy

| Role | Channel | ID |
|------|---------|-----|
| Bot output + commands | `#pluto` | `1570721649538502686` |
| Manual event log (not indexed) | `#events` | `1572348309509644289` |
| Indexed | `#project-stack` | `1423323863093088407` |
| Indexed | `#resources` | `1422593926367547487` |
| Indexed | `#announcements` | `1422593926367547486` |
| Indexed | `#meeting-plans` (created 2026-11-14, under Projects) | `1570872485933752502` |
| Indexed | `#decisions` (created 2026-11-15, Information) | `1571564343995277492` |
| Excluded | `#pluto`, `#pluto-bot`, `#general` (text + media), `#off-topic`, `#assets`, `#welcome-and-rules`, `#takoyaki`, voice channels | — |
| Not in policy | `#core-general`, `#code-wars`, `#event-ideation`, `#core-secrets`, `#dn-orbit-website`, `#server-hub`, `#bumblebee` — the bot can see them, but they are **not** indexed | — |

**Indexing is allowlist-only.** Index exactly the 5 channels in `config.json → discord.indexed_channels`. Never infer from `excluded_channels`: that list is documentation and is not exhaustive. Verified against the live channel list on 2026-11-16 — the bot sees 29 channels, 5 of which are indexed.

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
- **L3 production/deployment acceptance — pending.** A real Discord test-guild message and reminder were verified; the bot was not deployed or tested in the production guild.
- **P3 live Discord acceptance — complete.** `/digest`, `/upcoming meetings`, `/upcoming events`, `/event add`, `/event cancel`, `/help`, public replies, and 12-hour display were live-verified in the guild; command registration and `0009_events` are verified.
- **ASK-01 / `/ask` — removed from active v1 (2026-11-18).** The `/ask` slash command and its handler are removed from the bot. The retrieval/indexing engine, `src/search/ask.ts`, related tests, evaluation scripts and schema remain for a future re-enable. `#decisions` remains indexed evidence for `/digest`.
- **P3 PR #18 — open for Khushi review/merge.** Branch `feat/p3-activity-events`; implementation, tests and live acceptance are complete. Do not mark DIGE-01 merged until Khushi approves and the branch merges.
- **P3 every-member `/event add` — approved.** Khushi approved open event creation on 2026-11-18; the old Manage Events gate is removed. Any member can create an event and post a public `#events` record.
- **P3 `/event cancel` — approved, implemented and live-verified.** Khushi approved cancellation on 2026-11-18. Creators can cancel their own events; Manage Events can cancel any event. Cancellation sets `status = 'cancelled'`, posts one public notice, never edits/deletes the original record, and does not remove the row.
- **P3 12-hour time format — approved.** Khushi approved the 12-hour input/display change on 2026-11-18. 12-hour display is implemented across digest/upcoming/event output, and `/event add` accepts both 12-hour and 24-hour input. `contracts/discord.md` §8.3 records the approved behavior.
- **P3 public replies — approved.** Khushi approved public replies for `/digest`, `/upcoming`, and `/help` on 2026-11-18; implementation is complete. `/optout`, the `/event add`/`/event cancel` confirmations, and wrong-guild/error messages remain ephemeral.
- P2 full-corpus live reindex using the GitHub App; verify all public repos are enumerated and private repos/files remain excluded
- `content_hash` backfill for the 7,880 pre-migration rows (production write; SQL prepared in `contracts/database.md`)
- IVFFlat index rebuild — not required for the runtime fix; any rebuild needs manual approval and `CREATE INDEX CONCURRENTLY` outside a transaction
- GitHub App live read-only verification; PAT remains fallback until it passes
- Miro REST access token and approved board IDs — **pending** (no shared DevNation Miro workspace exists)
- Team/mentor agreement on posting five lines of meeting notes in `#meeting-plans` after each meeting — **pending**
- Cleanup PR #13 (`fix/pre-l3-cleanup`) — merged to `main` (`f335152`)
- API contract #2 and Miro contract #5 — pending
- Meeting contract #8 — drafted in `contracts/meeting.md` on 2026-11-17; revised for MVP (no confirmation/cancel/reschedule); **Khushi approval pending**
- Database contract #1 approval status — pending confirmation by Khushi; `meeting_events` definition added 2026-11-17
- Audio storage — **legacy L2 only**: no active v1 upload workflow; retained code discards the audio buffer and stores no R2/disk audio
- CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN — verified working via Live API check; need values in each .env for local runs
- UPLOAD_TOKEN — only needed if the legacy L2 upload route is run; not part of active v1 acceptance
- UI & showcase team members — joining after bot completion (pending)
- Legacy L2 disposition (keep vs. eventually remove) — post-v1 decision; do not delete as part of the announcer work
- Reintroducing `/decisions`, transcript uploads or transcript summaries — post-v1 decision; not committed

### Known discrepancies (documented, not fixed)

- `.planning/config.json` still contains `planning.timeline.all_ten_capabilities_in_v1: true` and `planning.credentials.cloudflare_r2: "pending decision — audio storage"`. Both are stale relative to the seven-capability scope and the deferred transcript workflow. They were intentionally **not** edited because this task forbids changing `config.json`; Khushi must approve a config update. Channel IDs and the five-channel allowlist in that file are correct and unchanged.
- The existing `index-github-issues` and `index-transcript` queues are created without a registered `boss.work` processor; GitHub indexing currently runs through a 30-minute in-process interval. This is pre-existing and is recorded in `contracts/background-jobs.md`. The new `send-meeting-reminder` queue must register a real worker rather than copying that gap.
- The legacy L2 upload route exists as an HTTP endpoint; there is no Discord `/meeting upload` command and no active upload workflow. This is why L2 is documented as legacy/deferred rather than an active v1 capability.

## Decisions (2026-11-13)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| Background job worker placement | Same process as the Discord bot | `contracts/background-jobs.md` |
| GitHub indexing cadence | On startup + every 30 minutes | `contracts/background-jobs.md` |
| pg-boss mode | Polling (`useListenNotify: false`) — deliberate, because `DATABASE_URL` uses the Neon pooler | `contracts/background-jobs.md` |
| Retry policy | 3 attempts, exponential backoff | `contracts/background-jobs.md` |
| Job idempotency | Upsert on `github_id`; singleton jobs, no overlapping runs | `contracts/background-jobs.md` |
| Embedding model + dimension | `@cf/baai/bge-base-en-v1.5`, **768** (verified live) | `contracts/search.md` |
| Evidence threshold | `EVIDENCE_MIN_SCORE = 0.4` (v1 starting value, tuned after P2) | `contracts/search.md` |
| `#pluto-bot` | Logs-only for v1; never indexed. Revisit post-v1 with a bot-author filter | `config.json` channel policy |
| Cloudflare credential | Provisioned by Khushi; Workers AI Read token | `config.json` credentials |
| `#meeting-plans` | Created 2026-11-14 under Projects, `1570872485933752502`, **indexed** — replaces the unresolved state; `#event-ideation` not used | `config.json` discord.resolved |
| Channel indexing mode | **allowlist only** — never derive indexing from the exclusion list | `config.json` discord.indexing_mode |
| Discord indexing method | Gateway `MessageCreate` + one startup backfill per allowlisted channel (`after=<last_id>`); no webhooks | `contracts/discord.md` |
| Discord command scope | Guild-scoped `guild.commands.set`; global registration forbidden | `contracts/discord.md` |
| Bot-authored messages | Rejected at intake; stored records carry `author_is_bot=false` and are never retrieved or cited | `contracts/discord.md` |
| P1 persistence | Atomic JSON at `PLUTO_DATA_DIR` (default `~/.pluto`); Neon swap at P2 | `contracts/discord.md` |
| `/optout` reversibility | One-way in v1; `/optin` deferred to a later contract change | `contracts/discord.md` |
| Background job queues | `index-github-issues` (startup + 30min), `index-transcript` (legacy), `send-meeting-reminder` (added 2026-11-17); singleton, retryLimit 3, retryBackoff | `contracts/background-jobs.md` |
| Upload auth | Static `UPLOAD_TOKEN` bearer token for the **legacy L2** upload route; no active v1 user workflow | `contracts/database.md` (L2 contract) |
| Transcript storage | **Legacy/deferred:** `meeting_transcripts` table + `search_chunks` chunks with `vector(768)` + `search_vector` tsvector | `contracts/database.md` (L2 contract), `contracts/search.md` |
| Audio persistence | None — legacy audio buffer discarded after Whisper; no R2, no disk; not active v1 | `contracts/database.md` (L2 scope decision) |
| Citation URL for transcripts | **Legacy/deferred:** `sourceUrl` from upload; no new transcript citations in active v1 | `contracts/database.md` (L2 contract) |
| GitHub corpus scope | All public Ajiet-DevNation repos; README, issues, PRs, commits, and eligible text/source files; no private repos; paginated | `contracts/github.md`, `contracts/search.md` |

## Scope decisions (2026-11-15)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| PR notifications (PRNT-01) | **Cancelled for v1.** The Takoyaki bot already posts PR notices in the server; Pluto would duplicate them. PRs stay indexed for `/digest` and a future `/ask` | `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md` |
| Action items | **Superseded 2026-11-17.** No longer active v1; transcript-derived action items are deferred with L2/MEET-01. The 2026-11-15 P3 ownership decision is historical only. | `PR-PLAN.md`, `PROJECT.md` |
| v1 capability count | **Nine on 2026-11-15; revised to seven on 2026-11-17** | `REQUIREMENTS.md`, `ROADMAP.md` |
| #decisions channel | Created 2026-11-15 in the public Information category; added to the allowlist for decision capture. **The `/decisions` command was removed from active v1 on 2026-11-17; the channel remains indexed evidence.** #core-general and #event-ideation were rejected as private Core Channels | `config.json`, `contracts/discord.md` |

## Scope decisions (2026-11-17)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| `/decisions` command | **Removed from active v1.** `#decisions` remains in the five-channel allowlist; its human-authored messages are evidence for `/digest` and a future `/ask`. No decisions service module is required. | `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md`, `contracts/search.md` |
| Transcript upload and transcription | **Deferred from active v1.** L2 code, `meeting_transcripts` and existing chunks are retained and must not be deleted. | `PROJECT.md`, `REQUIREMENTS.md`, `contracts/database.md` |
| Meeting summaries, action items and `/meeting actions` | **Deferred (MEET-01).** No active assignment; do not implement from the old PR plan. | `PROJECT.md`, `REQUIREMENTS.md`, `PR-PLAN.md` |
| Voice recording | **Out of scope.** Do not join, listen to, record or index voice channels. | `PROJECT.md`, `contracts/meeting.md`, `contracts/discord.md` |
| Automatic Meeting Announcer | **New MEET-02, implemented by L3 (Likhith), with shared startup integration by Khushi.** Detection, parsing, auto-persistence, scheduling, delivery and tests; no confirmation or slash command in MVP. Test-guild acceptance passed; production/deployment acceptance pending. | `REQUIREMENTS.md`, `ROADMAP.md`, `PR-PLAN.md`, `contracts/meeting.md` |
| Active v1 capability count | **Seven** (was nine). PRNT-01 cancelled; INDEX-04 and MEET-01 deferred; DECI-01 removed from active v1. | `REQUIREMENTS.md`, `ROADMAP.md` |
| Meeting timezone | **`Asia/Kolkata`**, with relative dates resolved from the original announcement's `createdAt`. | `contracts/meeting.md` |
| Date/time parsing | **Deterministic, testable parsing.** No new AI provider; ambiguous input asks the announcer to clarify. | `contracts/meeting.md` |
| Reminder delivery | **Durable pg-boss queue `send-meeting-reminder`, at-least-once delivery.** No in-memory `setTimeout`; no exactly-once claim. | `contracts/background-jobs.md`, `contracts/meeting.md` |
| Shared-file integration | **Khushi owns final integration** of `src/discord/bot.ts`, `src/discord/commands.ts`, `src/jobs/worker.ts`, `src/db/schema.ts` and `drizzle/migrations/`. Feature owners supply isolated modules. | `PR-PLAN.md` |
| Channel policy | **Unchanged:** exactly five indexed channels including `#decisions`; `#pluto` is never indexed; no allowlist broadening for the announcer. | `config.json`, `contracts/discord.md` |

## Scope decisions (2026-11-18)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| Weekly digest | **Replaced.** No scheduled AI-written digest. `DIGE-01` is now an on-demand deterministic `/digest days:N` snapshot. | `REQUIREMENTS.md`, `ROADMAP.md`, `PR-PLAN.md` |
| Event awareness | **Added to P3.** `/upcoming meetings` reads `meeting_events`; `/upcoming events` reads the new `events` table; `/event add` stores manual events and posts a public record in `#events` (id `1572348309509644289`). | `REQUIREMENTS.md`, `ROADMAP.md`, `PR-PLAN.md`, `config.json` |
| Help command | **Added.** `/help` lists the available guild-scoped commands. | `REQUIREMENTS.md`, `PR-PLAN.md` |
| `/ask` command / ASK-01 | **Removed from active v1 on 2026-11-18.** The `/ask` slash command and handler are removed because the live answer path is not working reliably. The retrieval/indexing engine, `src/search/ask.ts`, evaluation scripts, contracts, schema and tests are retained for a possible future re-enable. Active v1 is now six capabilities. `#decisions` remains indexed evidence for `/digest`. | `REQUIREMENTS.md`, `ROADMAP.md`, `PR-PLAN.md`, `PROJECT.md`, `contracts/discord.md`, `contracts/search.md`, `STATE.md` |
| Removed P3 ideas | `/resource` and `/upcoming all` are not in v1; no channel scanning, recurring events, or manual-event reminders. | `REQUIREMENTS.md`, `PR-PLAN.md` |

## Citation and channel safety rules
- `#pluto` is never indexed: the bot must not cite its own answers.
- The self-citation rule is about **bot-authored messages in any channel**, not only `#pluto`.
- `#pluto-bot` is excluded from v1 retrieval: operational noise, not project knowledge.

## Meeting-announcer safety rules (2026-11-17)
- Detection reads only `#meeting-plans`; reminders post only to `#pluto`.
- An actual Discord `@everyone`/`@here` mention **and** meeting-related language are required.
- Bot-authored and other-channel messages are ignored.
- Reminders never repeat `@everyone`/`@here`.
- The original announcement is never edited or deleted.
- Events are auto-confirmed when parsing succeeds; no confirmation/cancel/reschedule controls.
- No voice-channel recording or indexing.
- The five-channel indexing allowlist is unchanged; `#pluto` remains excluded.

---

*Last updated: 2026-11-18 — P3 on-demand activity and event-awareness is complete (`/digest`, `/upcoming`, `/event add`, `/event cancel`, `/help`); 421 tests pass, build clean, `0009_events` recorded, and live acceptance passed. The P3 PR (#18) is open for Khushi review and merge. ASK-01 is removed from active v1 on 2026-11-18; the `/ask` command is no longer registered and the retrieval/indexing engine is retained for a future re-enable. Active v1 is six capabilities: INDEX-01/02/03, DIGE-01, MEET-02 and OPTO-01. L3 implementation, shared integration, and real test-guild acceptance are verified; production/deployment acceptance and contract approvals are pending.*
