-- migrate:up
-- What the import of the work tables (lot 5 b of druid-internal docs/plan-migration-postgresql.md) needs to keep
-- everything: an `extra` for the Grist columns without a normalized home and for the values that cannot be read
-- (merge_log.extra holds the name shown by the merge log), and historical dates that may be unknown (an imported
-- row without a date stays without date; the defaults still date what the application writes).
ALTER TABLE task ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE task_event ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE merge_log ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE report ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE report_generation ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE import_row ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE task ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE task_event ALTER COLUMN at DROP NOT NULL;
ALTER TABLE merge_log ALTER COLUMN merged_at DROP NOT NULL;
ALTER TABLE report ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE report ALTER COLUMN updated_at DROP NOT NULL;
ALTER TABLE report_share ALTER COLUMN granted_at DROP NOT NULL;
ALTER TABLE report_generation ALTER COLUMN generated_at DROP NOT NULL;
ALTER TABLE benchmark_peer_group ALTER COLUMN updated_at DROP NOT NULL;
-- Task events, shares, generations and peer lists keep their Grist row too (traceability, like the other tables).
ALTER TABLE task_event ADD COLUMN legacy_grist_id integer UNIQUE;
ALTER TABLE report_share ADD COLUMN legacy_grist_id integer UNIQUE;
ALTER TABLE report_generation ADD COLUMN legacy_grist_id integer UNIQUE;
ALTER TABLE benchmark_peer_group ADD COLUMN legacy_grist_id integer UNIQUE;

-- migrate:down
ALTER TABLE benchmark_peer_group DROP COLUMN legacy_grist_id;
ALTER TABLE report_generation DROP COLUMN legacy_grist_id;
ALTER TABLE report_share DROP COLUMN legacy_grist_id;
ALTER TABLE task_event DROP COLUMN legacy_grist_id;
UPDATE benchmark_peer_group SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE benchmark_peer_group ALTER COLUMN updated_at SET NOT NULL;
UPDATE report_generation SET generated_at = now() WHERE generated_at IS NULL;
ALTER TABLE report_generation ALTER COLUMN generated_at SET NOT NULL;
UPDATE report_share SET granted_at = now() WHERE granted_at IS NULL;
ALTER TABLE report_share ALTER COLUMN granted_at SET NOT NULL;
UPDATE report SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE report ALTER COLUMN updated_at SET NOT NULL;
UPDATE report SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE report ALTER COLUMN created_at SET NOT NULL;
UPDATE merge_log SET merged_at = now() WHERE merged_at IS NULL;
ALTER TABLE merge_log ALTER COLUMN merged_at SET NOT NULL;
UPDATE task_event SET at = now() WHERE at IS NULL;
ALTER TABLE task_event ALTER COLUMN at SET NOT NULL;
UPDATE task SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE task ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE import_row DROP COLUMN extra;
ALTER TABLE report_generation DROP COLUMN extra;
ALTER TABLE report DROP COLUMN extra;
ALTER TABLE merge_log DROP COLUMN extra;
ALTER TABLE task_event DROP COLUMN extra;
ALTER TABLE task DROP COLUMN extra;
