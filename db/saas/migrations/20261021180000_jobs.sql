-- migrate:up
-- Jobs of the tenants (druid-internal docs/plan-druid-saas.md, lot 3 a): `key` = what a live job excludes (one
-- alignment per source, one ETL build at a time per tenant), `cancel_requested_at` = the « Stop » button (the runner
-- ends the child process), `runner` = the process that claimed the job.
ALTER TABLE job ADD COLUMN key text;
UPDATE job SET key = type WHERE key IS NULL;
ALTER TABLE job ALTER COLUMN key SET NOT NULL;
ALTER TABLE job ADD COLUMN cancel_requested_at timestamptz;
ALTER TABLE job ADD COLUMN runner text;
CREATE INDEX job_live ON job (tenant_id, key) WHERE status IN ('queued', 'running');

-- migrate:down
DROP INDEX job_live;
ALTER TABLE job DROP COLUMN runner;
ALTER TABLE job DROP COLUMN cancel_requested_at;
ALTER TABLE job DROP COLUMN key;
