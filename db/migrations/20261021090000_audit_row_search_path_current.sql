-- migrate:up
-- audit_row() was pinned to `search_path = public` (hardening of a SECURITY DEFINER trigger function). A multi-tenant
-- deployment runs these migrations once per tenant schema (druid-internal docs/plan-druid-saas.md, lot 1 b: dbmate with
-- `search_path=<schema>`), where the function must write the audit_log of ITS schema. `SET search_path FROM CURRENT`
-- keeps the hardening (the path is frozen at creation time) and resolves to `public` on a single-tenant database.
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

-- migrate:down
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
