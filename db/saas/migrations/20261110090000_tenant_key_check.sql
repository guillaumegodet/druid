-- migrate:up
-- API keys of the establishment (druid-internal docs/plan-druid-saas.md, lot 6 a-2): the outcome of the last test of
-- each group of keys (language model, Elsevier), shown in « My institution » — the keys themselves stay in
-- tenant_secret, encrypted.
CREATE TABLE tenant_key_check (
  tenant_id  uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  key_group  text NOT NULL CHECK (key_group IN ('llm', 'scopus')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL,
  code       text NOT NULL,
  message    text,
  checked_by text,
  PRIMARY KEY (tenant_id, key_group)
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_key_check TO druid_app';
  END IF;
END $$;

-- migrate:down
DROP TABLE tenant_key_check;
