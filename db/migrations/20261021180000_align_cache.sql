-- migrate:up
-- Alignment caches of the people (<source>_align_cache.json written by scripts/sync_*.cjs) kept in the database on a
-- deployment whose jobs run away from the web server (druid-internal docs/plan-druid-saas.md, lot 3 b): the runner
-- stores the file after each run, the Functions serve it at /<name>.json and read it for the review. Nantes keeps its
-- bind-mounted files (the table stays empty there).
CREATE TABLE align_cache (
  name       text PRIMARY KEY CHECK (name ~ '^[a-z0-9_]+$'),
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE align_cache;
