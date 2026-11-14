-- Enable pgcrypto for gen_random_uuid() primary key generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "meeting_transcripts" (
    "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "title" varchar(500) NOT NULL,
    "content" text NOT NULL,
    "source" varchar(255) NOT NULL,
    "source_url" text,
    "audio_filename" varchar(500),
    "audio_duration_seconds" integer,
    "language" varchar(50),
    "transcribed_at" timestamptz NOT NULL,
    "indexed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "meeting_transcripts_title_idx" ON "meeting_transcripts" USING btree ("title");
CREATE INDEX "meeting_transcripts_source_idx" ON "meeting_transcripts" USING btree ("source");
CREATE INDEX "meeting_transcripts_transcribed_at_idx" ON "meeting_transcripts" USING btree ("transcribed_at");