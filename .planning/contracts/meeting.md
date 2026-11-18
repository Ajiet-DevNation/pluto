# Meeting contract (L3 MVP)

**Contract:** #8 — Meeting (Automatic Meeting Announcer)
**Owner:** Likhith proposes; Khushi approves
**Status:** Drafted 2026-11-17 — revised for MVP scope. This contract describes required behaviour; it does not mean the feature is implemented.
**Consumers:** L3 (announcer implementation), Khushi (shared Discord/worker integration).
**Sources:** `.planning/PROJECT.md`; `.planning/REQUIREMENTS.md` → MEET-02; `.planning/ROADMAP.md` Phase 5; `.planning/config.json`; `contracts/discord.md`; `contracts/database.md`; `contracts/background-jobs.md`; `contracts/security.md`.

---

## 1. Purpose and scope

Pluto automatically detects meeting announcements in the configured `#meeting-plans` channel, parses the meeting date and time deterministically in `Asia/Kolkata`, stores the confirmed event, and posts one reminder in `#pluto` one hour before the meeting.

This is a **message-detection and auto-scheduling feature**, not a confirmation or slash-command feature. It introduces no new Discord command, no confirmation buttons/modals, no cancel/reschedule controls, and no transcript workflow.

### In scope

- Detection of new human-authored announcements in `#meeting-plans`.
- Actual Discord `@everyone`/`@here` mention validation plus meeting-related language.
- Deterministic date/time parsing in `Asia/Kolkata`, anchored to the announcement's `createdAt`.
- Automatic event creation when parsing yields a valid future date/time.
- Simple explanatory reply when parsing fails (missing, ambiguous, invalid, or past).
- Persistent `meeting_events` storage with versioning and unique source identity.
- Durable pg-boss reminder scheduling and delivery to `#pluto`.
- Restart recovery, idempotency, duplicate-safe scheduling, and honest failure handling.

### Out of scope

- Confirmation buttons/modals, cancellation controls, rescheduling, moderator permission checks.
- `/decisions`, `/meetings`, `/meeting upload`, `/meeting actions`, or any new slash command.
- Meeting audio or transcript upload; Whisper as a new user-facing workflow.
- Transcript-derived summaries or action items.
- Voice-channel recording or voice-channel indexing.
- Editing or deleting the original announcement.
- Posting reminders in any channel other than `#pluto`.
- Scanning historical `#meeting-plans` messages the bot did not observe.

---

## 2. Announcement detection

### 2.1 Source

- Detection considers only the configured `#meeting-plans` channel ID from `.planning/config.json` (`planning.discord.indexed_channels["#meeting-plans"]`, currently `1570872485933752502`).
- No channel ID is hardcoded in application code.
- Detection uses the existing Discord gateway message stream. It does not add a second bot, webhook intake, polling loop or history crawl.
- No historical catch-up is required in v1: an announcement posted while Pluto is offline may be missed. This limitation is documented.

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

### 2.4 Duplicate announcements

- The source announcement identity is unique: one Discord message can create at most one event row.
- Re-detecting the same message must not create a second event.

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

### 3.3 Relative dates

- Relative expressions (`today`, `tomorrow`, `day after tomorrow`, weekday names) are resolved from the **original announcement message's `createdAt`**, not from the time a delayed job or restart processes the message.
- A bare weekday resolves to the next occurrence after the message date. If the weekday is the message's own day, the choice between today and next week is ambiguous and must be clarified.

### 3.4 Supported expressions (minimum)

| Expression | Behaviour |
|------------|-----------|
| `Tomorrow at 4 PM` | Date = next day; time = 16:00 |
| `Friday at 10:30 AM` | Next Friday; time = 10:30 |
| `Today at 5` | Date recognised; **time is ambiguous (05:00 or 17:00)** → ask |
| `18 November at 3 PM` | 18 November in `Asia/Kolkata`; time = 15:00 |
| `18/11 at 15:00` | Day-first numeric date; 24-hour time |
| `November 18, 2026 at 10:30` | Explicit date; `10:30` without AM/PM is 24-hour time |

### 3.5 Ambiguity and invalid input

Ask the original announcer to clarify (simple explanatory reply in `#meeting-plans`) when:

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
- A meeting scheduled less than one hour away is valid: the reminder is scheduled immediately (startAfter 0).

---

## 4. Event database lifecycle

Events are stored in a new `meeting_events` table created by a proper migration. The authoritative definition is `contracts/database.md`.

- `event_version` starts at `1`.
- Unique identity: `(guild_id, channel_id, source_message_id)`.
- Status transitions: `confirmed` → `completed` (after reminder sent or meeting start).
- `reminder_sent_at` is set only after Discord accepted the reminder.
- `completed` must not be set merely because a job was created.

### 4.1 Migration and legacy data

- Add the table through a new migration, never by editing an applied migration.
- Existing transcript tables (`meeting_transcripts`) and meeting search chunks are legacy/deferred and must not be dropped.

---

## 5. Durable reminder scheduling

### 5.1 Queue

- Queue name: **`send-meeting-reminder`**.
- Payload: `{ meetingId: string, eventVersion: number }`.
- The queue is created at startup before any send/schedule call.
- A processor must be registered with the actual pg-boss worker mechanism (`boss.work(...)`).

### 5.2 Schedule

- After a meeting event is created, schedule the reminder job for `start_at - 1 hour`.
- If `start_at - 1 hour` is already in the past but `start_at` is still in the future, schedule immediately (startAfter 0).
- If the meeting start is already in the past, do not schedule.
- Use pg-boss `startAfter` for the due time.
- Use a stable singleton key derived from the meeting ID and event version (`meeting:<id>:v<version>`) to prevent duplicate queued jobs.
- Do not use in-memory `setTimeout()` for production reminders.

### 5.3 Delivery flow

1. Create the confirmed event.
2. Schedule the reminder.
3. When the job executes, read the current event.
4. Verify it exists and `status === 'confirmed'`.
5. Verify the scheduled `eventVersion` equals the current `event_version`.
6. Claim delivery safely (conditional database update involving `reminder_claimed_at`).
7. Send the reminder to the configured `#pluto` channel.
8. Persist `reminder_sent_at` and `reminder_message_id`.

### 5.4 Reminder content

- Meeting title.
- Start time with `Asia/Kolkata`.
- Link to the original announcement.
- A clear statement that the meeting starts in one hour (or immediate wording for near-term meetings).
- **No** `@everyone` or `@here` ping. No mass mention.
- Do not re-post the full announcement or edit the original.

### 5.5 Registered worker requirement

Worker registration is shared code. Likhith provides and tests the registration function; Khushi integrates it into `src/jobs/worker.ts`.

---

## 6. Reliability, recovery and delivery guarantee

### 6.1 Explicitly handled cases

- Duplicate announcements → unique source identity.
- Duplicate scheduled jobs → singleton key + version/status checks.
- Concurrent worker execution → conditional claim; only one worker proceeds.
- Database failure → job fails and retries; no Discord send from a failed read.
- Discord API failure → job fails and retries; claim is released or expires.
- Process restart → pg-boss job persists; startup reconciliation re-schedules missing reminders for confirmed, unsent, future events.
- Jobs after event time → skipped, logged, event marked `completed`.
- Meetings less than an hour away → reminded immediately.
- Crash during reminder delivery → claim expires and a retry may occur; a duplicate is possible.

### 6.2 Honest delivery guarantee

The design provides **at-least-once** delivery, not exactly-once:

- pg-boss persists jobs in PostgreSQL and retries failures.
- If Discord accepts the message but the process crashes before persisting `reminder_sent_at`, a retry can post a duplicate reminder.
- If Discord fails, the reminder is delayed until a retry succeeds; if the meeting starts first, the late job is skipped rather than posted misleadingly.

The documentation must not claim exactly-once Discord delivery.

### 6.3 Startup reconciliation

On startup, after the queue and worker are ready:

1. Find `confirmed` events with `reminder_sent_at IS NULL` and `start_at > now()`.
2. Ensure a reminder job exists for the current `event_version`; schedule it at `max(now, start_at - 1 hour)` if missing.
3. Use the singleton key so restart does not multiply jobs.

Reconciliation is idempotent and must not send reminders itself.

### 6.4 Logging

- Log meeting IDs, event versions, job IDs, statuses and error codes.
- Never log message content beyond what is necessary, never log tokens, never log `.env` values.

---

## 7. Output and safety rules

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

## 8. Testing and acceptance

### 8.1 Test coverage

Unit tests:

- Mention metadata: real `@everyone`, real `@here`, text-only lookalike, no mention.
- Human vs bot author; correct vs other channel; empty/system message.
- Meeting-language requirement, including a mention with unrelated text.
- Date/time table: tomorrow, weekday, today, explicit date, 24-hour time, AM/PM, invalid time, past date, missing date/time, bare hour, numeric-date ambiguity, timezone conversion, meeting less than one hour away.
- Relative date uses message `createdAt`, not processing time.
- Only original announcer or moderator can manage events (N/A in MVP — auto-scheduled).

Integration tests:

- Migration applies cleanly; unique source identity.
- Event creation persists and schedules.
- Reminder job runs, posts to `#pluto`, and records `reminder_sent_at`/`reminder_message_id`.
- Duplicate jobs produce at most one reminder under the claim rule.
- Restart reconciliation re-schedules a missing job without duplicating.
- Database failure and Discord failure retry and log safely.
- Job after start time skips delivery and logs.
- Existing `/optout` and indexing tests remain unaffected.

### 8.2 Acceptance criteria (MEET-02 MVP)

1. Meeting announcements are detected only in `#meeting-plans`.
2. Actual `@everyone` and `@here` mentions are checked correctly.
3. Bot-authored and unrelated messages are ignored.
4. Supported date/time expressions are parsed correctly.
5. Ambiguous information requires clarification (simple explanatory reply).
6. No confirmation required — valid future events are auto-scheduled.
7. Confirmed meetings are persisted.
8. Reminder jobs are durable across restarts.
9. One-hour reminders are delivered to `#pluto`.
10. Duplicate event creation and concurrent delivery are controlled.
11. Failures are logged safely and recovered where possible.
12. Existing `/optout` and indexing behavior remains unaffected.
13. Unit and integration tests pass.

---

## 9. Open items

| # | Item | Status |
|---|------|--------|
| 1 | Meeting contract approval | Pending Khushi review |
| 2 | Exact meeting-language keyword list | Proposed in L3 implementation; tested and documented |
| 3 | Delivery-claim column (`reminder_claimed_at`) | Included in schema |
| 4 | Historical catch-up for announcements posted while Pluto was offline | Not in v1; documented limitation |

---

*Drafted 2026-11-17. Revised for MVP scope (no confirmation, cancel, or reschedule).*
