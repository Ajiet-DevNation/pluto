# GitHub Corpus Pruning Proposal

**PROPOSED — NOT IMPLEMENTED — REQUIRES DATABASE OWNER APPROVAL**

This document describes a safe design for reconciling Pluto's stored GitHub
corpus with the current public repository inventory. It is documentation only.
No pruning or corpus-audit SQL has been executed as part of this proposal, and
no database writes, pruning, or reindexing have been performed. No GitHub API
calls were made as part of the pruning proposal. Earlier, separate read-only
service smoke testing and repository verification were performed; those
activities did not authorize corpus pruning. No migration or schema change is
included in this proposal.

## Context

GitHub indexing currently writes:

- `repositories` rows, keyed by stable `github_id`;
- `issues` rows linked to `repositories.id` with `ON DELETE CASCADE`;
- `search_chunks` rows linked only by the repository name encoded in
  `source_id`.

`search_chunks` has no foreign key to `repositories`. GitHub chunk source IDs
use `owner/repo#...` for issues, pull requests, READMEs, files, and
contributors, and `owner/repo@...` for commits.

The refresh path only upserts current results. It does not delete records for a
repository that has become private, been deleted, or been renamed. The database
also has no visibility column, so a current public repository inventory is
required to distinguish "private/deleted" from "never indexed."

## Required design

1. **Use `github_id` as the stable identity.** Repository names can change;
   `github_id` does not. `full_name` is not unique in the current schema and must
   never be the sole identity for pruning.

2. **Require a complete public-repository inventory.** Fetch every page of the
   organization's public repository inventory with a public-only API
   configuration and defensively reject `private === true`. Abort if pagination
   is incomplete, any request fails, or the result cannot be reconciled with the
   expected organization. Do not prune from a partial inventory.

3. **Run an initial read-only audit.** Record stored repositories, repository
   IDs, full names, chunk counts, issue counts, duplicate-name rows, orphan
   chunks, and the classification against the current public inventory. Use a
   read-only database session and report counts before any write is considered.

4. **Restrict pruning to `source_type = 'github'`.** Discord, meeting, and Miro
   chunks are outside this proposal and must never be deleted by this process.

5. **Match source IDs with precise prefixes.** For a stored repository, match
   `lower(source_id)` against the lowercased full name followed by a `#` or `@`
   boundary. Never use broad `LIKE 'repo%'` matching, which could affect another
   repository whose name shares a prefix.

6. **Handle renamed and departed repositories separately.**
   - **Renamed:** locate the existing row by `github_id`; update repository
     metadata to the current `full_name`, `name`, `owner`, and `html_url`;
     update affected issue metadata; remove chunks whose source IDs use the old
     full name; then reindex under the new name.
   - **Departed:** remove associated GitHub chunks, issues, and the repository
     row only after explicit database-owner approval. Repository deletion should
     occur after its chunks and issues are handled, and the operation must not
     affect non-GitHub sources.

7. **Generate dry-run counts.** Report counts per repository, source-id prefix,
   chunk count, issue count, and classification (current, renamed, departed,
   duplicate-name ambiguity, orphan chunk). Dry-run output must be reviewed
   before an approved write.

8. **Use transactional, idempotent deletion.** Perform an approved prune in a
   transaction, with pre-audit and post-audit results. A repeated run must not
   delete unrelated data or produce a different result merely because the first
   run partially completed. Abort on unexpected counts.

9. **Fail closed.** Abort on incomplete inventories, unexpected counts,
   duplicate-name ambiguity, database errors, API errors, or any inconsistency
   between the approved plan and the observed rows. A failed audit must not be
   interpreted as proof that data is safe to delete.

10. **Keep audit reports and approval records outside the database.** Store
    evidence in an approved plain-text/JSON report and record who approved which
    classification and deletion scope. Do not add an audit table or change the
    schema as part of this proposal.

## Existing rename bug

`src/db/index-github-issues.ts` does not update an existing repository row after
a rename. It looks up a repository by `github_id` and only inserts when no row
exists. If the repository already exists under the old `full_name`, that row is
kept unchanged and becomes stale.

Consequences include:

- `repositories.full_name` remains the old name;
- issue rows remain linked to the old repository row;
- new chunks may use the new full name while old chunks retain the old name;
- an audit that joins only on `full_name` can miss or misclassify both sets.

This must be corrected as part of the approved rename-reconciliation design, not
worked around with name-only pruning.

## Safety boundary

- No implementation is included here.
- No pruning or corpus-audit SQL has been executed as part of this proposal.
- No database writes, pruning, or reindexing have been performed.
- No GitHub API calls were made as part of the pruning proposal.
- Earlier, separate read-only service smoke testing and repository verification
  were performed. Those activities did not authorize corpus pruning.
- No pruning, reindexing, backfill, migration, or schema change is authorized by
  this document.
- Database-owner approval is required before any implementation or write.
