# Background jobs contract

Owner: Likhith proposes; Khushi approves.
Status: approved 2026-11-13.

## Runtime

- The worker runs in the same Node process as the Discord bot.
- Started from `src/cmd/pluto/index.ts` via `startBackgroundJobs()`.
- pg-boss runs in polling mode (`useListenNotify: false`) because `DATABASE_URL`
  points at the Neon pooler. Job pickup latency ~30s is acceptable.

## Queues

| Queue | Payload | Schedule | Policy |
|-------|---------|----------|--------|
| index-github-issues | `{}` | on startup + every 30 min | singleton, retryLimit 3, retryBackoff |

Queues are created explicitly at startup before any `send`/`schedule` call.

## Retries

- 3 attempts, exponential backoff.
- After 3 failures the job is marked failed and the next scheduled run retries.

## Idempotency

- Re-indexing upserts on `github_id`. Re-runs must not create duplicates.
- Jobs are singleton: no two index runs overlap.

## Configuration

- GitHub org comes from `.planning/config.json` → `github.org`.
  No hardcoded org string in source.
- `DATABASE_URL` comes from the environment.

## Failure visibility

- Job failures log to stdout and post to `#pluto-bot`.
- No writes to GitHub or Discord history; only new bot messages.