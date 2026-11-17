# Background jobs contract

Owner: Likhith proposes; Khushi approves.
Status: approved 2026-11-13; revised 2026-11-17 to add `send-meeting-reminder` and mark transcript indexing legacy/deferred.
Consumers: L1 (GitHub indexing), L3 (meeting reminders), P3 (`/digest` scheduling), Khushi (shared worker startup).

## Runtime

- The worker runs in the same Node process as the Discord bot.
- Started from `src/cmd/pluto/index.ts` via `startBackgroundJobs()`.
- pg-boss runs in polling mode (`useListenNotify: false`) because `DATABASE_URL`
  points at the Neon pooler. Job pickup latency ~30s is acceptable.
- Queue creation and worker registration are separate steps. **Creating a queue
  without registering a processor does not process jobs.** Every active queue
  must have a `boss.work(...)` (or version-appropriate) handler.
- Shared worker startup is Khushi's integration point. Likhith supplies the
  meeting-reminder registration; Pragathi supplies digest scheduling. Neither
  developer replaces the existing GitHub startup path.

## Existing implementation note (verified 2026-11-17)

The current code creates the `index-github-issues` and `index-transcript`
queues. GitHub indexing is currently invoked directly at startup and every
30 minutes through an in-process interval, and the whole-corpus refresh runs on
a 6-hour interval. No `boss.work` processor is currently registered for either
existing queue; the transcript upload workflow is legacy/deferred. This is a
pre-existing condition, not a pattern to copy. The new meeting-reminder queue
**must** register an actual worker.

## Queues

| Queue | Payload | Schedule | Policy | Status |
|-------|---------|----------|--------|--------|
| `index-github-issues` | `{}` | on startup + every 30 min | singleton, retryLimit 3, retryBackoff | Existing; currently run via in-process interval, no `boss.work` processor; preserve cadence |
| `index-transcript` | `{ meetingId, title, content, source, sourceUrl?, audioFilename?, audioDurationSeconds?, language?, transcribedAt? }` | on upload | singleton, retryLimit 3, retryBackoff | **Legacy/deferred** — no active v1 upload workflow |
| `send-meeting-reminder` | `{ meetingId: string, eventVersion: number }` | `start_at - 1 hour` | singleton key, retryLimit 3, retryBackoff, registered worker | **New in v1 (L3)** |

Queues are created explicitly at startup before any `send`/`schedule` call.

## `send-meeting-reminder` — required behaviour

### Payload

```ts
interface SendMeetingReminderPayload {
  meetingId: string;   // meeting_events.id (UUID)
  eventVersion: number; // event_version at scheduling time
}
```

The payload contains no title, time or channel ID that could become stale. The
worker reads the current event from the database.

### Scheduling

- After a meeting is confirmed, schedule the reminder for `start_at - 1 hour`.
- If `start_at - 1 hour` is already in the past but `start_at` is still in the
  future, schedule immediately and tell the announcer.
- If the meeting start is already in the past, do not schedule.
- Use pg-boss `startAfter` for the due time.
- Use a stable singleton key (for example `meeting:<id>:v<version>`) to prevent
  duplicate queued jobs for the same event version.
- Do not use in-memory `setTimeout()` for production reminders.

### Worker flow

1. Read the current `meeting_events` row.
2. Verify it exists and `status === 'confirmed'`.
3. Verify the payload `eventVersion` equals the current `event_version`.
4. Verify `reminder_sent_at IS NULL`.
5. Claim delivery with a conditional database update. Only one worker may win.
6. Send the reminder to the configured `#pluto` channel.
7. Persist `reminder_sent_at` and `reminder_message_id`.
8. If the event is cancelled, completed, has a different version, or was already
   reminded, acknowledge the job and do nothing.

### Cancellation and rescheduling

- **Cancellation:** set `status = 'cancelled'` and increment `event_version`.
  Pending jobs with the old version become no-ops.
- **Rescheduling:** update `start_at`, increment `event_version`, keep
  `status = 'confirmed'`, and schedule a new reminder. The old job becomes a
  no-op.
- Do not rely on deleting a job from the queue. Version and status validation is
  the authoritative invalidation mechanism and survives restarts.
- A reminder already delivered cannot be un-sent. Do not edit the old message.

### Startup recovery

On startup, after the queue and worker are ready:

1. Find `confirmed` events with `reminder_sent_at IS NULL` and `start_at > now()`.
2. Ensure a reminder job exists for the current event version.
3. Schedule at `max(now, start_at - 1 hour)` if missing.
4. Use the singleton key so restarts do not multiply jobs.

Reconciliation is idempotent and must not send reminders itself.

### Stale and late jobs

- A job that runs at or after `start_at` must **not** post a misleading
  one-hour reminder. Log the skip and mark the event `completed` where
  appropriate.
- A job for a cancelled/completed event or an older version is acknowledged and
  discarded.
- Meetings less than one hour away are confirmed normally and reminded
  immediately with wording that does not claim a full hour remains.

### Concurrency

- Use a conditional claim, for example:
  `UPDATE meeting_events SET reminder_claimed_at = now() WHERE id = $1 AND status = 'confirmed' AND event_version = $2 AND reminder_sent_at IS NULL AND (reminder_claimed_at IS NULL OR reminder_claimed_at < now() - interval '10 minutes') RETURNING *`.
- Only the worker that receives a row proceeds to send.
- A claim left by a crash expires and may be retried.
- A stale claim is a recovery mechanism, not proof against duplicate delivery.

### Retries and failure behaviour

- Database failure before sending: throw; pg-boss retries. No message is sent.
- Discord API failure: throw; pg-boss retries. Clear or let the claim expire.
- Process restart: the job persists in PostgreSQL and is retried after startup.
- After `retryLimit` is exhausted, log the failure without leaking content or
  secrets. The event remains unreminded; operators can inspect it. Do not mark
  it delivered.

### Honest delivery guarantee

The reminder flow is **at-least-once**, not exactly-once.

- pg-boss persists jobs and retries failures.
- If Discord accepts the message but the process crashes before persisting
  `reminder_sent_at`, a retry can post a duplicate.
- If Discord fails, the reminder is delayed until a retry succeeds; if the
  meeting starts first, the late job is skipped rather than posted misleadingly.

The implementation, tests, UI and documentation must not claim exactly-once
Discord delivery.

## Retries

- 3 attempts, exponential backoff.
- After 3 failures the job is marked failed and the next scheduled run retries
  where applicable.
- Meeting reminders are not recreated merely by another bot restart unless the
  startup reconciliation finds a confirmed, unsent, future event.

## Idempotency

- Re-indexing upserts on `github_id` (issues) and `source_id + chunk_index`
  (`search_chunks`).
- Meeting events are unique on `(guild_id, channel_id, source_message_id)`.
- Re-runs must not create duplicates.
- Jobs are singleton: no two index runs or reminder deliveries for the same
  event version should overlap.

## Configuration

- The GitHub org comes from `.planning/config.json` → `github.org`.
  No hardcoded org string in source.
- `#meeting-plans` and `#pluto` IDs come from
  `.planning/config.json` → `planning.discord`; no hardcoded channel IDs.
- The meeting timezone is `Asia/Kolkata`.
- `DATABASE_URL` comes from the environment.

## Failure visibility

- Job failures log to stdout and, where appropriate, post to `#pluto-bot`.
- No writes to GitHub or Discord history; only new bot messages.
- Never log message content beyond what is necessary, tokens, or `.env` values.

## Deferred / legacy

- `index-transcript` and the upload route are retained L2 code, not an active v1
  workflow. Do not delete them as part of the meeting-announcer work.
- Transcript summaries, action items and `/meeting actions` are deferred with
  MEET-01 and have no queue here.
- The GitHub indexing cadence (startup + 30 minutes) and the whole-corpus refresh
  interval (6 hours) are preserved.

---

*Last updated: 2026-11-17 — added the durable `send-meeting-reminder` queue, delivery/recovery rules and the honest at-least-once guarantee; marked transcript indexing legacy/deferred.*
