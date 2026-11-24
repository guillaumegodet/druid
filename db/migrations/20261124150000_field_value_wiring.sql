-- migrate:up
-- Lot 2 of druid-internal `docs/plan-maj-chercheurs.md`: every write of the application goes through the merge by source
-- (lib/directory/pg/fieldValues.ts writeMergedField; LDAP values stored after each sync by ldapObserve.ts).
--
-- 1. Seed again: until this version the `person` columns of the merged fields were still written directly, so the rows
--    seeded by 20261121150000 may be stale. No application code wrote person_field_value before this version: every
--    row is a seeded one; they are replaced by a seed of the current values (same rules, seed_person_field_value).
DELETE FROM person_field_value WHERE note LIKE 'seed %';
SELECT seed_person_field_value('seed 20261124150000');

-- 2. A source that confirms its value only moves `observed_at` (fieldMerge.observe): after every LDAP sync, about one row
--    per person and field. That date stays in the row; the audit log keeps the changes, not the confirmations.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  bookkeeping constant text[] := ARRAY['updated_at', 'verified_at', 'checked_at', 'observed_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - bookkeeping) = (to_jsonb(NEW) - bookkeeping) THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'),
    lower(TG_OP),
    NULLIF(current_setting('druid.actor', true), ''),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;

-- migrate:down
-- The rows written since stay: the previous version ignores them (its columns are written directly).
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  bookkeeping constant text[] := ARRAY['updated_at', 'verified_at', 'checked_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - bookkeeping) = (to_jsonb(NEW) - bookkeeping) THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'),
    lower(TG_OP),
    NULLIF(current_setting('druid.actor', true), ''),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;
