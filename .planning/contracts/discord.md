# Discord contract

**Contract:** #3 — Discord (commands + channel configuration + permissions)
**Owner:** Pragathi proposes; Khushi approves
**Status:** Draft for review — 2026-11-14. P1 implementation follows this draft; Khushi approval is still required before merge.
**Consumers:** P1 (Discord indexing, `/optout`), P2 (`/ask` retrieval/citations), P3 (`/digest`), L3 (`/decisions`), CP3.
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

- `/ask`, `/digest`, `/decisions`, meeting summaries/action items (P2, P3, L3).
- Embeddings, chunking and vector storage (search contract / L1; P2 integrates).
- Message edits/deletes, reactions, threads, attachments/OCR, voice.
- DMs, webhook intake, global commands, sharding, multi-guild support.
- Any write to Discord history. New messages and interaction replies only.

---

## 2. Non-negotiable rules

| ID | Rule |
|----|------|
| D1 | **Allowlist only.** Index exactly the channel IDs in `planning.discord.indexed_channels`. In v1 that is exactly four: `#project-stack`, `#resources`, `#announcements`, `#meeting-plans`. |
| D2 | **Never derive the allowlist from `excluded_channels`.** That list is documentation and is not exhaustive. Deriving from it would index `#core-secrets`. No code path may read it. A static-scan test enforces this. |
| D3 | **Bot-authored messages are never indexed or cited**, in any channel: this bot, other bots, webhooks and app messages. |
| D4 | **Intake is gateway `MessageCreate` + one startup backfill per channel** (`GET /channels/{id}/messages?after=<last_id>`). No webhook receiver, no polling loop. |
| D5 | **Slash commands register at GUILD scope only.** Never global. |
| D6 | **No Discord history writes.** No edit, delete, bulk delete, pin, reaction or thread creation. New messages and interaction replies are permitted. |
| D7 | **Fail closed.** Invalid configuration, an inaccessible allowlisted channel, or an ambiguous message is skipped or aborts startup — never widened to "everything visible". |
| D8 | **`.env` is never edited, printed, logged or committed.** |
| D9 | **Read-only boundary holds.** Read only allowlisted channels; write only new messages/replies. |

---

## 3. Configuration

### 3.1 Source of truth

- The allowlist is the **ID values** of `config.json → planning.discord.indexed_channels`. Names are labels; IDs are authoritative.
- No channel ID is hardcoded. Adding/removing a channel is a config change, not a code change.
- `#pluto` is never indexed. `index_own_output_channel` must be `false`.
- `indexed_channels` must contain exactly the four v1 channels. The code reads the allowlist; the v1 acceptance check verifies the count is four.

### 3.2 v1 allowlist

| Channel | ID | Indexed |
|---------|----|---------|
| `#project-stack` | `1423323863093088407` | ✅ |
| `#resources` | `1422593926367547487` | ✅ |
| `#announcements` | `1422593926367547486` | ✅ |
| `#meeting-plans` | `1570872485933752502` | ✅ |
| `#pluto` | `1570721649538502686` | ❌ output |
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

### 8.3 Interactions

- Only `isChatInputCommand()` with `commandName === 'optout'` is handled in P1; other interactions are ignored.
- Missing/foreign guild is rejected ephemerally.
- Replies are ephemeral; long work may `deferReply` first.
- Handler errors are logged without content/tokens and return the generic message.
- The handler never reports success unless the opt-out record was written.

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
| 4 allowlisted channels | View Channel, Read Message History |
| `#pluto` | View Channel, Send Messages, Embed Links |
| Guild | Use Application Commands |

- Scopes: `bot`, `applications.commands`
- Permission integer: `2147568640` = View Channel (1024) + Send Messages (2048) + Embed Links (16384) + Read Message History (65536) + Use Application Commands (2147483648)
- Never granted: Administrator, Manage Guild/Channels/Messages/Roles, Mention Everyone, Attach Files, Connect/Speak.

### 9.3 Human permissions

`/optout` is available to every member for themselves. No role or permission is required. Members cannot opt out other members in v1.

---

## 10. Security, logging and failure behavior

- Only `channel.send` to `#pluto` and interaction replies are writes. No edit/delete/pin/reaction/thread APIs, no webhooks.
- Logs may contain guild/channel/message IDs, counts, cursors and error codes. Never tokens, `.env` values or message content.
- One runtime channel failure is logged and isolated; startup configuration/access/registration failures are fatal.
- `.env` is never opened, modified, echoed or committed.

---

## 11. Testing and verification

### 11.1 Rules

- `node:test` + `node:assert/strict`; no live Discord calls in the suite; tests use fakes/temp dirs and require no `.env` secrets.
- Baseline before P1: **44 passing tests**. P1 adds 67 tests for a total of **111 pass, 0 fail**.
- Coverage includes: all four allowlisted channels; `#core-secrets` and other non-allowlisted channels; `#pluto`; bot/webhook/self/system/empty messages; opt-out at index time; record mapping; citation URL; command metadata; guild-scope registration; opt-out handler states; persistence; backfill cursor/pagination/retry/isolation; static scans for the exclusion list, global commands and history writes.

### 11.2 Commands (Windows / PowerShell)

```powershell
node --import tsx --test (Get-ChildItem tests -Recurse -Filter *.test.ts | ForEach-Object FullName)
npm run build
```

Do **not** run `bash scripts/test.sh`; the npm `test` script is bash-only and broken on this machine. Do not change it in P1.

Pass criteria: **≥ 44 tests pass, 0 fail**, `npm run build` clean. P1 currently records **111 pass, 0 fail**, build clean.

### 11.3 Live verification (recorded in the PR)

- Bot online in DevNation (`1422593925658579036`).
- `/optout` in the guild command list, not global.
- Backfill logs exactly four channels; no `#core-secrets` or other non-allowlisted channel.
- Human message in an allowlisted channel indexes once; a bot message there indexes zero times.
- `/optout` returns ephemeral confirmation; later messages are skipped; existing records are purged.
- No `.env` in `git status` or the PR diff.

Live guild checks remain manual because the test suite must not require credentials.

---

## 12. Acceptance mapping (P1)

| P1 criterion | Contract | Verification |
|--------------|----------|--------------|
| Bot connected and joined | §3.5, §4 | Startup log + guild fetch; live check |
| Allowlisted channels indexed | §3.2, §5, §6 | Policy/intake/backfill tests; live counts |
| Non-selected channels excluded (incl. `#core-secrets`) | D1/D2, §3.2, §5.2 | Negative tests; static scan |
| Bot-authored never indexed/cited | D3, §7.1 | Intake tests + `authorIsBot` invariant |
| `/optout` excludes member messages | §7.2, §8.2 | Handler/store tests; live check |
| Opted-out excluded from search/answers | §6.1, §7.2 | P1 exposes `isOptedOut`; P2 enforces retrieval (CP3) |
| Guild-scope registration | §8.1 | Command tests + static scan |
| Tests/build clean | §11.2 | 111 pass, 0 fail; build clean |

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
| 9 | Live guild verification | Manual; requires `.env` credentials and the real guild. | Pending |

---

## 14. Change control

- Only Khushi approves this contract or changes to it.
- Channel allowlist, output channel and guild are configuration; no code change required.
- A behaviour not described here is not implemented until it is added here first.
- Changes are recorded in `.planning/STATE.md` at the phase transition.
