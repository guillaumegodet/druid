-- migrate:up
-- The audit log keeps the changes of the directory and of the human decisions, not the bookkeeping writes: an update
-- whose only differences are `updated_at` (set by the set_updated_at trigger on every update), `verified_at` (nightly
-- check of the open tasks) or `checked_at` (last check of an identifier) adds no line. Measured on the Nantes database
-- between 2026-10-09 and 2026-10-19: 10 566 task updates of the nightly job (22 MB of 33 MB, 18 with a real change)
-- and 1 906 record saves without any change (identifiers rewritten by ON CONFLICT DO UPDATE, person and membership
-- rows set to the same values) — about 70 % of the lines.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- migrate:down
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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
