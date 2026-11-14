-- Enable pgvector extension for vector(768) embedding column
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for text search support alongside tsvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable pgcrypto for gen_random_uuid() primary key generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "search_chunks" (
    "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "source_type" text NOT NULL,
    "source_id" text NOT NULL,
    "chunk_index" integer NOT NULL,
    "source_url" text NOT NULL,
    "channel_id" text,
    "author_id" text,
    "content" text NOT NULL,
    "embedding" vector(768),
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
    "indexed_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX "search_chunks_source_type_source_id_chunk_idx" ON "search_chunks" USING btree ("source_type", "source_id", "chunk_index");

--> statement-breakpoint
CREATE INDEX "search_chunks_author_id_idx" ON "search_chunks" USING btree ("author_id");

--> statement-breakpoint
CREATE INDEX "search_chunks_search_vector_idx" ON "search_chunks" USING gin ("search_vector");

--> statement-breakpoint
CREATE INDEX "search_chunks_embedding_idx" ON "search_chunks" USING ivfflat ("embedding" vector_cosine_ops);
