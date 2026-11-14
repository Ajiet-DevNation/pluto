CREATE TABLE IF NOT EXISTS search_embedding_budget (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  budget_date date NOT NULL,
  used_units integer NOT NULL DEFAULT 0 CHECK (used_units >= 0),
  paused_until timestamptz
);
