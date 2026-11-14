# GitHub Integration Contract

**Contract:** #4 — GitHub access and source indexing
**Owner:** Khushi
**Status:** Draft for review as part of the P2 indexing fix
**Applies to:** K1, L1, P2, L3, and GitHub-backed search

## Authentication

- Preferred production credential: the Ajiet-DevNation-owned, read-only GitHub App.
- App ID and installation ID are configuration values; the PEM private key is a
  secret and must be supplied through a protected key file or deployment secret.
- `@octokit/app` issues and refreshes installation tokens. The repository reader
  obtains a current bearer token through an async provider, not a cached static
  token string.
- A read-only fine-grained PAT remains a temporary fallback. `GITHUB_AUTH_MODE`
  selects `app`, `pat`, or `auto`; missing or invalid credentials fail closed.
- The GitHub App's Client ID is for user OAuth and is not needed for
  server-to-server installation-token authentication.

## Permission and repository boundary

- Required repository permissions: Contents, Issues, and Pull requests —
  **Read-only**; Metadata is read-only as required by GitHub.
- The installation is configured for selected repositories; GitHub also makes
  public repositories available read-only. Pluto indexes **public repositories
  only**, with both `type=public` API discovery and a `private === false` check.
- Private repositories must never be indexed, even if credentials later gain
  access to them.
- Webhooks are disabled for v1. PR notification behavior is polling-based.

## Indexed GitHub content

P2's manual reindex discovers all public organization repositories with
pagination, then indexes paginated issues, pull requests, commits, contributor
identities/counts, each repository's README, and eligible text/source files
from its default branch.
File exclusions and size limits are defined in `.planning/contracts/search.md`
and `src/search/github-sources.ts`. The command fails visibly on missing
credentials, API errors, or truncated repository trees rather than claiming a
complete index.

All GitHub source requests are GET-only. GitHub App installation-token creation
is authentication, not a write to a repository. The PAT remains available until
the App path passes live verification.
