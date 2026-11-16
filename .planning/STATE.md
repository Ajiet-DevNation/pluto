# Pluto — Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-12 after initialization)

**Core value:** Make community information easier to find, understand, and manage — with answers based only on actual project records (GitHub, Discord, Miro, meetings), always cited to their original source, and never generated from unsupported general knowledge.

**Current focus:** Phase 2 `/ask` remediation on `feature/phase-2-retrieval` (2026-11-16). The IVFFlat recall defect, dead full-text path, repository-scope bug, missing exact issue/PR lookup, duplicate evidence, answer URL leak, version hallucination, dedupe-before-filter bug, contributor detection gap, evaluation integrity gaps and multi-repository scoping were fixed and validated locally. A follow-up round added on-demand GitHub contributor lookup, one visible supporting source per answer (product decision 2026-11-16), prompt-leakage cleanup, and comparison purpose/limitation disclosure. The verified `/ask` evaluation gate passes 9/9; remaining unverified failures are mostly entries whose source files are absent from the current corpus (`dn-orbit` README/`package.json`, `pluto` `package.json`), with occasional live-model variance on `readme-pluto-purpose` and `cross-which-repo-uses-next`. A full GitHub reindex, a `content_hash` backfill, and any production index rebuild still require manual approval. P2 is merged to `main` (`298e557`, PR #10). Cleanup PR #13 (`fix/pre-l3-cleanup`) is merged to `main` (`f335152`). Scope changed on 2026-11-15: PR notifications (PRNT-01) are cancelled, and action items belong to P3. Remaining before K3: L3 (Likhith: `/decisions` and the meeting embedding fix), P3 (Pragathi: meeting summaries, action items, `/meeting actions`, `/digest`), and INDEX-03 (Miro REST, blocked on token).

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
- AI & Embeddings: Cloudflare Workers AI (bge-base-en-v1.5, instruct model, Whisper)
- Audio Storage: None in v1; transcript-only ingestion

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
| Phase 3: Meeting Transcript & Audio Ingestion | ✅ Implemented (L2 merged; acceptance verification tracked) | INDEX-04 | 4/4 |
| Phase 4: /ask Q&A with Citations | ◐ In progress (retrieval audit fixed IVFFlat/FTS/scoping; full-corpus reindex and live acceptance pending) | ASK-01 | 3/4 |
| Phase 5: /decisions | ○ Pending | DECI-01 | 0/1 |
| Phase 6: /digest Weekly Summaries | ○ Pending | DIGE-01 | 0/3 |
| Phase 7: Meeting Summaries & Action Items | ○ Pending | MEET-01 | 0/4 |
| Phase 8: Hardening & v1 Release | ○ Pending | All | 0/5 |

## Phase 2 `/ask` Retrieval Audit (2026-11-16)

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

## Package Status

| Package | Owner | Status | Notes |
|---------|-------|--------|-------|
| K1 | Khushi | ✅ Merged (PR #1, #2) | Scaffold, Node 22, backend. PAT read access was verified. GitHub App is now installed; App auth code/live verification is still pending. |
| K2 | Khushi | ◐ Code merged (PR #3, #7); live Miro check pending | Read-only guards, citations, evidence gate, and tests are merged. Miro REST token, approved board IDs, and live read verification are outstanding; there is no shared DevNation Miro workspace yet. |
| K3 | Khushi | ⬜ Pending | Depends on K2, P3, L3. |
| L1 | Likhith | ✅ Complete (PR #4 + #8, migration fix #12) | Neon/Drizzle, pg-boss, public issue indexing, scheduled worker, idempotent migrations, tests, `vector(768)`/`tsvector` migration. Latest `main` tests/build pass. |
| L2 | Likhith | ✅ Complete | Build audio file upload endpoint; transcribe via Cloudflare Workers AI Whisper; store transcripts in Neon (transcript-only, no R2); index meeting transcript content in Neon. Depends on L1. |
| L3 | Likhith | ⬜ Pending | Depends on L2, P2. |
| P1 | Pragathi | ✅ Merged and live-verified (PR #9) | Discord allowlist intake, startup backfill, bot-author exclusion, guild-scoped `/optout`; live verification passed. |
| P2 | Pragathi / Khushi takeover fix | ✅ Merged (PR #10, `298e557`); retrieval audit on `feature/phase-2-retrieval` | `/ask`, repo-scoped retrieval, one visible supporting source, App/PAT auth, and paginated public-repository indexing for READMEs, issues, PRs, commits, contributor identities, and eligible source files. 2026-11-16 retrieval audit fixed IVFFlat probes, full-text query construction, exact issue/PR lookup, dedupe and answer guards; a follow-up round added on-demand contributor lookup, prompt-leakage cleanup, and comparison disclosure. Full reindex and live Discord acceptance are still pending. |
| P3 | Pragathi | ⬜ Pending | Depends on P2, L2. |

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
| Cloudflare R2 | ⛔ Not used in v1 | — | Transcript-only audio flow; no audio persistence | — |

## Discord Channel Policy

| Role | Channel | ID |
|------|---------|-----|
| Bot output + commands | `#pluto` | `1570721649538502686` |
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
- P2 full-corpus live reindex using the GitHub App; verify all public repos are enumerated and private repos/files remain excluded
- `content_hash` backfill for the 7,880 pre-migration rows (production write; SQL prepared in `contracts/database.md`)
- IVFFlat index rebuild — not required for the runtime fix; any rebuild needs manual approval and `CREATE INDEX CONCURRENTLY` outside a transaction
- GitHub App live read-only verification; PAT remains fallback until it passes
- Miro REST access token and approved board IDs — **pending** (no shared DevNation Miro workspace exists)
- Team/mentor agreement on posting five lines of meeting notes in `#meeting-plans` after each meeting — **pending**
- Cleanup PR #13 (`fix/pre-l3-cleanup`) — merged to `main` (`f335152`)
- API contract #2, Miro contract #5, and Meeting contract #8 — pending
- Database contract #1 approval status — pending confirmation by Khushi
- Audio storage — decided: not needed for v1, transcript-only (audio goes directly to Whisper, buffer discarded)
- CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN — verified working via Live API check; need values in each .env for local runs
- UPLOAD_TOKEN — static upload auth token for v1; needs value in each .env
- UI & showcase team members — joining after bot completion (pending)

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
| Background job queues | `index-github-issues` (startup + 30min) + `index-transcript` (on upload); singleton, retryLimit 3, retryBackoff | `contracts/background-jobs.md` |
| Upload auth | Static `UPLOAD_TOKEN` bearer token for v1; per-user auth deferred to P3 | `contracts/database.md` (L2 contract) |
| Transcript storage | `meeting_transcripts` table + `search_chunks` chunks with `vector(768)` + `search_vector` tsvector | `contracts/database.md` (L2 contract), `contracts/search.md` |
| Audio persistence | None — audio buffer discarded after Whisper; no R2, no disk | `contracts/database.md` (L2 scope decision) |
| Citation URL for transcripts | `sourceUrl` from upload (e.g., Discord message link); gap tracked as pending if no real URL | `contracts/database.md` (L2 contract) |
| GitHub corpus scope | All public Ajiet-DevNation repos; README, issues, PRs, commits, and eligible text/source files; no private repos; paginated | `contracts/github.md`, `contracts/search.md` |

## Scope decisions (2026-11-15)

| Decision | Value | Recorded in |
|----------|-------|-------------|
| PR notifications (PRNT-01) | **Cancelled for v1.** The Takoyaki bot already posts PR notices in the server; Pluto would duplicate them. PRs stay indexed for `/ask` and `/decisions` | `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md` |
| Action items | Owned by **P3 (Pragathi)**; L3 does not include them | `PR-PLAN.md`, `PROJECT.md` |
| v1 capability count | **Nine** (was ten) | `REQUIREMENTS.md`, `ROADMAP.md` |
| #decisions channel | Created 2026-11-15 in the public Information category; added to the allowlist for decision capture. #core-general and #event-ideation were rejected as private Core Channels | `config.json`, `contracts/discord.md` |

## Citation and channel safety rules
- `#pluto` is never indexed: the bot must not cite its own answers.
- The self-citation rule is about **bot-authored messages in any channel**, not only `#pluto`.
- `#pluto-bot` is excluded from v1 retrieval: operational noise, not project knowledge.

---

*Last updated: 2026-11-16 — Phase 2 `/ask` follow-up plus pre-smoke hardening on `feature/phase-2-retrieval`. Added on-demand GitHub contributor lookup, one visible supporting source (superseding the answer-only decision), prompt-leakage cleanup, comparison purpose/limitation disclosure, Discord 2,000-character safe truncation, honest 403 rate-limit versus access-error handling, and contributor cache disclosure. 273 tests pass; build clean; `git diff --check` clean; verified eval gate 9/9; last answer eval 18/23 with corpus-gap failures. Live Cloudflare/Discord smoke was intentionally not run. No commits, merges, pushes or PRs were created.*
