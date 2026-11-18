-- P3 activity and event awareness: manual club events.
-- Separate from meeting_events (L3): meetings keep their announcer lifecycle
-- and reminder claims, while manual events are simple listings written by
-- /event add. The public #events record is a Discord message, not a row here.
CREATE TABLE IF NOT EXISTS "events" (
    "id" serial PRIMARY KEY NOT NULL,
    "guild_id" text NOT NULL,
    "title" varchar(200) NOT NULL,
    "description" text,
    "start_at" timestamptz NOT NULL,
    "end_at" timestamptz,
    "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "created_by" text NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'scheduled',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "events_status_check" CHECK ("status" IN ('scheduled', 'cancelled', 'completed')),
    CONSTRAINT "events_timezone_check" CHECK ("timezone" = 'Asia/Kolkata'),
    CONSTRAINT "events_end_after_start_check" CHECK ("end_at" IS NULL OR "end_at" > "start_at")
);

-- /upcoming events and /digest read scheduled events for one guild, sorted by start.
CREATE INDEX IF NOT EXISTS "events_guild_start_idx"
    ON "events" USING btree ("guild_id", "start_at");
