-- Enable pgcrypto for gen_random_uuid() primary key generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- L3 Automatic Meeting Announcer: persisted meeting events and reminder state.
CREATE TABLE IF NOT EXISTS "meeting_events" (
    "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "guild_id" text NOT NULL,
    "channel_id" text NOT NULL,
    "source_message_id" text NOT NULL,
    "source_message_url" text NOT NULL,
    "created_by" text NOT NULL,
    "title" varchar(500) NOT NULL,
    "start_at" timestamptz NOT NULL,
    "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "event_version" integer NOT NULL DEFAULT 1,
    "reminder_sent_at" timestamptz,
    "reminder_message_id" text,
    "reminder_claimed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "meeting_events_status_check" CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'completed')),
    CONSTRAINT "meeting_events_timezone_check" CHECK ("timezone" = 'Asia/Kolkata')
);

-- Unique source identity: one Discord announcement creates at most one event.
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_events_source_message_unique"
    ON "meeting_events" ("guild_id", "channel_id", "source_message_id");

-- Startup reconciliation and due-event lookup.
CREATE INDEX IF NOT EXISTS "meeting_events_status_start_at_idx"
    ON "meeting_events" USING btree ("status", "start_at");

CREATE INDEX IF NOT EXISTS "meeting_events_start_at_idx"
    ON "meeting_events" USING btree ("start_at");
