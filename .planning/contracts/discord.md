# Discord contract

**Contract:** #3 — Discord (commands + channel configuration + permissions)
**Owner:** Pragathi proposes; Khushi approves
**Status:** Approved and merged with P1 in PR #9 (`c964678`, 2026-11-14). P2 consumes the retrieval/citation rules; `/ask` itself is specified by `contracts/search.md` and the P2 implementation. Meeting-announcer detection and interaction rules were added 2026-11-17 and defer to `contracts/meeting.md`. P3 activity and event commands were added 2026-11-18 and defer to `contracts/database.md`.
**Consumers:** P1 (Discord indexing, `/optout`), P2 (`/ask` retrieval/citations), P3 (`/digest`, `/upcoming`, `/event`, `/help`), L3 (meeting-announcer detection/interaction), CP3, CP5.
**Sources:** `.planning/PR-PLAN.md` §Shared Technical Contracts; `.planning/config.json` → `planning.discord`; `contracts/security.md`; `contracts/search.md`.

---

## 1. Scope

### In scope (P1)

- discord.js **v14** client, one process, one guild (`DevNation`).
- Gateway intake for only the configured channel allowlist.
- One startup backfill per allowlisted channel using the documented `after` cursor.
- Bot-author exclusion at intake, storage and citation boundaries.
- Guild-scoped slash-command registration.
- `/optout` (member self-service) and the persistence/lookup it needs.
- Shared interfaces P2/P3 consume: `isOptedOut`, `DiscordIndexRecord`, Discord message citations.

### Out of scope

- `/ask` (P2). P3 adds `/digest`, `/upcoming`, `/event`, and `/help`; see §8.3.
- Meeting transcript uploads, transcripts, summaries, action items and `/meeting actions` (deferred with L2/MEET-01). The `/decisions` command is removed from active v1; `#decisions` remains an indexed channel.
- The automatic meeting announcer's detection/confirmation behaviour is specified in `contracts/meeting.md`. This contract only defines its Discord-channel, mention, authorization and output rules.
- Embeddings, chunking and vector storage (search contract / L1; P2 integrates).
- Embeds, attachments/OCR, reactions, threads, voice and voice-channel indexing.
- DMs, webhook intake, global commands, sharding, multi-guild support.
- Any write to Discord history. New messages and interaction replies only.

---

## 2. Non-negotiable rules

| ID | Rule |
|----|------|
| D1 | **Allowlist only.** Index exactly the channel IDs in `planning.discord.indexed_channels`. In v1 that is exactly five: `#project-stack`, `#resources`, `#announcements`, `#meeting-plans`, `#decisions`. Private channels (Core Channels) are never indexed. |
| D2 | **Never derive the allowlist from `excluded_channels`.** That list is documentation and is not exhaustive. Deriving from it would index `#core-secrets`. No code path may read it. A static-scan test enforces this. |
| D3 | **Bot-authored messages are never indexed or cited**, in any channel: this bot, other bots, webhooks and app messages. |
| D4 | **Intake is gateway `MessageCreate` + one startup backfill per channel** (`GET /channels/{id}/messages?after=<last_id>`). No webhook receiver, no polling loop. |
| D5 | **Slash commands register at GUILD scope only.** Never global. |
| D6 | **No Discord history writes.** No edit, delete, bulk delete, pin, reaction or thread creation. New messages and interaction replies are permitted. |
| D7 | **Fail closed.** Invalid configuration, an inaccessible allowlisted channel, or an ambiguous message is skipped or aborts startup — never widened to "everything visible". |
| D8 | **`.env` is never edited, printed, logged or committed.** |
| D9 | **Read-only boundary holds.** Read only allowlisted channels; write only new messages/replies. |
| D10 | **Meeting detection is scoped.** Only the configured `#meeting-plans` channel and only human-authored messages that carry an actual Discord `@everyone`/`@here` mention **and** meeting-related language. Text-only lookalikes are not mentions. |
| D11 | **Announcer output is scoped.** Reminders post only to `#pluto`, never repeat `@everyone`/`@here`, never edit/delete the original announcement, and never broaden the allowlist. |
| D12 | **Announcer detection is independent of indexing.** A detection failure must not stop ordinary indexing, and indexing must not be treated as meeting detection. |
| D13 | **Only the original announcer or an authorized moderator may confirm, cancel or reschedule.** No member may change another member's event. |
| D14 | **No voice.** Do not join, listen to, record or index voice channels. |

---

## 3. Configuration

### 3.1 Source of truth

- The allowlist is the **ID values** of `config.json → planning.discord.indexed_channels`. Names are labels; IDs are authoritative.
- No channel ID is hardcoded. Adding/removing a channel is a config change, not a code change.
- `#pluto` is never indexed. `index_own_output_channel` must be `false`.
- `indexed_channels` must contain exactly the five v1 channels. The code reads the allowlist; the v1 acceptance check verifies the count is five.

### 3.2 v1 allowlist

| Channel | ID | Indexed |
|---------|----|---------|
| `#project-stack` | `1423323863093088407` | ✅ |
| `#resources` | `1422593926367547487` | ✅ |
| `#announcements` | `1422593926367547486` | ✅ |
| `#meeting-plans` | `1570872485933752502` | ✅ |
| `#decisions` | `1571564343995277492` | ✅ |
| `#pluto` | `1570721649538502686` | ❌ output |
| `#events` | `1572348309509644289` | ❌ event log |
| `#core-secrets` and all other visible non-allowlisted channels | — | ❌ |
| Threads, forum posts, DMs, other guilds | — | ❌ v1 |

### 3.3 Startup validation — fatal

All checks must pass before the bot starts serving. Any failure throws and exits non-zero.

1. `indexing_mode === 'allowlist'`.
2. `index_own_output_channel === false`.
3. Allowlist is non-empty; every value is a snowflake (`/^\d{5,25}$/`); no duplicate IDs.
4. Output channel ID is not in the allowlist.
5. Every allowlisted ID resolves in the guild to a `GuildText` or `GuildAnnouncement` channel.
6. The bot has View Channel + Read Message History on each indexed channel, and View Channel + Send Messages + Embed Links on `#pluto`.
7. `DISCORD_GUILD_ID` equals `planning.discord.guild_id`.
8. If set, `DISCORD_OUTPUT_CHANNEL_ID` equals `planning.discord.output_channel_id`.
9. If set, `DISCORD_CLIENT_ID` equals the logged-in application ID.

An inaccessible allowlisted channel aborts startup; the bot never runs with a partial allowlist.

### 3.4 Environment

| Variable | Required | Use |
|----------|----------|-----|
| `DISCORD_BOT_TOKEN` | yes | Login. Never logged. |
| `DISCORD_GUILD_ID` | yes | Target guild; must match config. |
| `DISCORD_CLIENT_ID` | no | If set, must match `client.user.id`. |
| `DISCORD_OUTPUT_CHANNEL_ID` | no | If set, must match config. |
| `PLUTO_DATA_DIR` | no | Runtime state directory; default `~/.pluto`. Never inside the repo. |

`.env` is already configured and is gitignored. `.env.example` contains placeholders only.

### 3.5 Guild membership

- Guild: **DevNation**, ID `1422593925658579036`.
- `config.json` records the bot already sees 29 channels, so it is already a member. P1 verifies membership; it does not attempt to join.
- If membership is missing, an operator re-invites with scopes `bot applications.commands` and the permissions in §8.2. Startup error is actionable and secret-free.

---

## 4. Connection and lifecycle

- discord.js **v14**, one `Client`, one token, no sharding, one guild.
- Intents: `Guilds`, `GuildMessages`, `MessageContent`. No `GuildMembers`, `GuildPresences`, `GuildModeration`, `DirectMessages`.
- Partials: none in v1.
- Startup order:
  1. Load and validate config + `.env`.
  2. Attach `MessageCreate` and `InteractionCreate` listeners.
  3. Login; wait for `ClientReady` **once**.
  4. Resolve the guild, verify membership and allowlist access.
  5. Register guild commands.
  6. Run one backfill per allowlisted channel (sequentially).
  7. Continue serving gateway events.
- `ClientReady` uses `client.once`, so a reconnect does not rerun the backfill.
- Gateway events that arrive during backfill are processed normally; idempotent upsert prevents duplicates.
- Shutdown on `SIGINT`/`SIGTERM`: close HTTP server, `client.destroy()`. Never edit/delete messages.
- Startup failures destroy the client and exit non-zero.

---

## 5. Message intake

### 5.1 Modes

1. **Gateway:** `MessageCreate`.
2. **Startup backfill:** one pass per allowlisted channel, `GET /channels/{id}/messages?after=<last_id>&limit=100`.

No webhooks, no scheduled polling, no on-demand history crawl.

### 5.2 Filter pipeline (ordered, fail closed)

For gateway and backfill messages:

1. `guildId` exists and equals the configured guild (DMs ignored).
2. `channelId` is in the allowlist set. `excluded_channels` is never consulted.
3. `system === false`.
4. `author.bot === false` (bots, webhooks, apps).
5. `author.id !== client.user.id` (self-check).
6. `content.trim().length > 0` (attachment-only/embed-only/empty skipped).
7. Author is not opted out for this guild.
8. Normalize and upsert; identity is `(source_type='discord', source_id=message.id)`.

Rejections never log content. Intake returns `indexed` / `ignored` / `error`; a store failure is logged, not thrown into the event emitter.

### 5.3 Startup backfill

Per allowlisted channel, sequentially:

1. Read `last_message_id` from the store.
2. Fetch `after = cursor ?? '0'`, `limit = 100`.
3. Sort the page **ascending** by snowflake ID.
4. Apply §5.2; upsert qualifying records.
5. Commit the cursor to the highest message ID in the batch **only after** the batch is stored.
6. Continue while a full page is returned; stop on a short/empty page.
7. Transient failure: retry up to 3 times with backoff, then log and continue with other channels. A later startup resumes from the committed cursor.
8. If the cursor would not advance, stop that channel to avoid an infinite loop.
9. No progress messages are posted to Discord in P1.

With no cursor, `after=0` reads the channel's full available history. v1 has no cap; discord.js handles rate limits. A crash mid-backfill re-fetches at most one batch; upsert is idempotent.

### 5.4 Edits and deletes

`messageUpdate`/`messageDelete` are ignored in v1. Edited messages keep their originally indexed text. The bot never edits or deletes history.

### 5.5 Meeting-announcer detection (MEET-02)

The meeting announcer is a separate consumer of the gateway stream. It does not alter §5.2 intake or the startup backfill.

1. **Channel:** only the ID configured for `#meeting-plans` in `.planning/config.json`. Never infer it from `excluded_channels` and never hardcode it.
2. **Author:** `author.bot === false` and not the bot itself.
3. **Mention:** require an actual `@everyone`/`@here` mention from Discord metadata (`message.mentions.everyone === true` in discord.js). Do not accept `@everyone`/`@here` text without mention metadata.
4. **Language:** require meeting-related language in addition to the mention, so ordinary mentions are not treated as events.
5. **Scope:** ignore other channels, DMs, system messages and empty messages.
6. **Independence:** dispatch detection through its own error boundary. A detection error is logged and does not affect indexing; an indexing error does not affect detection.
7. **No event without confirmation:** detection only produces a candidate. Confirmation, cancellation and rescheduling behaviour and authorization are defined in `contracts/meeting.md`.
8. **Decisions and other channels:** `#decisions` remains an ordinary indexed channel; its messages are evidence for `/ask` and `/digest`, not meeting announcements.

---

## 6. Index record and storage

| Field | Type | Source |
|-------|------|--------|
| `source_type` | `'discord'` | constant |
| `source_id` | text | `message.id` |
| `source_url` | text | `src/citations/discord.ts` → `https://discord.com/channels/{guild}/{channel}/{message}` |
| `channel_id` | text | `message.channelId` (allowlisted) |
| `author_id` | text | `message.author.id` |
| `author_is_bot` | boolean | `message.author.bot`; only `false` records are eligible for retrieval/citation |
| `content` | text | `message.content` (original, not rewritten) |
| `created_at` | timestamptz / ISO 8601 | `message.createdAt` |
| `indexed_at` | timestamptz / ISO 8601 | intake time |
| `guild_id` | text | `message.guildId` |

`source_url` is always built through the citation builder with `CitationPolicy.blockedChannelIds = [outputChannelId]`. Chunking and embeddings are downstream (search contract / L1 / P2); P1 stores whole-message records.

### 6.1 Interfaces

```ts
export interface DiscordIndexRecord {
  sourceType: 'discord';
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  authorIsBot: boolean;
  content: string;
  createdAt: string;
  indexedAt: string;
  sourceUrl: string;
}

export interface DiscordIndexStore {
  upsert(record: DiscordIndexRecord): Promise<void>;
  removeAuthor(guildId: string, authorId: string): Promise<number>;
  getLastMessageId(guildId: string, channelId: string): Promise<string | null>;
  setLastMessageId(guildId: string, channelId: string, messageId: string): Promise<void>;
  listRecords(): Promise<DiscordIndexRecord[]>;
}

export interface OptOutStore {
  isOptedOut(guildId: string, userId: string): Promise<boolean>;
  optOut(guildId: string, userId: string, optedOutBy: string): Promise<void>;
  optIn(guildId: string, userId: string): Promise<void>;
}
```

### 6.2 Persistence

- P1 default: atomic JSON file at `PLUTO_DATA_DIR/discord-state.json` (`PLUTO_DATA_DIR` default `~/.pluto`). Never inside the repository, so no `.gitignore` change and no runtime state in commits.
- Tests use temp directories or the in-memory implementation.
- P2 may swap in Neon without changing intake, command handlers or the interfaces above. Proposed tables if adopted: `discord_optouts (guild_id, user_id, opted_out_at, opted_out_by)` and `discord_index_cursors (guild_id, channel_id, last_message_id, updated_at)`.
- A corrupt state file throws; it never silently starts empty.

---

## 7. Bot authorship, opt-out and citations

### 7.1 Bot authors

- `author.bot === true` is rejected at intake. The self-ID check is a second guard.
- Every stored record carries `author_is_bot`; only `false` records may be retrieved or cited. This lets P2 reject a bot record independently if one ever reaches storage by another path.
- `#pluto` is never in the allowlist and is blocked by `CitationPolicy.blockedChannelIds`.

### 7.2 Opt-out

- `/optout` records `(guild_id, user_id)`.
- Index time: future messages by that author are skipped.
- On opt-out: existing records for that author in that guild are removed (`removeAuthor`). A purge failure is logged; the opt-out record still applies.
- Retrieval time: P2 calls `isOptedOut` and drops opted-out authors. This is a second, independent layer, and the authoritative one once P2 has its own chunk store.
- Opt-out never edits or deletes Discord messages and does not block other Pluto commands.
- Opt-out is per guild and per member. `/optin`/undo is deferred to a later contract change; v1 `/optout` is one-way.

---

## 8. Slash commands

### 8.1 Registration

- Guild scope only: `guild.commands.set(commands)` (equivalent to `PUT /applications/{application_id}/guilds/{guild_id}/commands`).
- Register once at startup after `ClientReady` and guild validation. Bulk overwrite is idempotent.
- Application ID is `client.user.id`; `DISCORD_CLIENT_ID` must match if set.
- Global registration (`applicationCommands` / `client.application.commands`) is forbidden. A static-scan test enforces it.
- Registration failure is fatal at startup. Never fall back to global.
- Requires the `applications.commands` scope. If missing, re-invite the bot.

### 8.2 `/optout`

| Property | Value |
|----------|-------|
| Name | `optout` |
| Description | `Opt out of Pluto indexing your Discord messages.` |
| Scope | Guild only; `dm_permission: false` |
| Default member permissions | none |
| Options | none in v1 |
| Reply | always ephemeral |

Behavior:

| Input | Effect | Ephemeral reply |
|-------|--------|-----------------|
| first use | Record opt-out; purge existing records | `You're opted out. Pluto will not index or cite your messages.` |
| already opted out | Idempotent; retry purge if needed | `You're already opted out.` |
| store read/write failure | No false success | `Something went wrong. Your opt-out status was not changed. Please try again.` |
| purge failure only | Opt-out still recorded; log warning | Success message |
| wrong guild/DM | No store change | `This command works only inside the DevNation server.` |

### 8.3 P3 activity and event commands

All are guild-scoped and must reject DMs/foreign guilds ephemerally.

| Command | Options | Behavior | Reply |
|---------|---------|----------|-------|
| `/digest` | `days` integer 1–30, default 7 | Deterministic activity snapshot from indexed GitHub issues, Discord records, `#decisions`, and upcoming meetings/events. No AI narrative, no PR/commit counts until reliable dates exist. | Public |
| `/upcoming meetings` | none | Confirmed future meetings from `meeting_events`, sorted by start. | Public |
| `/upcoming events` | none | Scheduled future/ongoing manual events from `events`, sorted by start. | Public |
| `/event add` | `title`, `date` (`YYYY-MM-DD`), `time` (12-hour `h:MM AM/PM` or 24-hour `HH:MM`), optional `end` (same time formats), optional `description` | Available to every member; validate future start and end-after-start in `Asia/Kolkata`; insert one `events` row; post one public record in configured `#events`. All displayed times use 12-hour IST. | Ephemeral confirmation, plus one public channel message |
| `/event cancel` | `id` integer from `/upcoming events` or the `#events` record | Available to every member. Organizers can cancel events they created; members with Manage Events can cancel any event. Sets `status = 'cancelled'`; posts one public cancellation notice in `#events`; never edits or deletes the original record. Already-cancelled events are idempotent. | Ephemeral confirmation, plus one public channel message |
| `/help` | none | List available commands and examples. | Public |

Rules:
- `#events` is configured via `planning.discord.events_channel_id`; never hardcode it and never index the channel.
- `/event add` must not ping `@everyone`/`@here` in its public record.
- If the event row saves but the public record fails, keep the row and tell the organizer the public post failed.
- `/digest`, `/upcoming`, and `/help` are available to every member.
- No `/resource`, `/upcoming all`, channel scanning, recurring events, or manual-event reminders in v1.
- **2026-11-18, approved by Khushi:** `/digest`, `/upcoming meetings`, `/upcoming events`, and `/help` replies are public. `/optout` and the `/event add` confirmation remain ephemeral; wrong-guild and error replies also remain ephemeral. The `/event add` public record in `#events` is the visible event announcement.
- **2026-11-18, approved by Khushi:** `/event add` accepts both 12-hour `h:MM AM/PM` and 24-hour `HH:MM` time input, normalizes to Asia/Kolkata, and displays all times in 12-hour IST. This supersedes the earlier strict-`HH:MM` wording; 24-hour input remains accepted for compatibility.
- **2026-11-18, approved by Khushi:** `/event add` is available to every member, so any member can write an `events` row and post a public record in `#events`. There is no delete path; cancellation is the v1 lifecycle change.
- **2026-11-18, approved by Khushi:** `/event cancel` is available to every member. The creator can cancel their own event; members with Manage Events can cancel any event. Cancellation sets `status = 'cancelled'`, posts one public cancellation notice in `#events`, and never edits or deletes the original `#events` message. Repeating a cancellation is idempotent and posts nothing further.
- **2026-11-18, live-verified:** all P3 commands, public replies, and 12-hour display passed live acceptance in the guild; `#events` remained unindexed.

### 8.4 Interactions

- P1 handles `isChatInputCommand()` with `commandName === 'optout'`; P2 adds `commandName === 'ask'`; P3 adds `digest`, `upcoming`, `event`, and `help`. Other interactions are ignored unless a reviewed handler exists.
- Meeting-announcer controls use message components/modals, not a slash command. Likhith exports the handler; Khushi wires it into the shared interaction router so `/ask` and `/optout` keep working.
- Missing/foreign guild is rejected ephemerally.
- Replies are public for `/digest`, `/upcoming`, `/help`, and successful `/ask` answers. `/optout`, the `/event add` confirmation, and wrong-guild/error messages remain ephemeral. Long work may `deferReply` first.
- Handler errors are logged without content/tokens and return the generic message.
- The opt-out handler never reports success unless the opt-out record was written.
- Announcer confirm/cancel/reschedule responses must verify that the interacting member is the original announcer or an authorized moderator before changing anything.

---

## 9. Permissions and intents

### 9.1 Intents

| Intent | Why |
|--------|-----|
| `Guilds` | Guild/channel metadata |
| `GuildMessages` | Guild message events |
| `MessageContent` | Message text (privileged; enabled in portal) |

If `MessageContent` is disabled, Discord delivers empty content; intake fails closed and logs a clear warning. This is a deployment check, not silent degradation.

### 9.2 Bot permissions

| Channel | Permissions |
|---------|-------------|
| 5 allowlisted channels | View Channel, Read Message History |
| `#pluto` | View Channel, Send Messages, Embed Links |
| `#events` | View Channel, Send Messages |
| Guild | Use Application Commands |

- Scopes: `bot`, `applications.commands`
- Permission integer: `2147568640` = View Channel (1024) + Send Messages (2048) + Embed Links (16384) + Read Message History (65536) + Use Application Commands (2147483648)
- Never granted: Administrator, Manage Guild/Channels/Messages/Roles, Mention Everyone, Attach Files, Connect/Speak.

### 9.3 Human permissions

`/optout` is available to every member for themselves. No role or permission is required. Members cannot opt out other members in v1. `/digest`, `/upcoming`, `/help`, `/event add`, and `/event cancel` are available to every member. `/event cancel` lets the creator cancel their own event; cancelling another member's event requires Manage Events.

---

## 10. Security, logging and failure behavior

- Only `channel.send` to `#pluto` and interaction replies are writes. No edit/delete/pin/reaction/thread APIs, no webhooks.
- The meeting announcer may post only a new reminder message to `#pluto`; it never edits/deletes the original announcement and never repeats `@everyone`/`@here`.
- Logs may contain guild/channel/message IDs, counts, cursors and error codes. Never tokens, `.env` values or message content.
- One runtime channel failure is logged and isolated; startup configuration/access/registration failures are fatal.
- `.env` is never opened, modified, echoed or committed.

---

## 11. Testing and verification

### 11.1 Rules

- `node:test` + `node:assert/strict`; no live Discord calls in the suite; tests use fakes/temp dirs and require no `.env` secrets.
- Baseline before P1: **44 passing tests**. P1 adds 67 tests; after merging current `main` (47 tests) the branch records **114 pass, 0 fail**.
- Coverage includes: all five allowlisted channels; `#core-secrets` and other non-allowlisted channels; `#pluto`; bot/webhook/self/system/empty messages; opt-out at index time; record mapping; citation URL; command metadata; guild-scope registration; opt-out handler states; persistence; backfill cursor/pagination/retry/isolation; static scans for the exclusion list, global commands and history writes.

### 11.2 Commands (Windows / PowerShell)

```powershell
node --import tsx --test (Get-ChildItem tests -Recurse -Filter *.test.ts | ForEach-Object FullName)
npm run build
```

Do **not** run `bash scripts/test.sh`; the npm `test` script is bash-only and broken on this machine. Do not change it in P1.

Pass criteria: **≥ 44 tests pass, 0 fail**, `npm run build` clean. P1 currently records **114 pass, 0 fail**, build clean.

### 11.3 Live verification (recorded in the PR)

The P1 live verification below is historical (2026-11-14); `#decisions` was added to the allowlist on 2026-11-15.

Verified live on **2026-11-14** in DevNation (`1422593925658579036`) as `pluto#6497` (application/member `1570482371298467860`):

- Bot online and joined the guild.
- Backfill completed for exactly four channels: `#project-stack` 57 records, `#resources` 11, `#announcements` 5, `#meeting-plans` 0 (empty at test time); 73 total.
- `#core-secrets` (`1494992020224348230`) has **0 records**; **0** records exist for any non-allowlisted channel.
- **0** bot-authored records and **0** records in `#pluto`.
- Guild commands: `["optout"]`; global commands: `[]`.
- Live member test: member `1417062345112420352` sent two messages in `#project-stack` → 2 records; `/optout` returned the ephemeral confirmation, recorded the opt-out and purged both records (2 → 0); a later message from the same member produced **0** new records.
- The pre-test state snapshot was restored after verification (73 records, 0 opt-outs) and the three Discord test messages were deleted manually.
- No `.env` appeared in `git status` or the PR diff.

Live guild checks remain manual because the test suite must not require credentials; the evidence above is recorded in PR #9.

---

## 12. Acceptance mapping (P1)

| P1 criterion | Contract | Verification |
|--------------|----------|--------------|
| Bot connected and joined | §3.5, §4 | Startup log + guild fetch; live verified 2026-11-14 |
| Allowlisted channels indexed | §3.2, §5, §6 | Policy/intake/backfill tests; live counts 57/11/5/0 |
| Non-selected channels excluded (incl. `#core-secrets`) | D1/D2, §3.2, §5.2 | Negative tests; static scan; live 0 non-allowlisted records |
| Bot-authored never indexed/cited | D3, §7.1 | Intake tests + `authorIsBot` invariant; live 0 bot-authored records |
| `/optout` excludes member messages | §7.2, §8.2 | Handler/store tests; live purge + block verified |
| Opted-out excluded from search/answers | §6.1, §7.2 | P1 exposes `isOptedOut`; P2 enforces retrieval (CP3) |
| Guild-scope registration | §8.1 | Command tests + static scan |
| Tests/build clean | §11.2 | 114 pass, 0 fail; build clean |

---

## 13. Open items / decisions requested from Khushi

| # | Item | Proposal | Status |
|---|------|----------|--------|
| 1 | Persistence backend | JSON file (`PLUTO_DATA_DIR`, default `~/.pluto`) behind the interfaces; Neon swap at P2. | Implemented in P1; confirm |
| 2 | `/optout` reversibility | One-way in v1; add `/optin` later. | Implemented as one-way; confirm |
| 3 | Backfill cap | Full available history of the four channels; no cap in v1. | Proposed |
| 4 | Edits/deletes | Ignored in v1; original text retained. | Proposed |
| 5 | Threads/forum posts | Not indexed in v1. | Proposed |
| 6 | Attachments/embeds | Text only; skipped when empty. | Proposed |
| 7 | Job queue | P1 intake is in-process; pg-boss queue deferred. | Proposed |
| 8 | `MessageContent` disabled | Failed closed + startup warning. | Proposed |

Live guild verification is no longer open: it was completed on 2026-11-14 and is recorded in §11.3 and PR #9.

---

## 14. Change control

- Only Khushi approves this contract or changes to it.
- Channel allowlist, output channel and guild are configuration; no code change required.
- A behaviour not described here is not implemented until it is added here first.
- The meeting-announcer rules in §5.5 and §8.4 were added 2026-11-17. Their full behaviour is owned by `contracts/meeting.md`; a change to detection, confirmation or reminder delivery must update both contracts.
- P3 activity and event commands were added 2026-11-18. `/event add` writes one `events` row and posts one public record in `#events`; `/digest` is on demand and adds no scheduler. Changes must update `contracts/database.md` and `contracts/background-jobs.md` where applicable.
- The 12-hour time-input/display change in §8.3 was approved by Khushi on 2026-11-18; 24-hour input remains accepted for compatibility.
- The public `/digest`, `/upcoming`, and `/help` replies in §8.3/§8.4 were approved by Khushi on 2026-11-18. `/optout` and the `/event add` confirmation remain ephemeral.
- The every-member `/event add` change in §8.3 and §9.3 was approved by Khushi on 2026-11-18.
- `/event cancel` was approved by Khushi on 2026-11-18. Cancellation sets `status = 'cancelled'`, posts one public notice, and never edits/deletes the original `#events` record.
- Changes are recorded in `.planning/STATE.md` at the phase transition.
