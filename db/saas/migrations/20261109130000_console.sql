-- migrate:up
-- DirlaData console (druid-internal docs/plan-druid-saas.md, lot 6 c): its sessions are of their own kind (a portal or
-- tenant session never opens it, and the reverse), an impersonation is a tenant session marked with the console user
-- who opened it, and every action of the console is journaled.
ALTER TABLE magic_link ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'console'));
ALTER TABLE magic_link ADD COLUMN impersonated_by text;
ALTER TABLE session ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'console'));
ALTER TABLE session ADD COLUMN impersonated_by text;

CREATE TABLE console_event (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL,
  action    text NOT NULL,
  tenant_id uuid REFERENCES tenant (id) ON DELETE SET NULL,
  details   jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX console_event_tenant ON console_event (tenant_id, at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON console_event TO druid_app';
    EXECUTE 'GRANT USAGE ON SEQUENCE console_event_id_seq TO druid_app';
  END IF;
END $$;

-- migrate:down
DROP TABLE console_event;
ALTER TABLE session DROP COLUMN impersonated_by;
ALTER TABLE session DROP COLUMN kind;
ALTER TABLE magic_link DROP COLUMN impersonated_by;
ALTER TABLE magic_link DROP COLUMN kind;
