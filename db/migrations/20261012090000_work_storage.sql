-- migrate:up
-- What the work tables need on PostgreSQL (lot 6 e of druid-internal docs/plan-migration-postgresql.md).
--
-- A task and an import arbitration name a record (Grist `chercheur` / `Fiche`, a reference to an Annuaire row): the
-- membership of that row, kept beside the person (a membership deleted by a merge falls back on the person).
ALTER TABLE task ADD COLUMN membership_id bigint REFERENCES membership (id) ON DELETE SET NULL;
ALTER TABLE import_row ADD COLUMN membership_id bigint REFERENCES membership (id) ON DELETE SET NULL;
CREATE INDEX task_membership ON task (membership_id);

-- `updated_at` dates the last change, unless the application dates it itself: a report keeps the date its store wrote
-- (the version a client sends back to detect a concurrent change, as with Grist), a peer list the date of its saving.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP INDEX task_membership;
ALTER TABLE import_row DROP COLUMN membership_id;
ALTER TABLE task DROP COLUMN membership_id;
