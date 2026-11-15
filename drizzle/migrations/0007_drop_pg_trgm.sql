-- pg_trgm was enabled before any trigram search was implemented. The current
-- search path uses pgvector and PostgreSQL full-text search (tsvector) instead.
DROP EXTENSION IF EXISTS pg_trgm;
