-- Enable pgcrypto for gen_random_uuid() primary key generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable pg_trgm for text search support
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable vector extension for embedding column
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "search_chunks" (
    "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    "source_type" varchar(50) NOT NULL,
    "source_id" varchar(255) NOT NULL,
    "chunk_index" integer NOT NULL,
    "source_url" text,
    "channel_id" varchar(255),
    "author_id" varchar(255),
    "content" text NOT NULL,
    "embedding" vector(768),
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
    "indexed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "search_chunks_source_type_source_id_chunk_idx" ON "search_chunks" USING btree ("source_type", "source_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "search_chunks_author_id_idx" ON "search_chunks" USING btree ("author_id");
CREATE INDEX IF NOT EXISTS "search_chunks_search_vector_idx" ON "search_chunks" USING gin ("search_vector");
CREATE INDEX IF NOT EXISTS "search_chunks_embedding_idx" ON "search_chunks" USING ivfflat ("embedding" vector_cosine_ops);
