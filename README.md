# Pluto

Read-only Discord knowledge assistant for the DevNation community at AJIET.
Indexes public GitHub repositories, selected Discord channels, Miro boards and
meeting transcripts, and answers questions with citations to the original source.

## Stack

- TypeScript, Node.js 22, Express
- discord.js v14
- Neon Postgres (pgvector, tsvector) with Drizzle ORM
- pg-boss job queue
- Cloudflare Workers AI (embeddings, instruct model, Whisper)
- Hosting: heavencloud plan

## Setup

```bash
npm install
cp .env.example .env    # fill in credentials
npm run build
npm start
```

Requires Node.js 22 or newer (see `.nvmrc`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run dev` | Watch mode via tsx |
| `npm test` | Run the test suite (`node:test` via tsx) |

## Health check

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"pluto-backend"}
```

## Read-only boundary

Enforced at two independent layers:

1. **Code** — `src/guardrails/` wraps every GitHub and Miro client in a Proxy that throws
   `ReadOnlyViolation` for any method outside the read allowlist. The request helpers
   hardcode `GET`, so a write cannot be expressed.
2. **Credential** — the bot uses a read-only fine-grained GitHub PAT (or a read-only
   GitHub App once it exists). The write is impossible even if the guard is bypassed.

- No writes to GitHub repositories
- No edits or deletions of Discord history
- No writes to Miro boards
- No indexing of private repositories or private channels
- No answers generated from unsupported general knowledge
- The bot's own output channel (`#pluto`) is never cited as a source

Posting new Discord messages (answers, notifications, digests) is permitted.

## Structure

```
src/cmd/pluto/   server entry point
src/guardrails/  read-only enforcement (Proxy allowlist)
src/github/      read-only GitHub client and credential resolution
src/miro/        read-only Miro client
src/citations/   citation builders and markdown rendering
tests/           guard, client and citation tests
scripts/         build, test and verification scripts
.planning/       project plan, requirements, roadmap, state, contracts
```

Planning documents in `.planning/` are the source of truth. Read
`.planning/STATE.md` first when starting a session.
