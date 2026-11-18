# Search contract

Owner: Khushi owns. Approved 2026-11-13; consumer list revised 2026-11-17.
Consumers: L1 (storage + indexing), L2 (legacy transcript indexing, deferred), P3 (on-demand `/digest` activity snapshot), L3 (meeting-announcer date/time parsing does **not** use retrieval; it only stores events). ASK-01 and its `/ask` command were removed from active v1 on 2026-11-18; this contract and the retrieval engine are retained for a possible future re-enable.

## Scope note (2026-11-17)

- `#decisions` remains an ordinary indexed Discord channel. Its human-authored
  messages are evidence for `/ask` and `/digest`; there is no `/decisions`
  command and no separate decisions service module.
- Meeting transcript content (`source_type = 'meeting'`) is legacy/deferred.
  Existing chunks remain searchable if present, but no new upload or transcript
  ingestion workflow is active in v1.
- The Automatic Meeting Announcer does not add chunks and does not depend on this
  retrieval contract. Its deterministic date/time parsing is defined in
  `contracts/meeting.md`.

## Purpose

Define how indexed content becomes searchable, so every consumer embeds, chunks,
stores and retrieves the same way. If a consumer needs a behaviour that is not
here, it is added here first — not invented at the call site.

## AI provider

Cloudflare Workers AI. All three models verified live on 2026-11-13.

| Use | Model | Verified |
|-----|-------|----------|
| Embeddings | `@cf/baai/bge-base-en-v1.5` | `success: true`, **768** dimensions |
| Generation | `@cf/meta/llama-3.1-8b-instruct` | resolves to `@cf/meta/llama-3.1-8b-fast-v2`, replies correctly |
| Transcription | `@cf/openai/whisper-large-v3-turbo` | available; expects `audio` input |

Credentials: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` (`.env`).

## Embeddings

- **Model:** `@cf/baai/bge-base-en-v1.5`
- **Dimension:** **768** — confirmed against the live endpoint, not assumed
- **Storage:** `vector(768)` column in Neon, via the `vector` extension
- **Call shape:** POST `/ai/run/@cf/baai/bge-base-en-v1.5` with `{ "text": [...] }`
- **Batching:** one request per chunk batch; do not loop one request per chunk
- **Free-tier backfill:** embedding vectors are cached by a model-versioned content
  hash and reused across identical chunks, including across different sources.
  Successfully embedded batches are upserted immediately; those rows are the
  durable resume checkpoint for a later run.
- Indexing reserves estimated units in Neon before each embedding request. Defaults
  are **700,000 estimated units per UTC day for indexing** and **150,000 per run**,
  out of a shared **1,000,000/day** ledger. Answering draws from the same ledger
  and is capped only at the total, so it keeps a **300,000/day reserve** that a
  backfill cannot consume. Override with `INDEX_EMBEDDING_DAILY_BUDGET`,
  `INDEX_EMBEDDING_DAILY_TOTAL`, `INDEX_EMBEDDING_RUN_BUDGET`, and
  `ANSWER_BUDGET_UNITS`; the estimate is conservative, not provider metering.
- A provider `429` pauses indexing until `Retry-After` or the next UTC day and is
  reported as a deferred run, not a failed process. The scheduled job retries on
  its next interval; completed chunks remain indexed and unchanged chunks are
  skipped on resume.
- When answering hits the shared allowance, `/ask` replies with the busy message
  rather than an error. Identical questions are served from a short-lived answer
  cache (`ANSWER_CACHE_TTL_MS`, default 15 minutes) so repeats do not spend quota.
- Write requests ("edit the README", "add my name") are refused before retrieval,
  because the bot is read-only.

This dimension is a hard constraint. Changing it requires a migration and an
embedding re-index of every stored chunk.

## GitHub corpus coverage

- Enumerate every **public** repository in Ajiet-DevNation using paginated
  GitHub API requests; explicitly request public repositories and defensively
  reject any repository marked private.
- P2 indexes repository READMEs, issues, pull requests, commit messages, and
  contributor identities/counts, and eligible text/source files from each public
  repository's default branch.
- Issue/PR comment threads, PR review comments, and historical commit patches
  are not included in this first corpus pass; indexed issue/PR title and body,
  commit messages, and the current default-branch files are searchable.
- Paginate repository, issue, pull-request, and commit list endpoints so a
  result set larger than one API page is not silently truncated.
- Source-file ingestion uses an explicit text/source extension allowlist, a
  128 KiB per-file limit, and excludes binary files, lockfiles, generated or
  vendored directories, `.env`/credential/private-key paths, and likely leaked
  GitHub/AWS/private-key credentials. This is not an index of binary assets or
  arbitrarily large generated/vendor trees.
- If GitHub reports a truncated recursive tree, indexing fails loudly instead
  of reporting a successful partial repository index.
- The manual reindex command must fail loudly if GitHub credentials are missing
  or a GitHub API request fails; it must not report a successful partial index.
  Embedding-budget and provider-quota deferrals are the exception: they must report
  a paused/resumable run without treating quota exhaustion as a crash.

## Chunk format

A chunk is the unit of retrieval and the unit of citation.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | primary key |
| `source_type` | enum | `github` \| `discord` \| `meeting` \| `miro` |
| `source_id` | text | issue/pr number, message id, transcript id |
| `source_url` | text | original URL, built by `src/citations` |
| `channel_id` | text nullable | Discord only; `null` for other sources |
| `author_id` | text nullable | used for opt-out filtering |
| `content` | text | the chunk text |
| `embedding` | `vector(768)` | nullable until indexed |
| `content_hash` | text nullable | model-versioned hash used for durable resume and cross-source vector reuse |
| `search_vector` | `tsvector` | generated from `content` |
| `indexed_at` | timestamptz | |

- **Chunk size:** ~512 tokens with ~64 tokens of overlap
- **Boundaries:** split on paragraph and line breaks first; fall back to
  sentence boundaries. Never split mid-word or mid-URL.
- **Identity:** a chunk is identified by `(source_type, source_id, chunk_index)`.
  Re-indexing upserts; it must not create duplicates.

## Full-text search

`search_vector` is a `tsvector` column over `content`, using the `english`
configuration. It exists alongside the vector column, not instead of it.

### Query construction (2026-11-16 audit)

`plainto_tsquery('english', question)` joins every term with AND and leaves
repository-qualified questions with unusable tokens (`Ajiet-DevNation/pluto`
becomes `ajiet-devn & ajiet & devnat & /pluto`). On the live corpus it returned
zero rows for 15 of 18 curated questions, and for every repository-scoped
question. The store now builds two queries (`src/search/query.ts`):

1. **Strict**: full retained terms joined with AND (`search_chunks & tsvector &
   migration`). This is the precision signal.
2. **Broad**: each term expanded to its parts and joined with OR
   (`next.js` → `next.js | next | js`). This is the recall signal used to find
   candidates.

Before tokenising, the builder removes URLs, the repository qualifier and the
organization name, then drops question words and generic scaffolding
(`what`, `which`, `does`, `commit`, `change`, `added`, `include`, `repository`,
…). Dotted, underscored and hyphenated identifiers are preserved and also
expanded into parts.

Candidates are the top 200 broad matches by `ts_rank_cd`. Each candidate is then
scored by **IDF-weighted coverage**: the share of the question's full terms it
matches, weighted by `1 / ln(2 + document_frequency)`. A rare identifier such as
`tsvector` (df 7) outweighs a common word such as `migration` (df 115). Terms
with document frequency zero carry weight zero, so a typo does not dilute valid
terms. Coverage, not raw rank, decides whether a lexical match is evidence.

## Retrieval

`/ask` uses hybrid retrieval, then applies the evidence gate:

1. Resolve **all** repositories named in the question. If more than one is
   named, run steps 2–6 for every scope and combine the evidence; missing scopes
   are reported to the model as an incomplete comparison. The query is never
   silently scoped to only the first repository.
2. If the question names an issue or pull request and a repository scope is
   known, look the exact source id up (`repo#123`, `repo#pr-12`). The exact
   source is authoritative; if it is not indexed, return no evidence instead of
   substituting a loosely related chunk. This path does not call the embedding
   provider.
3. Otherwise embed the query with the same model (768 dims).
4. Vector similarity search over `embedding` — top 20 candidates, with
   `ivfflat.probes` set inside the same transaction as the query.
5. Full-text search over `search_vector` — top 20 candidates from the strict /
   broad query above.
6. Merge by chunk identity, keep the best score, then **filter blocked channels
   and opted-out authors before removing exact duplicate content**. Filtering
   first ensures a blocked high-scoring copy cannot discard an allowed copy.
7. Apply `gateEvidence(chunks, EVIDENCE_MIN_SCORE)` from
   `src/guardrails/evidence.ts`.

If step 7 returns `ok: false`, the answer is `NO_EVIDENCE_MESSAGE` and **the
generation model is never called**. That is the read-only, no-general-knowledge
boundary in `contracts/security.md` §4.

### IVFFlat probes (2026-11-16 audit)

The live `search_chunks_embedding_idx` was created without an explicit `lists`
option (`reloptions` is null), and PostgreSQL's default `ivfflat.probes` is `1`.
The actual list count is not exposed through a catalog view; empirical recall
shows it is not 8:

| probes | Recall@5 vs exact (18 curated questions) | Recall@10 |
|--------|------------------------------------------|-----------|
| 1      | 0.311                                    | 0.322     |
| 2      | 0.367                                    | 0.406     |
| 4      | 0.433                                    | 0.461     |
| 8      | 0.656                                    | 0.644     |
| 16     | 1.000 (planner chose a sequential scan)  | 1.000     |
| 64–100 | 0.968 ID-set (ties only)                 | 0.982     |

With an exact index-only probe sweep, results stop changing between probes 64
and 1000, so the effective list count is at most ~64–100 on this corpus. The
default is now **`IVFFLAT_PROBES=100`** (`src/search/postgres.ts`), which covers
every list and is effectively exact for the 7,880-vector index. The store sets
the value with `set_config('ivfflat.probes', …, true)` inside the same Drizzle
transaction that runs the vector query. A standalone `SET` would only affect one
pooled connection and is never used.

`enable_seqscan` is **not** forced off. Measured plans show:

- at probes=100 the planner chooses an exact sequential scan for the global
  query (~22 ms) instead of a warm index scan (~17–38 ms), and chooses
  Bitmap/Seq scans for repository-scoped queries (~6 ms);
- `enable_seqscan=off` did not force the IVFFlat index for scoped queries, and
  a cold forced-index run took ~3.45 s.

Letting PostgreSQL choose avoids turning an exact plan into an approximate one
after a future index rebuild. `IVFFLAT_PROBES` must still be re-tuned if a
rebuild increases `lists`.

On a 20-vector sample after removing the forced index scan, approximate
Recall@5 and Recall@10 were both **1.000** because the planner chose exact
scans. The earlier forced-index 60-vector measurement was 0.940 / 0.990; its
residual difference was duplicate/equal-score chunks, not missing neighbours.
With probes=1 the 60-vector sample scored 0.517 / 0.440. See
`contracts/evaluation.md` for methodology.

No index was rebuilt and no index migration was applied. If a rebuild becomes
necessary, use `CREATE INDEX CONCURRENTLY` outside a transaction block; see
`contracts/database.md` for the operational plan.

### Relevance threshold

- Config key: **`EVIDENCE_MIN_SCORE`**
- Owner: **this contract**. `src/guardrails/evidence.ts` only reads it and
  throws if it is missing or non-numeric.
- v1 starting value: **`0.4`**
- The value is tuned after P2 ships against real queries. It is not final.

### Score normalization (P2 live calibration, 2026-11-14; FTS revised 2026-11-16)

Raw `bge-base-en-v1.5` cosine similarities have a high baseline: unrelated
project text commonly scores around `0.5–0.65`. Applying `0.4` directly to raw
cosine therefore admitted almost every chunk and defeated the no-evidence gate.

The store converts raw scores to a calibrated `0..1` relevance before the gate:

```text
vector_relevance = clamp((cosine - 0.5) / 0.5, 0, 1)

full_text_relevance:
  strict full-term AND match           = clamp(0.6 + 2 * rank, 0, 1)
  IDF-weighted coverage ≥ 0.60        = clamp(0.4 + 2 * rank, 0, 1)
  coverage ≥ 0.50 and rank ≥ 0.50     = clamp(0.4 + rank, 0, 1)
  otherwise                            ≤ 0.39 (below the gate)
```

Consequences:

- `EVIDENCE_MIN_SCORE=0.4` corresponds to raw cosine `0.70`.
- A lexical match now needs either the full identifier terms or enough
  IDF-weighted coverage; a single common word no longer clears the gate.
- Vector search remains the semantic path for paraphrases.

The calibration is recorded in `src/search/relevance.ts` with unit tests. It is
a scoring normalization, not a change to the configured threshold.

## Answer grounding and safety (2026-11-16 audit)

The generator receives only the selected evidence chunks (up to 6 chunks from up
to 3 sources, or 6 sources for repository-list questions). The prompt:

- labels GitHub evidence as current file (`/blob/`), historical commit
  (`/commit/`), issue, or pull request, and names the repository;
- instructs the model to prefer current default-branch files for current values;
- requires explicit disclosure when evidence conflicts;
- requires the standard `NO_EVIDENCE_MESSAGE` when evidence is insufficient;
- forbids URLs, source lists, citation markers, guesses and speculation.

After generation, `src/search/ask.ts` applies post-generation guards:

- `stripInternalPromptLeakage` removes exact echoed prompt instructions (ask
  instructions and system-prompt sentences) from the answer while preserving
  legitimate text. If only instructions remain, the normal no-evidence path
  handles it. Regression coverage includes the observed
  `The evidence was retrieved for this question` leak;
- `stripUrls` removes bare URLs, markdown link targets, `Sources:` lines and
  dangling verbs/prepositions left by URL removal, so the answer text never
  carries its own URL footer even if the model repeats a URL from the evidence;
- `isNoEvidenceAnswer` normalises explicit uncertainty and gap statements but
  preserves grounded negative/partial answers (for example, a gap followed by
  `but PR #9 says...`);
- `isSpeculativeAnswer` rejects “educated guess”, “I think”, “this is
  speculation”, and similar admissions, but does not reject “I cannot
  speculate”;
- `hasUnsupportedVersionClaim` compares named claims against versions near the
  same technology in the evidence. A major-only claim (`Next.js 16`) matches
  the major component of `16.4.2`; a different major (`TypeScript 4` vs `7`)
  is rejected; a full claim must match a full evidence version. It also checks
  unnamed “version is X” claims against versions near “version” or a known
  technology name.

These are **heuristic guards, not a general factual-entailment verifier**. They
do not prove that every non-version claim is supported. Prompt instructions and
the evidence gate remain the first line of defence.

Contributor questions use an **on-demand, read-only GitHub lookup** through
`GitHubReader.listContributors()` (`GET /repos/{owner}/{repo}/contributors`).
Phrasings such as “who contributed”, “who has contributed”, “who works on”, and
“maintainers” are recognised. The lookup:

- runs only for contributor questions, never for ordinary `/ask` questions;
- names contributors with GitHub usernames and contribution counts;
- reports anonymous entries as an anonymous contribution count, never as an
  invented username;
- links to `https://github.com/{owner}/{repo}/graphs/contributors`;
- asks for an explicit `owner/repo` when no repository scope is present;
- returns an honest message for 404, rate limits, permission failures, network
  failures, and empty results;
- distinguishes 403 rate limits from 403 permission failures using
  `x-ratelimit-remaining`, `retry-after`, and GitHub's error message;
- never falls back to indexed commits, pull requests, or guessed names;
- keeps the existing `fetchWithRetry` policy (`maxAttempts=4`, exponential
  delays from 250 ms capped at 4 s, `Retry-After`/rate-limit reset capped at
  30 s), with no new permissions or write scopes.

Contributor answers use the normal answer cache (default 15 minutes). The answer
states that GitHub contributor data may be reused for identical questions and
can lag recent changes, so a cached reply does not imply a fresh GitHub fetch.

Repository-list and multi-repository comparison questions take one chunk per
GitHub repository before filling remaining slots. A question naming two
repositories is retrieved from both; if one scope has no evidence, the model is
told that the comparison is incomplete rather than silently ignoring it.

For repository-purpose and comparison questions, only authoritative current
README/documentation (`/blob/` markdown/text/docs) evidence may support an
overall-purpose claim. When a compared repository has only commit, pull-request,
or other incidental evidence, the prompt discloses that authoritative
documentation is missing and forbids inferring purpose from those snippets.
Commit-only and PR-only evidence is never used as the sole basis for a
repository's overall purpose. Normal questions keep the 3-source budget.

## Citations

Every retrieved chunk carries `source_url`, built by the builders in
`src/citations`. Retrieved chunks that pass the gate ground the answer internally.

Product decision 2026-11-16 (supersedes the 2026-11-14 answer-only decision):
`/ask` displays **one best supporting source** below the answer. The search
layer computes `displaySources` while keeping the full internal `sources` and
`chunks` unchanged for grounding, audit and opt-out enforcement:

- direct PR or issue questions cite the exact `/pull/<n>` or `/issues/<n>`
  source;
- general project questions prefer README or authoritative documentation;
- multi-repository comparisons may show one source per represented repository
  when a single source cannot support both sides;
- a source is shown only when it participated in the selected answer evidence,
  and no source is shown when none supports the answer.

The model still must not write URLs, source lists, or bracketed citation
markers into the answer text; the command appends the selected source footer.

Replies stay within Discord's 2,000-character single-message limit. If the
answer plus footer is too long, the answer is truncated at a safe boundary with
a visible `[truncated]` marker while the source link is preserved. If the source
block itself cannot fit, the answer is preserved and the reply explicitly says
the source link was omitted rather than emitting a broken partial URL.

- Never cite `#pluto` (`CitationPolicy.blockedChannelIds`)
- Never cite the bot's own prior answers
- Never cite a chunk whose `author_id` is opted out
- Never cite a source that was not actually retrieved

## Opt-out enforcement

Applied at **index time** (skip the message) and at **retrieval time** (drop
the chunk). Both filters are required; one is not sufficient.

## What is not decided here

- Chunk size tuning — after P2 has real query data
- Reranking — not in v1
- Embedding re-index strategy on model change — deferred
- A live full-corpus reindex and a production index rebuild — planned but not
  executed; see `STATE.md` for pending manual approvals.
