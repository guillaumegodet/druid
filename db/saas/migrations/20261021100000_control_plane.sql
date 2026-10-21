-- migrate:up
-- Control plane of a multi-tenant Druid deployment (druid-internal docs/plan-druid-saas.md, lot 1 a). Applied by dbmate
-- with `search_path=saas` (`npm run db:saas:migrate`): every object lands in the `saas` schema, next to the tenant
-- schemas (`t_<slug>`, migrated from db/migrations by scripts/saas/tenant_db.ts). The application role (druid_app, as
-- in db/roles.sql) reads and writes rows; the owner runs the migrations.

-- Commercial plans: what a tenant may use. `capabilities` are merged over the structural ones of the runtime
-- (functions/api/me.js), `seats` NULL = unlimited accounts, `history_years` NULL = whole history of publications.
CREATE TABLE plan (
  code          text PRIMARY KEY,
  label         text NOT NULL,
  seats         integer,
  history_years integer,
  refresh       text NOT NULL DEFAULT 'monthly' CHECK (refresh IN ('monthly', 'weekly', 'daily')),
  capabilities  jsonb NOT NULL DEFAULT '{}',
  features      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plan (code, label, seats, history_years, refresh, capabilities, features) VALUES
  ('trial',    'Essai',    1,    3,    'monthly', '{}', '{"locked": ["benchmark", "reports", "media", "calls", "ai"]}'),
  ('team',     'Équipe',   50,   NULL, 'weekly',  '{}', '{"locked": ["benchmark", "reports", "media", "calls", "ai"], "exports": true}'),
  ('complete', 'Complet',  NULL, NULL, 'weekly',  '{"HAS_BENCHMARK": true, "HAS_TASKS": true, "HAS_CALLS": true}', '{"locked": [], "exports": true, "media": true, "ai": true}');

-- One tenant = one establishment = one PostgreSQL schema (`schema_name`), served on its hosts (tenant_host).
CREATE TABLE tenant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  label        text NOT NULL,
  schema_name  text NOT NULL UNIQUE CHECK (schema_name ~ '^t_[a-z0-9_]+$'),
  status       text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'suspended', 'deleted')),
  plan_code    text NOT NULL DEFAULT 'trial' REFERENCES plan (code),
  ror          text,
  uai          text,
  country      text,
  -- E-mail domains of the establishment: a magic link is only sent to these addresses (and to the members).
  mail_domains text[] NOT NULL DEFAULT '{}',
  -- Per-tenant settings: capabilities overrides, openalexMailto, label of the anonymous user… (same keys as instance.json).
  settings     jsonb NOT NULL DEFAULT '{}',
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_host (
  host       text PRIMARY KEY CHECK (host = lower(host)),
  tenant_id  uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_host_tenant ON tenant_host (tenant_id);

-- Accounts of a tenant. owner = super administrator (the creator), admin = establishment-level tools, viewer =
-- establishment-level reading, lab = reading limited to the labs of `lab_scope` (acronyms of the Structures table).
CREATE TABLE member (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (email = lower(email)),
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer', 'lab')),
  lab_scope     text[] NOT NULL DEFAULT '{}',
  invited_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (tenant_id, email)
);

-- Magic links (lot 1 e): only the sha256 of the token is stored; a link is consumed once. tenant_id NULL = the portal
-- (creation of a tenant, lot 2).
CREATE TABLE magic_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  tenant_id   uuid REFERENCES tenant (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  next_path   text,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_link_email ON magic_link (email, created_at);

-- Sessions (cookie httpOnly on the host of the tenant).
CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL CHECK (email = lower(email)),
  tenant_id    uuid REFERENCES tenant (id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX session_expires ON session (expires_at);

-- Jobs of a tenant (lot 3): queued by the Functions, run by the runner (FOR UPDATE SKIP LOCKED on status = queued).
CREATE TABLE job (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  type        text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress    jsonb NOT NULL DEFAULT '{}',
  log         text,
  attempts    integer NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX job_queue ON job (status, created_at);
CREATE INDEX job_tenant ON job (tenant_id, created_at DESC);

-- API keys of the client (lot 6 a, decision D7): AES-GCM, key held by the runtime (never in this table).
CREATE TABLE tenant_secret (
  tenant_id  uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
  name       text NOT NULL,
  ciphertext text NOT NULL,
  iv         text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

-- Rows for the application role, when it exists (db/roles.sql; a single-role hosting has none).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA saas TO druid_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA saas TO druid_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA saas TO druid_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA saas GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO druid_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA saas GRANT USAGE, SELECT ON SEQUENCES TO druid_app';
  END IF;
END $$;

-- migrate:down
DROP TABLE tenant_secret;
DROP TABLE job;
DROP TABLE session;
DROP TABLE magic_link;
DROP TABLE member;
DROP TABLE tenant_host;
DROP TABLE tenant;
DROP TABLE plan;
