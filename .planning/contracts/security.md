# Security Contract

**Contract:** #9 — Security
**Owner:** Khushi
**Status:** Active (approved for K2)
**Applies to:** all PRs (K, P, L)
**Source:** `.planning/PR-PLAN.md` contract #9

---

## 1. Read-only boundary

### GitHub
- Only `GET` endpoints may be called.
- Allowed: repositories, issues, pull requests, commits, contents, metadata.
- Forbidden: creating, updating or deleting issues, PRs, comments, reviews, refs, files, releases, webhooks, or repository settings.

### Miro
- Only read operations: boards, items, texts, comments, diagrams.
- Forbidden: creating, updating or deleting boards, items, or comments.

### Discord
- No edits or deletions of existing messages or history.
- Posting new messages (answers, notifications, digests) is permitted.
- No indexing of channels outside the configured allowlist.

### Scope
- Only public Ajiet-DevNation repositories are indexed.
- Only admin-selected Discord channels are indexed.
- Private repositories and private channels are never indexed.

## 2. Enforcement — two independent layers

The boundary holds only if both layers hold. Neither is sufficient alone.

### Layer 1 — code guard
- GitHub and Miro access is exposed through narrow interfaces (`GitHubReader`, `MiroReader`) containing read methods only.
- `src/guardrails/read-only.ts` wraps each client in a Proxy that throws `ReadOnlyViolation` for any property not on the read allowlist, and for any `set`, `deleteProperty` or `defineProperty` operation.
- The request helpers take **no HTTP method parameter**. `GET` is hardcoded, so a write cannot be expressed.
- Raw clients are not exported outside `src/github/**` and `src/miro/**`.

### Layer 2 — credential scope
- The GitHub credential used by the bot must be read-only: a fine-grained PAT with `Public repositories (read-only)`, or a GitHub App with Metadata/Contents/Issues/Pull requests set to Read.
- The developer `gh` CLI token (`repo` scope, write-capable) must never be used by the bot.
- Missing credentials **throw**. A client must never return an empty result when unconfigured, because that is indistinguishable from "configured, found nothing".

### Tests
- Unit tests assert that write methods and unknown properties throw.
- A static scan asserts no write verbs appear in `src/github/**` or `src/miro/**`.
- Live verification records the read and write HTTP status codes.

## 3. Opt-out

- `/optout` excludes a member's messages from indexing and retrieval.
- Enforced as a filter at retrieval time and skipped at index time.
- Source messages are never deleted or modified.
- Opted-out content must not appear in `/ask` answers, `/decisions` results, or citations.

## 4. Evidence-only answers

- `/ask` answers only from retrieved indexed chunks.
- If retrieval returns no chunk above the relevance threshold, respond with the standard no-evidence message.
- The model must never fall back to general knowledge.

Standard no-evidence message:

> I couldn't find evidence for that in the indexed sources (GitHub, Discord, Miro, meeting transcripts).

## 5. Citations

- Product decision 2026-11-14: `/ask` answers are displayed without visible source links, source footers, or citation markers. Evidence grounding, opt-out filtering and blocked-channel filtering still apply before generation.
- Supported formats:
  - GitHub: commit, pull request, or issue URL
  - Discord: `https://discord.com/channels/{guild}/{channel}/{message}`
  - Miro: board URL
  - Meeting: link to the stored transcript
- The bot's own output channel (`#pluto`) and prior bot answers are never used as citations. This is enforced in code by `CitationPolicy.blockedChannelIds`, not by convention.
- **Bot-authored messages are never indexed or cited, in any channel.** The rule is about authorship, not location. `#pluto` is blocked because it contains only bot output; other channels are filtered by `author.bot` at index time.
- `#pluto-bot` is excluded from v1 retrieval as an operational log channel. Revisit post-v1 with a bot-author filter if its human discussion proves worth searching.

## 6. Secrets

- Tokens and keys live only in environment variables.
- Never committed, never logged, never echoed in error messages or thrown exception text.
- `.env` stays gitignored; `.gitignore` covers `.env*` with an exception for `.env.example`.
- `.env.example` contains placeholders only.

## 7. Configuration, not code

- The channel allowlist, output channel, repository allowlist and board allowlist are configuration.
- Changing them must not require a code change.

## 8. Verification

- Unit tests cover the read-only guard and citation builders.
- Static check confirms no write verbs in `src/github/**` or `src/miro/**`.
- Live GitHub verification: `GET /repos/Ajiet-DevNation/pluto` returns `200`; `POST /repos/Ajiet-DevNation/pluto/issues` returns `403`.
- Live Miro verification is **pending** — no token and no board allowlist exist yet.

---

## Open items

| Item | Status |
|------|--------|
| Miro access | `pending` — no token, no MCP server, no board allowlist. Client implemented against the read-only REST API with mocked tests; live verification deferred. |
| GitHub App | `pending` — requires Ajiet-DevNation org owner. Interim read-only fine-grained PAT in use. |
| Discord indexing method (webhooks vs polling) | `pending` |
| Cloudflare Workers AI credential owner | **resolved** — provisioned by Khushi, 2026-11-13. Workers AI: Read token, verified against live API. Details in `config.json`. |
| Cloudflare R2 audio storage | `pending` |
