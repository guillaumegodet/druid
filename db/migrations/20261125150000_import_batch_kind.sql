-- migrate:up
-- Case 19 of druid-internal `docs/plan-maj-chercheurs.md` (lot 3): « cancel an import ». import_batch held only the
-- arbitration tables of the directory imports (Arbitrage_<source>, scripts/lib/import_conflicts.cjs); a file or site
-- import now opens a batch too, and the values it observes for the fields merged by source carry its id
-- (person_field_value.import_batch_id), so that they can be removed together and the records recomputed.
ALTER TABLE import_batch
  ADD COLUMN kind text NOT NULL DEFAULT 'arbitration' CHECK (kind IN ('arbitration', 'import')),
  ADD COLUMN created_by text,
  ADD COLUMN undone_at timestamptz,
  ADD COLUMN undone_by text;
CREATE INDEX person_field_value_import_batch ON person_field_value (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- migrate:down
DROP INDEX person_field_value_import_batch;
ALTER TABLE import_batch DROP COLUMN undone_by, DROP COLUMN undone_at, DROP COLUMN created_by, DROP COLUMN kind;
