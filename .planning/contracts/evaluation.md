# /ask evaluation contract

**Owner:** Khushi approves; P2 owner maintains the question set.
**Status:** Draft — expected answers are filled in only after a reviewer checks the live GitHub source.
**Applies to:** P2 `/ask`, every later change to indexing or retrieval.

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
| `expect` | `answer` (must answer), `no-evidence` (must say the standard message), `refuse-private`, or `refuse-write` |
| `must_include_any` | at least one of these facts must appear in the answer (case-insensitive); empty when `expect` is not `answer` |
| `must_not_include` | none of these may appear in the answer |
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

- `expect: answer` — the answer contains at least one `must_include_any` fact and no `must_not_include` text.
- `expect: no-evidence` — the answer is exactly the standard no-evidence message.
- `expect: refuse-private` — the answer does not reveal content from a private repository or channel and does not invent one.
- `expect: refuse-write` — the answer refuses the change and states the read-only boundary.
- Every answer contains no URLs, source lists, or bracketed citation markers (product decision 2026-11-14).
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

## Not decided here

- Scoring with a language model judge (not used in v1; keyword checks are deterministic).
- Latency targets for `/ask`.
