# /ask evaluation contract

> ASK-01 and the `/ask` command were removed from active v1 on 2026-11-18. This
> contract and its evaluation tooling are retained for a possible future
> re-enable of the retrieval engine.

**Owner:** Khushi approves; P2 owner maintains the question set.
**Status:** Draft — expected answers are filled in only after a reviewer checks the live GitHub source.
**Applies to:** the retained `/ask` retrieval engine and any future re-enable of ASK-01; every later change to indexing or retrieval.

## Purpose

"Answers anything accurately" is a measurable claim. This contract defines how we
measure it, so a change to indexing or retrieval is accepted only when the score
does not regress.

## Question set

Questions live in `tests/eval/questions.json`. Each entry has:

| Field | Meaning |
|-------|---------|
| `id` | stable identifier |
| `category` | one of the categories below |
| `question` | the exact text a member would type |
| `repository` | `owner/repo` the question is about, or `null` for cross-repository questions |
| `expect` | `answer`, `no-evidence`, `refuse-private`, `refuse-write`, or `uncertainty` |
| `must_include_any` | at least one of these facts must appear in the answer (case-insensitive) |
| `must_include_all` | every one of these facts must appear in the answer |
| `must_not_include` | none of these may appear in the answer |
| `expected_source_any` | optional URL fragments; retrieval records a hit when at least one retrieved chunk contains one of them |
| `required_source_any` | optional stricter source fragments; a README-specific expectation can fail while fallback PR/commit evidence still counts in `expected_source_any` |
| `expect_structured_contributors` | the answer must come from the on-demand GitHub contributors lookup (`Contributors to …:`), not top-N retrieval |
| `required_version_claims` | version-aware expectations, e.g. `{ "technology": "typescript", "major": 7 }`; negated/different versions do not count |
| `verified` | `true` only after a reviewer confirmed the expected facts on GitHub |

Categories:

1. `readme` — purpose and setup from a README
2. `source-file` — behaviour defined in a repository file
3. `dependency` — current versions from a package manifest (must prefer the default-branch file over commit messages)
4. `issue` — a specific issue by number
5. `pull-request` — a specific pull request by number
6. `commit` — a specific commit
7. `contributor` — who contributed to a repository
8. `cross-repository` — a question that spans repositories
9. `no-evidence` — something that does not exist in the index
10. `out-of-scope` — private data, general knowledge, or a request to change something

## Pass criteria

A run passes an entry when all of these hold:

- `expect: answer` — the answer contains at least one `must_include_any` fact,
  every `must_include_all` fact, every `required_version_claims` expectation,
  and no `must_not_include` text. An answer entry must define at least one fact,
  version claim, or structured contributor requirement; an empty expectation is
  invalid because it would let any non-empty answer pass.
- `expect: no-evidence` — the answer is exactly the standard no-evidence message.
- `expect: uncertainty` — the answer is the standard no-evidence message or
  contains explicit uncertainty/historical-versus-current disclosure. A
  confident current-value claim that merely mentions commit history does not
  count.
- `expect: refuse-private` — the answer does not reveal content from a private repository or channel and does not invent one.
- `expect: refuse-write` — the answer refuses the change and states the read-only boundary.
- `expect_structured_contributors` — the answer starts with
  `Contributors to <repository>:` from the on-demand GitHub contributors
  lookup; a top-N list of names from commits/PRs fails. Anonymous entries are
  reported as contribution counts, not names.
- `required_version_claims` — versions are matched semantically. A major claim
  (`major: 7`) accepts `TypeScript 7` and `TypeScript 7.0.2`; it rejects
  `TypeScript 4`, `TypeScript 4, not 7`, and negated claims such as
  `TypeScript 7 is not used`.
- Answer text contains no URLs, source lists, or bracketed citation markers.
  Product decision 2026-11-16: the Discord command appends at most one selected
  supporting source footer outside the generated answer; the evaluation reads
  the answer text, not the command footer.
- If `repository` is set, retrieval must be scoped to that repository (no other repository's facts may appear).

## Deferred entries

When the shared Cloudflare allowance is exhausted, `/ask` replies with the busy
message instead of answering. Those entries are recorded as **deferred**, not
failed, and are excluded from the pass-rate gate. A run with deferred entries is
inconclusive, not a regression; rerun after the allowance resets.

The run reports the pass rate per category. A change is accepted only when:

- overall pass rate does not drop below the previous accepted run, and
- no category that was passing drops by more than one entry.

## Entries with `verified: false`

Entries whose expected facts have not been checked are still run, but they are
reported separately and do not count toward the acceptance gate. Reviewers verify
an entry by reading the live GitHub source and then setting `verified: true` with
the expected facts filled in.

## Runner

`npm run eval:ask` runs every entry through the live `AskService` and writes a
report to `tmp/eval-ask-report.json`. It requires the same `.env` as the bot and
must run after a successful `npm run index:search`.

`npm run eval:retrieval -- --allow-cloudflare` measures retrieval separately and writes
`tmp/eval-retrieval-report.json`. It requires `DATABASE_URL` and Cloudflare
credentials. It uses a dedicated read-only database connection and verifies
`SHOW transaction_read_only` and `SHOW default_transaction_read_only` are `on`
before querying. The dedicated pool rejects any `options` parameter in
`DATABASE_URL` because node-postgres would merge it over the read-only startup
option. The explicit `--allow-cloudflare` flag is required before any embedding
call is made; without it the script exits before connecting to the database or
making external API calls. When explicitly enabled, curated-question embeddings
can consume Cloudflare usage.

The version and uncertainty matching helpers live in
`src/search/evaluation.ts` and are covered by
`tests/search/evaluation.test.ts`. They are evaluation-only; `/ask` runtime
grounding uses the separate guards in `src/search/ask.ts`.

## Retrieval methodology (2026-11-16)

The retrieval runner measures two layers:

1. **Approximate vs exact vector retrieval.** Ground truth is the exact top-K
   from a sequential scan (`enable_indexscan=off`, `enable_bitmapscan=off`).
   The application's `vectorSearch` is run with the configured
   `IVFFLAT_PROBES`. Reported: Recall@5, Recall@10, MRR@5, latency.
2. **Hybrid retrieval.** `RetrievalService.retrieve` is run for each curated
   question. Reported: zero-result rate, retrieval latency, whether a labelled
   `expected_source_any` URL fragment appears in the top 5/10, and whether the
   stricter `required_source_any` fragment appears. This distinguishes a
   README-specific expectation from acceptable PR/commit fallback evidence.

A chunk-vector sample (`--samples=N`, default 40) reuses stored embeddings as
queries, so it measures index recall independently of question wording and
spends no embedding quota.

Recall is computed by chunk id. Duplicate chunks with equal cosine scores have
unspecified order, so an ID-set difference at a tie boundary is reported as a
tie artefact, not a missing neighbour. The report keeps the raw per-question
values so the distinction is auditable.

### Results

Corpus at measurement time: 7,880 embedded chunks (7,807 GitHub, 73 Discord),
all with 768-dimensional BGE-Base vectors.

| Measurement | probes=1 (before) | probes=100 (after) |
|-------------|-------------------|--------------------|
| ANN Recall@5, 18 curated questions | 0.311 | 1.000 |
| ANN Recall@10, 18 curated questions | 0.322 | 1.000 |
| ANN MRR@5, 18 curated questions | 0.556 | 0.957–1.000 |
| ANN Recall@5, 20-vector sample | 0.517 (60-sample baseline) | 1.000 |
| ANN Recall@10, 20-vector sample | 0.440 (60-sample baseline) | 1.000 |
| Repository-scoped zero-result rate | 2/14 | 0 non-empty-repo zeros |
| FTS zero-hit questions (`plainto_tsquery`) | 15/18 | n/a — replaced by strict/broad query construction |

After removing `enable_seqscan=off`, PostgreSQL chose an exact scan for the
sampled queries, so the 20-vector sample reached exact-set recall. The curated
question set was already exact at probes=100. The 7,880-row table is small
enough that exact sequential/Bitmap scans are cheap; the index remains available
for larger inputs and is still used when the planner selects it.

Hybrid retrieval after the remediation round:

- Expected-source hit rate: **0.867** for the 15 entries with a broad source
  expectation. The misses are `dn-orbit` package (not indexed) and `pluto`
  package (not indexed).
- Required README-source hit rate: **0.0** for the one entry that explicitly
  requires a `dn-orbit` README. This is the intended distinction: the answer
  can be grounded in PR/commit evidence, but the README itself is missing.
- Zero-result rate: **2/23**, both deliberate (unknown issue and private repo).

Answer evaluation after remediation:

- Last run: **18/23**. Verified gate: **9/9**. A previous run was 19/23 due to model variance.
- Unverified failures:
  - `dependency-dn-orbit-next` — no current `package.json`; historical commits only.
  - `dependency-pluto-typescript` — no current `package.json`; the
    `required_version_claims` expectation now rejects a historical or uncertain
    answer. This is a corpus gap, not a false pass.
  - `contributor-pluto` — previously failed with no structured `#contributor:`
    rows; contributor questions now use the on-demand GitHub contributors API
    (`/ask` remediation 2026-11-16), so indexed contributor rows are no longer
    required.
  - `contributor-dn-orbit` — same change; no fallback to commit/PR names.
  - `cross-which-repo-uses-next` passed on the last run; one earlier run omitted
    the `dn-orbit` evidence even though retrieval included it. This is model
    variance, not a retrieval miss.
  - `readme-pluto-purpose` returned no-evidence on the last run despite the
    README being retrieved; it passed on earlier runs. This is model variance,
    not a retrieval miss.
- `readme-dn-orbit-purpose` passes using PR/commit evidence; the README-specific
  source requirement remains unmet. This is reported separately rather than
  treated as a success for the README expectation.
- `contradictory-stale-next-version` passes via the `uncertainty` expectation:
  the standard no-evidence response is accepted for a current-value question
  where only historical commits exist. Conflict-disclosure wording still passes
  when the model provides it.

Answer quality is nondeterministic because the generation model is live. Runs
on the same corpus varied by one entry; the verified-gate result was stable at
9/9. Do not treat a single unverified failure as a retrieval regression.

The two false-positive examples from the independent review are covered by
regression tests:

- “The current Next.js version is 16, based on commit history.” does **not**
  satisfy `expect: uncertainty`.
- “TypeScript 4, not 7.” does **not** satisfy the TypeScript major-7 version
  expectation. `TypeScript 7` and `TypeScript 7.0.2` do.

### Corpus gaps found during the audit

These are indexing/coverage issues, not retrieval defects. They require a
full reindex with working GitHub credentials, which was not run in this session.

- `Ajiet-DevNation/dn-orbit`: no README chunk and no `package.json`/blob chunks.
  PRs and commits exist, so the project-purpose question can be answered
  partially; the README-specific expectation cannot.
- `Ajiet-DevNation/pluto`: one blob chunk (README); no `package.json`.
- `search_chunks` contributor rows were absent for both `pluto` and `dn-orbit`
  (`#contributor:*`). This is no longer a blocker for `/ask`: contributor
  questions use the on-demand read-only GitHub contributors API and never guess
  from commits or PRs.
- All 7,880 existing rows have `content_hash = NULL`; a normal reindex would
  re-embed all of them. See `contracts/database.md` for the pending backfill.

## Not decided here

- Scoring with a language model judge (not used in v1; keyword checks are deterministic).
- Latency targets for `/ask`.
