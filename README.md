# Pluto

Pluto is a read-only Discord knowledge assistant for the DevNation community at AJIET. It indexes public GitHub repositories, selected Discord channels, and Miro boards, then exposes that information through deterministic activity digests, upcoming-event awareness, and an automatic meeting announcer.

Pluto is intentionally not a general-purpose chatbot. Its output is grounded in indexed project records, and it never writes to the sources it reads.

> **Current v1 scope:** indexing, Discord intake and opt-out, activity/event awareness, and the Automatic Meeting Announcer. The earlier `/ask` command is not part of active v1.

## Features

- **Discord intake** — indexes only the five configured channels.
- **GitHub indexing** — public Ajiet-DevNation repositories, issues, pull requests, commits, READMEs, contributors, and eligible source files.
- **Miro indexing** — read-only board, item, and connector content when a token is configured.
- **Activity digest** — deterministic counts and links for a selected period; no AI-written narrative.
- **Upcoming awareness** — confirmed meetings and manually added club events.
- **Automatic meeting announcer** — detects eligible `#meeting-plans` announcements and posts one reminder in `#pluto` one hour before the meeting.
- **Opt-out** — members can exclude their Discord messages from indexing.
- **Read-only boundary** — no GitHub writes, Discord history edits, or Miro writes.

## Commands

All commands are guild-scoped and registered with `guild.commands.set`.

| Command | Description |
|---------|-------------|
| `/digest [days]` | Deterministic activity snapshot for 1–30 days (default 7). |
| `/upcoming meetings` | Confirmed upcoming meetings from the meeting announcer. |
| `/upcoming events` | Scheduled upcoming club events. |
| `/event add` | Add a club event: `title`, `date` (`YYYY-MM-DD`), `time` (12-hour or 24-hour IST), optional `end`, optional `description`. |
| `/event cancel` | Cancel an event by ID. Creators can cancel their own events; members with Manage Events can cancel any event. |
| `/help` | List the available commands and examples. |
| `/optout` | Opt out of Pluto indexing your Discord messages. |

`/event add` is available to every member. It saves the event, sends an ephemeral confirmation, and posts one public record in the configured `#events` channel. `#events` is not indexed.

## Automatic Meeting Announcer

The announcer works without a slash command.

It monitors only the configured `#meeting-plans` channel and requires:

- a human author,
- an actual Discord `@everyone` or `@here` mention,
- meeting-related language,
- a parseable future date/time in `Asia/Kolkata`.

A valid announcement creates a row in `meeting_events` and schedules a durable pg-boss reminder for `start_at - 1 hour`. Meetings less than one hour away are reminded immediately. Reminders are posted only in `#pluto`, never repeat a mass mention, and use at-least-once delivery.

## Tech Stack

- TypeScript on Node.js 22+
- Express 5
- discord.js v14
- Neon PostgreSQL with `pgvector` and `tsvector`
- Drizzle ORM
- pg-boss for durable jobs
- Cloudflare Workers AI for embeddings (`bge-base-en-v1.5`); Whisper code is retained only for legacy L2
- Octokit for read-only GitHub App/PAT access
- Miro REST v2, read-only
- Hosting target: heavencloud plan

## Project Structure

```text
src/cmd/pluto/   server entry point and startup composition
src/discord/     Discord client, intake, policy, commands, interactions
src/search/      indexing, embeddings, retrieval support, corpus storage
src/digest/      on-demand activity snapshot
src/upcoming/    upcoming meetings and events
src/events/      manual club-event storage and commands
src/meetings/    meeting detection, parsing, scheduling and reminders
src/optout/      member opt-out command
src/github/      read-only GitHub client
src/miro/        read-only Miro client
src/guardrails/  read-only enforcement
src/jobs/        pg-boss workers and indexing jobs
src/db/          database schema and migrations support
drizzle/         SQL migrations
tests/           unit and integration tests
scripts/         migration, test and verification scripts
.planning/       requirements, roadmap, contracts and project state
```

## Setup

### Prerequisites

- Node.js 22 or newer
- npm
- A Neon PostgreSQL database with `pgvector`
- A Discord bot application
- A read-only GitHub App or fine-grained PAT
- A Cloudflare Workers AI account for embeddings
- A Miro token if Miro indexing is enabled

### Install

```bash
git clone https://github.com/Ajiet-DevNation/pluto.git
cd pluto
npm ci
cp .env.example .env
```

Fill in `.env` with the required credentials. Never commit `.env`.

### Database

Apply the SQL migrations:

```bash
npm run migrate
```

The migration runner is idempotent and records applied files in `schema_migrations`.

### Build and run

```bash
npm run build
npm start
```

For development:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"pluto-backend"}
```

## Configuration

Environment variables are read from `.env`; see `.env.example` for the full list.

| Category | Variables |
|----------|-----------|
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_OUTPUT_CHANNEL_ID` |
| Database | `DATABASE_URL` |
| GitHub | `GITHUB_AUTH_MODE`, `GITHUB_TOKEN`, or `GITHUB_APP_ID` + `GITHUB_INSTALLATION_ID` + `GITHUB_PRIVATE_KEY_PATH` |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` |
| Miro | `MIRO_ACCESS_TOKEN` (optional) |
| Server | `PORT`, `NODE_ENV` |

Channel IDs and the Discord guild are configured in `.planning/config.json`, not hardcoded in application code.

Discord setup requirements:

- **Message Content Intent** enabled in the Developer Portal.
- View Channel and Read Message History on the five indexed channels.
- View Channel and Send Messages in `#pluto`.
- View Channel and Send Messages in `#events`.
- Use Application Commands in the guild.

The five indexed channels are `#project-stack`, `#resources`, `#announcements`, `#meeting-plans`, and `#decisions`. `#pluto` and `#events` are never indexed.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run dev` | Start in watch mode with tsx |
| `npm run migrate` | Apply pending SQL migrations |
| `npm test` | Run the test suite through `scripts/test.sh` |
| `npm run index:github` | Run the GitHub indexing entry point |
| `npm run index:search` | Re-run search indexing |

## Testing

```bash
npm test
```

On Windows, `npm test` requires a Bash shell that supports `pipefail`. If that is unavailable, run the tests directly from PowerShell:

```powershell
$files = Get-ChildItem -Path tests -Recurse -Filter *.test.ts | ForEach-Object { $_.FullName }
node --import tsx --test $files
```

The test suite includes mock-based unit tests and database integration tests. Tests that require `DATABASE_URL` skip only when it is absent.

## Read-Only Boundary

Enforced at two independent layers:

1. **Code** — `src/guardrails/` wraps GitHub and Miro clients in a Proxy that throws `ReadOnlyViolation` for methods outside the read allowlist. Request helpers hardcode `GET`.
2. **Credentials** — GitHub access uses a read-only App/PAT. Miro access is read-only.

Pluto never:

- writes to GitHub repositories,
- edits or deletes Discord history,
- writes to Miro boards,
- indexes private repositories or private channels,
- records or indexes voice channels,
- cites its own output channel as a source.

Posting new Discord messages — replies, reminders, digests, and event records — is permitted.

## Project Status

Active v1 work covers:

- GitHub, Discord, and Miro indexing
- Discord opt-out
- on-demand activity digests
- upcoming meetings and club events
- the Automatic Meeting Announcer

`/ask` is not active. The transcript upload/summary pipeline, `/meeting actions`, and the `/decisions` command are deferred or removed from active v1. Existing legacy code and tables are retained.

The planning documents in `.planning/` are the source of truth. Read `.planning/STATE.md` first when starting a session.
