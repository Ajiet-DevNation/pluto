# Meeting contract

**Contract:** #8 — Meeting (Automatic Meeting Announcer)
**Owner:** Likhith proposes; Khushi approves
**Status:** Drafted 2026-11-17 — review and approval pending. This contract describes required behaviour; it does not mean the feature is implemented.
**Consumers:** L3 (announcer implementation), Khushi (shared Discord/worker integration), P3 (`/digest` may use `#decisions` evidence but not this module), CP5.
**Sources:** `.planning/PROJECT.md`; `.planning/REQUIREMENTS.md` → MEET-02; `.planning/ROADMAP.md` Phase 5; `.planning/config.json`; `contracts/discord.md`; `contracts/database.md`; `contracts/background-jobs.md`; `contracts/security.md`.

---

## 1. Purpose and scope

Pluto automatically detects meeting announcements in the configured `#meeting-plans` channel, understands the meeting date and time, asks the original announcer to confirm when needed, stores the confirmed event, and posts one reminder in `#pluto` one hour before the meeting.

This is a **message-detection and confirmation feature**, not a slash-command feature. It introduces no new Discord command and no transcript workflow.

### In scope

- Detection of new human-authored announcements in `#meeting-plans`.
- Actual Discord `@everyone`/`@here` mention validation plus meeting-related language.
- Deterministic date/time parsing in `Asia/Kolkata`.
- Confirmation, cancellation and controlled rescheduling by the original announcer or an authorized moderator.
- Persistent `meeting_events` storage with versioning and unique source identity.
- Durable pg-boss reminder scheduling and delivery to `#pluto`.
- Restart recovery, idempotency and honest failure handling.

### Out of scope

- `/decisions`, `/meetings`, `/meeting upload`, `/meeting actions`, or any new slash command.
- Meeting audio or transcript upload.
- Whisper transcription as a new user-facing workflow.
- Transcript-derived summaries or action items.
- Voice-channel recording or voice-channel indexing.
- Editing or deleting the original announcement.
- Posting reminders in any channel other than `#pluto`.
- Broadening the Discord indexing allowlist.
- Scanning historical `#meeting-plans` messages the bot did not observe.

---

## 2. Announcement detection

### 2.1 Source

- Detection considers only the configured `#meeting-plans` channel ID from `.planning/config.json` (`planning.discord.indexed_channels["#meeting-plans"]`, currently `1570872485933752502`).
- No channel ID is hardcoded in application code. Adding or renaming the channel is a configuration change.
- Detection uses the existing Discord gateway message stream. It does not add a second bot, webhook intake, polling loop or history crawl.
- No historical catch-up is required in v1: an announcement posted while Pluto is offline may be missed. This limitation is documented; the announcer must not silently claim otherwise.

### 2.2 Required filters (all must pass)

1. `guildId` equals the configured guild.
2. `channelId` equals the configured `#meeting-plans` ID.
3. The message is not a system message.
4. The author is human: `author.bot === false` and `author.id !== client.user.id`.
5. The message content is non-empty.
6. The message carries an actual Discord `@everyone` or `@here` mention, verified from Discord mention metadata (for discord.js, `message.mentions.everyone === true` covers both). Plain text that merely spells `@everyone`/`@here` without mention metadata does **not** qualify.
7. The message contains meeting-related language (for example meeting, meet, standup, sync, call, review, session, discussion). Matching is case-insensitive and word-bounded.
8. The author is not opted out.

Other channels, bot-authored messages, ordinary conversation about meetings without a real mention, and unrelated announcements are ignored.

### 2.3 Independence from indexing

- The announcer is a separate module with its own detection entry point and error boundary.
- The ordinary Discord indexing pipeline keeps its existing allowlist, filters, backfill cursor and storage behaviour.
- A detection or parsing failure must not block indexing. An indexing failure must not block detection.
- The announcer never broadens the indexed-channel allowlist and never indexes voice channels.
- The `#decisions` channel and its records are unaffected.

### 2.4 Duplicate announcements

- The source announcement identity is unique: one Discord message can create at most one event row.
- Re-detecting the same message (for example after a reconnect) must not create a second event. It may update the existing `pending` row only if it has not been confirmed.
- A repeated announcement message from the same member is a separate source message and may create a separate event only if it is a genuinely different message; operators should use cancellation if it is a duplicate in content.

---

## 3. Date and time parsing

### 3.1 Extracted fields

Where available, the parser extracts:

- Meeting title or description.
- Meeting date.
- Meeting start time.
- Original announcement message ID and URL.
- Announcing member ID.

Missing or ambiguous date/time information is never silently guessed.

### 3.2 Timezone

- The configured timezone is **`Asia/Kolkata`** (UTC+05:30, no daylight saving).
- Input is interpreted in `Asia/Kolkata`, independent of the server's local timezone.
- `start_at` is persisted as a timezone-aware PostgreSQL `timestamptz`.
- Confirmation displays the timezone explicitly.

### 3.3 Relative dates

- Relative expressions (`today`, `tomorrow`, `day after tomorrow`, weekday names) are resolved from the **original announcement message's `createdAt`**, not from the time a delayed job or restart processes the message.
- A bare weekday resolves to the next occurrence after the message date. If the weekday is the message's own day, the choice between today and next week is ambiguous and must be clarified.
- The parser must not use the current wall-clock time to reinterpret the original date. The confirmation step may separately reject a start time that is already in the past.

### 3.4 Supported expressions (minimum)

| Expression | Behaviour |
|------------|-----------|
| `Tomorrow at 4 PM` | Date = next day; time = 16:00 |
| `Friday at 10:30 AM` | Next Friday; time = 10:30 |
| `Today at 5` | Date recognised; **time is ambiguous (05:00 or 17:00)** → ask |
| `18 November at 3 PM` | 18 November in `Asia/Kolkata`; time = 15:00 |
| `18/11 at 15:00` | Day-first numeric date; 24-hour time |
| `November 18, 2026 at 10:30` | Explicit date; `10:30` without AM/PM is ambiguous and must be clarified |

Additional deterministic formats may be supported, but every new format must be tested and documented here.

### 3.5 Ambiguity and invalid input

Ask the original announcer to clarify when:

- no date is present;
- no time is present;
- only a bare 1–12 hour is present without AM/PM or 24-hour context;
- a numeric date could be read in more than one order;
- the weekday is the message's own day;
- the resolved date/time is in the past relative to the announcement;
- the time is invalid (for example `25:00` or `13 PM`);
- a timezone other than the configured one is implied.

The clarification reply must state what is missing or ambiguous. It must not schedule a reminder from a guess.

### 3.6 Past and near-term meetings

- A start time already in the past is rejected with a clarification request.
- A meeting scheduled less than one hour away is valid: confirmation states that the reminder will be posted immediately (or that the one-hour window has already begun).
- A start time equal to or before the reminder-processing time is not given a misleading "starts in one hour" reminder; see §7.6.

---

## 4. Confirmation and authorization

### 4.1 No automatic event

A detected announcement is a **candidate**, not a confirmed meeting. No reminder is scheduled until confirmation.

### 4.2 Confirmation response

The response must contain:

- Meeting title.
- Date.
- Time.
- Timezone (`Asia/Kolkata`).
- Reminder time (`start_at - 1 hour`, or "immediately" when less than one hour away).
- A link to the original announcement.

It must provide confirmation and cancellation controls, plus a controlled way to submit corrected date/time details.

### 4.3 Authorization

- Only the original announcer (`created_by`) or an authorized moderator may confirm, cancel or reschedule.
- The moderator rule must use a server permission already available to the bot (for example Manage Guild or Manage Messages); do not grant new permissions.
- Any other member receives an ephemeral refusal.
- No member may change another member's event.
- Multiple confirmations are idempotent.

### 4.4 No new slash command

- Do not create `/meetings`, `/meeting`, `/meeting upload`, `/meeting actions` or `/decisions`.
- Use message components (buttons/selects/modals) or a reviewed interaction handler.
- Discord interaction routing is a shared file. Likhith exports the handler; Khushi wires it into `src/discord/bot.ts` and the command registry.

---

## 5. Event database lifecycle

### 5.1 Table

Events are stored in a new `meeting_events` table created by a proper migration. The authoritative definition is `contracts/database.md`.

Minimum columns:

| Column | Purpose |
|--------|---------|
| `id` | UUID primary key |
| `guild_id` | Discord guild |
| `channel_id` | Source channel (must be `#meeting-plans`) |
| `source_message_id` | Original announcement message |
| `source_message_url` | Link to the original announcement |
| `created_by` | Announcing member ID |
| `title` | Meeting title/description |
| `start_at` | Timezone-aware start timestamp |
| `timezone` | `Asia/Kolkata` |
| `status` | `pending`, `confirmed`, `cancelled`, `completed` |
| `event_version` | Protects against obsolete scheduled jobs |
| `reminder_sent_at` | Delivery timestamp, set only after a successful send |
| `reminder_message_id` | Resulting Discord message ID, where available |
| `created_at`, `updated_at` | Audit timestamps |

Additional delivery-claim fields (for example `reminder_claimed_at`) may be added if needed to make concurrent delivery safe; they must be documented in the database contract.

### 5.2 Identity and versioning

- Unique identity: `(guild_id, channel_id, source_message_id)`. The same Discord message cannot create duplicate events.
- `event_version` starts at `1` and increments on every schedule-affecting change (reschedule, cancel). A reminder job carries the version it was scheduled for.
- A job whose `event_version` does not match the current row is obsolete and must do nothing.
- Do not create a second event table or a separate event identity system without documenting why.

### 5.3 State transitions

```text
detected, parsed, awaiting confirmation -> pending
pending  --confirm-->  confirmed   (schedule reminder at start_at - 1 hour)
pending  --cancel--->  cancelled
confirmed --cancel---> cancelled   (event_version++)
confirmed --reschedule--> confirmed (start_at updated, event_version++, new job)
confirmed --start passed / reminder handled--> completed
```

- A `pending` row exists only after the parser produced a concrete candidate date/time. If parsing is ambiguous, ask for clarification and do not create an event.
- `reminder_sent_at` is set only after Discord accepted the reminder.
- `completed` must not be set merely because a job was created.

### 5.4 Migration and legacy data

- Add the table through a new migration, never by editing an applied migration.
- Existing transcript tables (`meeting_transcripts`) and meeting search chunks are legacy/deferred and must not be dropped.
- This contract does not authorise a migration in the documentation task; it defines what L3 must implement.

---

## 6. Durable reminder scheduling

### 6.1 Queue

- Queue name: **`send-meeting-reminder`**.
- Payload: `{ meetingId: string, eventVersion: number }`.
- The queue is created at startup before any send/schedule call.
- A processor must be registered with the actual pg-boss worker mechanism (`boss.work(...)` or the version-appropriate equivalent). Creating a queue without registering a processor is not sufficient.

### 6.2 Schedule

- After confirmation, schedule the job for `start_at - 1 hour`.
- If that time is already in the past but the meeting is still in the future, schedule it immediately and tell the announcer.
- If the meeting start is already in the past, do not schedule.
- Use the existing pg-boss connection and polling configuration. No in-memory `setTimeout()` for production reminders.
- Use a stable singleton key derived from the meeting ID and event version to avoid duplicate queued jobs.

### 6.3 Delivery flow

1. Persist the confirmed event.
2. Schedule the reminder.
3. When the job executes, read the current event.
4. Verify it still exists and `status === 'confirmed'`.
5. Verify the scheduled `eventVersion` equals the current `event_version`.
6. Claim delivery safely (conditional database update; see §8).
7. Send the reminder to the configured `#pluto` channel.
8. Persist `reminder_sent_at` and the resulting `reminder_message_id`.

### 6.4 Reminder content

- Meeting title.
- Start time with `Asia/Kolkata`.
- Link to the original announcement.
- A clear statement that the meeting starts in one hour (or a corrected immediate wording for near-term meetings).
- No `@everyone` or `@here` ping. No mass mention.
- Do not re-post the full announcement or edit the original.

### 6.5 Registered worker requirement

Worker registration is shared code. Likhith provides and tests the registration function; Khushi integrates it into `src/jobs/worker.ts`. The startup path must prove the processor is registered, not just that the queue exists.

---

## 7. Cancellation, rescheduling, and stale jobs

### 7.1 Cancellation

- Authorized announcer/moderator can cancel.
- Set `status = 'cancelled'` and increment `event_version`.
- Pending jobs with an older version become no-ops.
- A reminder already delivered cannot be un-sent; the cancellation response must not claim it can.
- Never edit or delete the original announcement.

### 7.2 Rescheduling

- Authorized announcer/moderator submits corrected date/time details.
- Re-parse deterministically and require the same ambiguity rules.
- Update `start_at`, increment `event_version`, keep `status = 'confirmed'`, and schedule a new reminder.
- Old jobs with the previous version become no-ops.
- If a reminder was already sent for the old time, a new reminder may be sent for the new time; the old message remains and is not edited.

### 7.3 Stale jobs

A job whose event is cancelled, completed, has a different version, or has already been reminded is acknowledged and discarded with a structured log. It must not post anything.

### 7.4 Duplicate jobs

- Singleton keys reduce duplicates.
- Version and status checks remain the authoritative guard; a duplicate job must not produce a second reminder when the row is already marked sent.

### 7.5 Meetings less than one hour away

- Confirmation is still required.
- Schedule immediately; the reminder text must not falsely say "in one hour".
- If the meeting has already started by processing time, follow §7.6.

### 7.6 Job executes at or after the meeting start

- Do not post a misleading one-hour reminder.
- Log the late job safely.
- Mark the event `completed` where appropriate; do not claim a reminder was delivered.
- This must be tested.

---

## 8. Reliability, recovery and delivery guarantee

### 8.1 Explicitly handled cases

- Duplicate announcements → unique source identity.
- Duplicate scheduled jobs → singleton key + version/status checks.
- Concurrent worker execution → conditional claim; only one worker proceeds.
- Database failure → job fails and retries; no Discord send from a failed read.
- Discord API failure → job fails and retries; claim is released or expires.
- Process restart → pg-boss job persists; startup reconciliation re-schedules missing reminders for confirmed, unsent, future events.
- Rescheduled events with old jobs pending → old version no-ops.
- Cancelled events with jobs pending → old version no-ops.
- Jobs after event time → §7.6.
- Meetings less than an hour away → §7.5.
- Crash during reminder delivery → claim expires and a retry may occur; a duplicate is possible.

### 8.2 Honest delivery guarantee

The design provides **at-least-once** delivery, not exactly-once:

- pg-boss persists jobs in PostgreSQL and retries failures.
- A crash after Discord accepts the message but before `reminder_sent_at` is persisted creates a gap. The retry can post a duplicate reminder.
- Conversely, a Discord failure can delay a reminder until a retry succeeds, and a meeting that starts before retries complete is skipped rather than given a late misleading reminder.

The documentation and UI must not claim exactly-once Discord delivery. The recovery behaviour above is the guarantee.

### 8.3 Startup reconciliation

On startup, after the queue and worker are ready:

1. Find `confirmed` events with `reminder_sent_at IS NULL` and `start_at > now()`.
2. Ensure a reminder job exists for the current `event_version`; schedule it at `max(now, start_at - 1 hour)` if missing.
3. Use the singleton key so restart does not multiply jobs.

Reconciliation is idempotent and must not send reminders itself.

### 8.4 Logging

- Log meeting IDs, event versions, job IDs, statuses and error codes.
- Never log message content beyond what is necessary, never log tokens, never log `.env` values.
- Discord and database errors are isolated from the ordinary indexing worker and bot event loop.

---

## 9. Output and safety rules

- Reminders are posted **only** in the configured `#pluto` channel (`planning.discord.output_channel_id`).
- Do not ping `@everyone` or `@here` again.
- Never edit or delete the original announcement.
- Do not index Pluto's own reminder messages (`#pluto` is never indexed).
- Do not broaden the five-channel indexing allowlist.
- Do not index or record voice channels.
- Do not grant Mention Everyone or any new Discord permission.
- Do not add Redis, Docker, an external scheduler or a new AI provider for date parsing.
- Use deterministic, testable parsing. A missing or ambiguous value asks for clarification, never an AI guess.

---

## 10. Testing and acceptance

### 10.1 Test coverage

Unit tests:

- Mention metadata: real `@everyone`, real `@here`, text-only lookalike, no mention.
- Human vs bot author; correct vs other channel; empty/system message.
- Meeting-language requirement, including a mention with unrelated text.
- Date/time table: tomorrow, weekday, today, explicit date, 24-hour time, AM/PM, invalid time, past date, missing date/time, bare hour, numeric-date ambiguity, timezone conversion, meeting less than one hour away.
- Relative date uses message `createdAt`, not processing time.
- Confirmation payload contains title/date/time/timezone/reminder time/source link.
- Only original announcer or moderator can confirm/cancel/reschedule.

Integration tests:

- Migration applies cleanly; unique source identity; status/version constraints.
- Confirmation persists and schedules.
- Reminder job runs, posts to `#pluto`, and records `reminder_sent_at`/`reminder_message_id`.
- Cancellation invalidates the old job.
- Rescheduling invalidates the old job and schedules a new one.
- Duplicate/concurrent jobs produce at most one reminder under the claim rule.
- Restart reconciliation re-schedules a missing job without duplicating.
- Database failure and Discord failure retry and log safely.
- Job after start time skips delivery and logs.
- Existing `/ask` and `/optout` tests remain unaffected.

### 10.2 Acceptance criteria (MEET-02)

1. Meeting announcements are detected only in `#meeting-plans`.
2. Actual `@everyone` and `@here` mentions are checked correctly.
3. Bot-authored and unrelated messages are ignored.
4. Supported date/time expressions are parsed correctly.
5. Ambiguous information requires clarification.
6. Confirmation is required before scheduling.
7. Confirmed meetings are persisted.
8. Reminder jobs are durable across restarts.
9. One-hour reminders are delivered to `#pluto`.
10. Cancellation invalidates scheduled reminders.
11. Rescheduling invalidates the previous schedule.
12. Duplicate event creation and concurrent delivery are controlled.
13. Failures are logged safely and recovered where possible.
14. Existing `/ask` and `/optout` behavior remains unaffected.
15. Unit and integration tests pass.

### 10.3 Not evidence of completion

Writing this contract, the database definition or a plan does not complete MEET-02. Completion requires implementation, tests, and verified acceptance criteria, recorded in `STATE.md` and `REQUIREMENTS.md`.

---

## 11. Explicit exclusions

The following are **not** part of this contract or active v1, and must not be reintroduced merely because older documents mentioned them:

- `/decisions`.
- `/meetings` transcript search.
- `/meeting upload`.
- New meeting audio or transcript upload workflows.
- Meeting audio recording from Discord voice channels.
- Automatic user-facing Whisper transcription.
- Transcript-derived meeting summaries.
- Transcript-derived action items with owners or due dates.
- `/meeting actions` and its task-management workflow.

Existing upload/transcription code, `meeting_transcripts` rows and meeting search chunks are retained as legacy/deferred. They are not an active v1 deliverable and must not be deleted as part of this scope change.

---

## 12. Open items

| # | Item | Status |
|---|------|--------|
| 1 | Meeting contract approval | Pending Khushi review |
| 2 | Moderator permission choice (Manage Guild vs Manage Messages) | Pending Khushi approval |
| 3 | Exact meeting-language keyword list | Proposed in L3 implementation; must be tested and documented here before merge |
| 4 | Delivery-claim column (`reminder_claimed_at`) | Proposed; final schema subject to Khushi approval |
| 5 | Historical catch-up for announcements posted while Pluto was offline | Not in v1; documented limitation |

---

*Drafted 2026-11-17. This is a proposed contract, not an implemented feature.*
