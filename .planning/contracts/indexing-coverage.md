# GitHub indexing coverage

**Owner:** Khushi approves; P2 owner implements.
**Status:** Draft. Describes what P2 indexes today, what it does not, and the order of the next steps.
**Related:** `contracts/github.md`, `contracts/search.md`, `contracts/evaluation.md`

## Principle

`/ask` can only answer from what is indexed. "Any question about any repository"
therefore means: every category of public repository content that answers a
plausible question is indexed, and every gap is either closed or listed here.
Coverage is measured with the evaluation set, not assumed.

## Covered today (P2 branch)

| Source | Scope | Stable source id | Citation URL (internal) |
|--------|-------|------------------|-------------------------|
| Repositories | every public org repo, paginated, private excluded | — | — |
| README | default branch, one per repo | `owner/repo#readme` | README blob URL |
| Repository files | default branch, text/source extensions, ≤128 KiB, sensitive/generated paths and content excluded | `owner/repo#file:<sha256(path)>` | blob URL |
| Issues | all states, title + body, paginated | `owner/repo#<number>` (L1 table) | issue URL |
| Pull requests | all states, title + body, paginated | `owner/repo#pr-<number>` | PR URL |
| Commits | default branch, message, paginated | `owner/repo@<sha>` | commit URL |
| Contributors | public contributor logins and counts | `owner/repo#contributor:<login>` | `/graphs/contributors` |

## Known gaps

| Gap | Effect on answers | Planned fix | Priority |
|-----|-------------------|-------------|----------|
| Issue and PR **comments** and review comments are not indexed | decisions made in discussion threads are missed | index comments as chunks linked to their parent issue/PR | high |
| Files over 128 KiB are skipped | long documents and large configs are missed | chunk large files by line ranges up to a hard byte cap | medium |
| Non-listed file types (images, PDFs, notebooks, binaries) | docs stored as PDF are missed | text extraction only where a safe parser exists; otherwise listed as unindexed | low |
| Only the default branch is indexed | feature-branch work is missed | index open PR head branches for files changed in that PR | medium |
| Commit **diffs** are not indexed, only messages | "what changed in X" answers can be vague | index diff hunks for commits touching allowlisted file types, capped in size | medium |
| Releases, tags, GitHub Discussions, wiki | release notes and discussions are missed | index releases first; discussions and wiki later if enabled | medium |
| Contributor answers depend on a fresh reindex | an old index shows no contributors | make reindex part of the scheduled job, not manual only | high |
| Retrieval returns a small set of chunks | aggregate questions ("list all X") are under-answered | add a structured path for contributor and repository-listing questions | high |
| Freshness: full-corpus refresh runs every 6 hours; issues also refresh every 30 minutes | a very large corpus may need multiple budgeted passes | monitor completion and tune only within the free-tier budget | medium |
| Cloudflare free quota can be consumed by other account workloads | a run can stop before all sources are indexed | persist the daily reservation/pause, resume from saved chunk hashes, and leave quota headroom | high |

## Order of work

1. Keep the full reindex part of the scheduled job, verify it across all public repositories, and add the contributor and repository-listing query path.
2. Index issue and PR comments.
3. Index releases and open PR head branches.
4. Chunk large files and index commit diffs under size caps.
5. Re-run the evaluation set after each step; each step must not reduce the accepted pass rate.

## Limits we keep

- Private repositories are never indexed, even if credentials could read them.
- Binary and secret-like content is never indexed.
- Every indexed item has a stable id so reindexing upserts rather than duplicates.
- Coverage is limited to public DevNation repositories visible to the GitHub App installation.
