-- migrate:up
-- Quote requests of the tenants (druid-internal docs/plan-druid-saas.md, lot 6 b): « Request a quote » sends an e-mail
-- to DirlaData and keeps the request here, so that the console (lot 6 c) lists them and marks them handled.
CREATE TABLE quote_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  plan_code    text NOT NULL,
  researchers  integer CHECK (researchers IS NULL OR researchers BETWEEN 0 AND 1000000),
  accounts     integer CHECK (accounts IS NULL OR accounts BETWEEN 0 AND 100000),
  message      text CHECK (message IS NULL OR length(message) <= 4000),
  feature      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  handled_at   timestamptz
);
CREATE INDEX quote_request_tenant ON quote_request (tenant_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON quote_request TO druid_app';
  END IF;
END $$;

-- migrate:down
DROP TABLE quote_request;
