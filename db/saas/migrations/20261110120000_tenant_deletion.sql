-- migrate:up
-- Deletion of a tenant asked by its owner (druid-internal docs/plan-druid-saas.md, lot 6 a-3): the tenant is suspended
-- (read-only for everybody) until `delete_after` (30 days later), then a `tenant.delete` job of the runner drops its
-- schema, its files and its rows; the owner or the console (lot 6 c) may cancel before. `status_before_delete` is the
-- status the cancellation gives back (a tenant suspended by the console stays suspended).
ALTER TABLE tenant ADD COLUMN delete_requested_at timestamptz;
ALTER TABLE tenant ADD COLUMN delete_requested_by text;
ALTER TABLE tenant ADD COLUMN delete_after timestamptz;
ALTER TABLE tenant ADD COLUMN status_before_delete text CHECK (status_before_delete IN ('active', 'suspended'));
CREATE INDEX tenant_delete_after ON tenant (delete_after) WHERE delete_after IS NOT NULL;

-- migrate:down
DROP INDEX tenant_delete_after;
ALTER TABLE tenant DROP COLUMN status_before_delete;
ALTER TABLE tenant DROP COLUMN delete_after;
ALTER TABLE tenant DROP COLUMN delete_requested_by;
ALTER TABLE tenant DROP COLUMN delete_requested_at;
