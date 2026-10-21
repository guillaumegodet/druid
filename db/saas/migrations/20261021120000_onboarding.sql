-- migrate:up
-- Onboarding of a tenant through the portal (druid-internal docs/plan-druid-saas.md, lot 2): the establishment and the
-- labs entered by the creator are kept on the tenant row (the provisioning job seeds the directory from them), one
-- trial per establishment (ROR), and the access requests of the people who find their establishment already created.
ALTER TABLE tenant ADD COLUMN onboarding jsonb;
CREATE UNIQUE INDEX tenant_ror_live ON tenant (ror) WHERE ror IS NOT NULL AND status <> 'deleted';

CREATE TABLE access_request (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  UNIQUE (tenant_id, email)
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON access_request TO druid_app';
  END IF;
END $$;

-- migrate:down
DROP TABLE access_request;
DROP INDEX tenant_ror_live;
ALTER TABLE tenant DROP COLUMN onboarding;
