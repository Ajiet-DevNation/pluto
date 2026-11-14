# Search contract

Owner: Khushi owns. Approved 2026-11-13.
Consumers: L1/L2 (storage + indexing), P2 (`/ask`), P3 (`/digest`), L3 (`/decisions`).

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

## Retrieval

`/ask` uses hybrid retrieval, then applies the evidence gate:

1. Embed the query with the same model (768 dims).
2. Vector similarity search over `embedding` — top 20 candidates.
3. Full-text search over `search_vector` — top 20 candidates.
4. Merge by `source_id`, take the best score per chunk.
5. Apply `gateEvidence(chunks, EVIDENCE_MIN_SCORE)` from `src/guardrails/evidence.ts`.

If step 5 returns `ok: false`, the answer is `NO_EVIDENCE_MESSAGE` and **the
generation model is never called**. That is the read-only, no-general-knowledge
boundary in `contracts/security.md` §4.

### Relevance threshold

- Config key: **`EVIDENCE_MIN_SCORE`**
- Owner: **this contract**. `src/guardrails/evidence.ts` only reads it and
  throws if it is missing or non-numeric.
- v1 starting value: **`0.4`**
- The value is tuned after P2 ships against real queries. It is not final.

### Score normalization (P2 live calibration, 2026-11-14)

Raw `bge-base-en-v1.5` cosine similarities have a high baseline: unrelated
project text commonly scores around `0.5–0.65`. Applying `0.4` directly to raw
cosine therefore admitted almost every chunk and defeated the no-evidence gate.

The store converts raw scores to a calibrated `0..1` relevance before the gate:

```text
vector_relevance   = clamp((cosine - 0.5) / 0.5, 0, 1)
full_text_relevance = rank > 0 ? clamp(0.4 + 2 * rank, 0, 1) : 0
```

Consequences:

- `EVIDENCE_MIN_SCORE=0.4` corresponds to raw cosine `0.70`.
- Any non-zero full-text match clears the threshold; vector search remains the
  semantic path for paraphrases.
- The calibration is recorded in `src/search/relevance.ts` with unit tests. It
  is a scoring normalization, not a change to the configured threshold.

## Citations

Every retrieved chunk carries `source_url`, built by the builders in
`src/citations`. Retrieved chunks that pass the gate ground the answer internally.
Product decision 2026-11-14: `/ask` replies do not display source links, source
footers, or citation markers. Source URLs remain evidence metadata for retrieval,
opt-out and blocked-channel enforcement, and audit.

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
