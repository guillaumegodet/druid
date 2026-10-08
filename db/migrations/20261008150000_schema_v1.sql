-- migrate:up
-- Schema v1 of the Druid directory (druid-internal docs/plan-migration-postgresql.md § 4, amended by the lot 0
-- mapping docs/migration-postgresql-mapping.md). Normalized core (people, memberships, identifiers, structures),
-- long tail of the Grist Annuaire in `extra jsonb` (D6). The publications tables (Newsletter, Mentions, OpenAlex
-- affiliation corrections, Centrale axes) stay in Grist (D10). Run by druid_owner (db/roles.sql): druid_app gets the
-- rows through the default privileges.

-- ── Reduced-precision dates (lib/dates.ts): YYYY, YYYY-MM or YYYY-MM-DD, stored as typed ─────────────────────────
CREATE FUNCTION fuzzy_date_is_valid(v text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
BEGIN
  IF v !~ '^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$' THEN RETURN false; END IF;
  -- A real calendar day (no 2026-02-30).
  IF length(v) = 10 THEN PERFORM make_date(left(v, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int); END IF;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END $$;

CREATE DOMAIN fuzzy_date AS text CHECK (fuzzy_date_is_valid(VALUE));

-- First and last day of the period (2026 → 2026-01-01 / 2026-12-31): sorting and filtering in SQL, same rule as
-- fuzzyDateBound in lib/dates.ts.
CREATE FUNCTION fuzzy_date_lower(v text) RETURNS date
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE length(v)
    WHEN 4 THEN make_date(v::int, 1, 1)
    WHEN 7 THEN make_date(left(v, 4)::int, substr(v, 6, 2)::int, 1)
    ELSE make_date(left(v, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int)
  END $$;

CREATE FUNCTION fuzzy_date_upper(v text) RETURNS date
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE length(v)
    WHEN 4 THEN make_date(v::int, 12, 31)
    WHEN 7 THEN (make_date(left(v, 4)::int, substr(v, 6, 2)::int, 1) + interval '1 month' - interval '1 day')::date
    ELSE make_date(left(v, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int)
  END $$;

-- ── Common triggers ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Every change of an audited table: before/after images. The application names the actor of its transaction with
-- `SET LOCAL druid.actor = '<user>'` (empty = a job or a script). Runs as the owner: druid_app cannot write the log
-- itself, nor disable the trigger (only the owner may, e.g. for the bulk import of lot 5).
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  row_id     text,
  action     text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor      text,
  at         timestamptz NOT NULL DEFAULT now(),
  before     jsonb,
  after      jsonb
);
CREATE INDEX audit_log_row ON audit_log (table_name, row_id);
CREATE INDEX audit_log_at ON audit_log (at);

CREATE FUNCTION audit_row() RETURNS trigger
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

-- ── Reference data ───────────────────────────────────────────────────────────────────────────────────────────────
-- Employers (Grist Etablissements).
CREATE TABLE establishment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  label           text,
  uai             text UNIQUE,
  ror             text,
  idref           text,
  legacy_grist_id integer UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Corps / grade → category (Grist Corps_Categorie). person.corps_grade is not a foreign key: 24 values are off-list.
CREATE TABLE ref_corps_grade (
  code     text PRIMARY KEY,
  category text,
  label    text
);

-- Structures (Grist Structures, Labos_nantes_universite merged in). `local_id` = code supann or T-…; `S-<rowId>`
-- URLs and saved reports resolve through legacy_grist_id.
CREATE TABLE structure (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id         text NOT NULL UNIQUE,
  acronym          text,
  name             text,
  type             text,
  level            text,
  nature           text,
  parent_id        bigint REFERENCES structure (id) ON DELETE SET NULL,
  establishment_id bigint REFERENCES establishment (id) ON DELETE SET NULL,
  ror              text,
  rnsr             text,
  idref            text,
  url              text,
  extra            jsonb NOT NULL DEFAULT '{}',
  legacy_grist_id  integer UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX structure_parent ON structure (parent_id);
CREATE INDEX structure_acronym ON structure (lower(acronym));

-- ── People ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- One person (the Grist Annuaire has one row per membership: lot 0 mapping § 1).
CREATE TABLE person (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid                         text UNIQUE CHECK (uid = lower(uid)),
  last_name                   text NOT NULL,
  first_name                  text,
  civility                    text CHECK (civility IN ('F', 'M')),
  email                       text,
  nationality                 text,
  birth_date                  date,
  corps_grade                 text,
  employment_type             text,
  employment_type_label       text,
  hdr                         text,
  hdr_year                    integer,
  doctoral_school             text,
  employer_id                 bigint REFERENCES establishment (id) ON DELETE SET NULL,
  employment_start            fuzzy_date,
  employment_end              fuzzy_date,
  employment_start_lower      date GENERATED ALWAYS AS (fuzzy_date_lower(employment_start)) STORED,
  employment_end_upper        date GENERATED ALWAYS AS (fuzzy_date_upper(employment_end)) STORED,
  ldap_state                  text,
  hr_id                       text,
  fte_ratio                   numeric CHECK (fte_ratio >= 0),
  fte_research                numeric CHECK (fte_research >= 0),
  photo_url                   text,
  directory_url               text,
  -- Presence validated by a manager (validated / validated_status / validation_* of the Annuaire).
  presence_validated          boolean NOT NULL DEFAULT false,
  presence_status             text CHECK (presence_status IN ('PRESENT', 'DEPART', 'PARTI')),
  presence_validated_on       date,
  presence_validation_source  text,
  presence_validation_scope   text[] NOT NULL DEFAULT '{}',
  presence_validated_by       text,
  -- Commentaires of the Annuaire (manual notes and the dated log lines of the syncs, imported as they are).
  note                        text,
  sources                     text[] NOT NULL DEFAULT '{}',
  extra                       jsonb NOT NULL DEFAULT '{}',
  legacy_grist_id             integer,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_name ON person (lower(last_name), lower(first_name));
CREATE INDEX person_employer ON person (employer_id);

-- Identifiers (IdRef, ORCID, IdHAL, IdHAL_i, Scopus, OpenAlex, Bluesky, Mastodon… and their secondary values).
-- No unique index on (scheme, value): ~145 values are carried by two people today (lot 0 § 2), see identifier_conflict;
-- the partial unique index on the primary values comes with lot 12.
CREATE TABLE person_identifier (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  scheme     text NOT NULL CHECK (scheme ~ '^[a-z][a-z0-9_]*$'),
  value      text NOT NULL CHECK (value <> ''),
  is_primary boolean NOT NULL DEFAULT true,
  source     text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, scheme, value)
);
CREATE INDEX person_identifier_value ON person_identifier (scheme, value);

-- Checked absence of an identifier (the « absent » Scopus sentinel of the Annuaire).
CREATE TABLE person_identifier_check (
  person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  scheme     text NOT NULL,
  result     text NOT NULL CHECK (result IN ('absent')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, scheme)
);

-- Web profiles (CV, LinkedIn, Google Scholar, ResearchGate…).
CREATE TABLE person_link (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, kind, url)
);

-- Memberships: one per row of the Grist Annuaire. structure_id is null for a parking lab (zzz / empty), whose label
-- stays in lab_label.
CREATE TABLE membership (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  structure_id    bigint REFERENCES structure (id) ON DELETE RESTRICT,
  lab_label       text,
  type            text,
  role            text CHECK (role IN ('PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE')),
  start_date      fuzzy_date,
  end_date        fuzzy_date,
  start_lower     date GENERATED ALWAYS AS (fuzzy_date_lower(start_date)) STORED,
  end_upper       date GENERATED ALWAYS AS (fuzzy_date_upper(end_date)) STORED,
  source          text,
  legacy_grist_id integer UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_person ON membership (person_id);
CREATE INDEX membership_structure ON membership (structure_id);

CREATE TABLE membership_team (
  membership_id     bigint NOT NULL REFERENCES membership (id) ON DELETE CASCADE,
  team_structure_id bigint NOT NULL REFERENCES structure (id) ON DELETE RESTRICT,
  PRIMARY KEY (membership_id, team_structure_id)
);

-- Last run of each sync per person (LDAP_derniere_maj / _champs_modifies, IdRef_*, HAL_*, ORCID_*, OpenAlex_*, Scopus_*).
CREATE TABLE sync_state (
  person_id      uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  source         text NOT NULL,
  last_run       date,
  changed_fields text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (person_id, source)
);

-- ── Work tables ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Alignment candidates and their review (the five Grist tables Alignement_*).
CREATE TABLE alignment_candidate (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('idref', 'orcid', 'hal', 'openalex', 'scopus')),
  candidate_id    text NOT NULL,
  score           numeric,
  payload         jsonb NOT NULL DEFAULT '{}',
  decision        text NOT NULL DEFAULT 'À traiter',
  note            text,
  pushed_on       date,
  decided_by      text,
  decided_at      timestamptz,
  applied         boolean NOT NULL DEFAULT false,
  applied_on      date,
  legacy_grist_id integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, source, candidate_id)
);

-- Merges of two directory records (Grist Fusions_log): snapshots kept for the restoration.
CREATE TABLE merge_log (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uid                   text,
  kept_person_id        uuid REFERENCES person (id) ON DELETE SET NULL,
  dropped_snapshot      jsonb NOT NULL,
  kept_before           jsonb NOT NULL DEFAULT '{}',
  kept_patch            jsonb NOT NULL DEFAULT '{}',
  author                text,
  note                  text,
  merged_at             timestamptz NOT NULL DEFAULT now(),
  restored              boolean NOT NULL DEFAULT false,
  restored_person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  legacy_kept_rowid     integer,
  legacy_dropped_rowid  integer,
  legacy_restored_rowid integer,
  legacy_grist_id       integer UNIQUE
);

-- Tasks to carry out outside Druid (Grist Taches / Taches_evenements, scripts/lib/tasks_schema.cjs).
CREATE TABLE task (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key              text UNIQUE,
  type             text NOT NULL,
  base             text,
  channel          text,
  title            text NOT NULL,
  description      text,
  person_id        uuid REFERENCES person (id) ON DELETE SET NULL,
  uid              text,
  person_name      text,
  lab              text,
  link             text,
  status           text NOT NULL DEFAULT 'a_faire'
                   CHECK (status IN ('a_faire', 'en_cours', 'en_attente', 'fait', 'abandonnee', 'resolue_auto')),
  assignee         text,
  priority         text NOT NULL DEFAULT 'normale' CHECK (priority IN ('basse', 'normale', 'haute')),
  origin           text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  taken_by         text,
  taken_at         timestamptz,
  waiting_reason   text,
  done_by          text,
  done_at          timestamptz,
  resolution       text,
  verified_at      timestamptz,
  legacy_grist_id  integer UNIQUE,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_person ON task (person_id);
CREATE INDEX task_open ON task (status) WHERE status IN ('a_faire', 'en_cours', 'en_attente');

CREATE TABLE task_event (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  at      timestamptz NOT NULL DEFAULT now(),
  author  text,
  action  text NOT NULL,
  detail  text
);
CREATE INDEX task_event_task ON task_event (task_id);

-- Directory imports left to arbitration (Grist Arbitrage_<source>_<date>, scripts/lib/import_conflicts.cjs).
CREATE TABLE import_batch (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  legacy_table text UNIQUE
);

CREATE TABLE import_row (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id       bigint NOT NULL REFERENCES import_batch (id) ON DELETE CASCADE,
  person_id      uuid REFERENCES person (id) ON DELETE SET NULL,
  person_label   text,
  lab            text,
  family         text,
  field          text NOT NULL,
  current_value  text,
  imported_value text,
  imported_json  jsonb,
  remark         text,
  choice         text,
  other_value    text,
  resolved_at    timestamptz,
  resolved_by    text,
  legacy_grist_id integer
);
CREATE INDEX import_row_batch ON import_row (batch_id);

-- « Mes rapports » (Grist Rapports, Rapports_partages, Rapports_generations; scripts/lib/reports_store.cjs).
CREATE TABLE report (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner              text NOT NULL,
  name               text NOT NULL,
  description        text,
  template_id        text,
  definition         jsonb NOT NULL,
  visibility         text NOT NULL DEFAULT 'private',
  published_template boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  legacy_grist_id    integer UNIQUE
);
CREATE INDEX report_owner ON report (owner);

CREATE TABLE report_share (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id  bigint NOT NULL REFERENCES report (id) ON DELETE CASCADE,
  grantee    text NOT NULL,
  role       text NOT NULL,
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, grantee)
);

CREATE TABLE report_generation (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id           bigint NOT NULL REFERENCES report (id) ON DELETE CASCADE,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  generated_by        text,
  definition_snapshot jsonb,
  publication_count   integer,
  data_date           text,
  ai_texts            jsonb,
  pdf_ref             text,
  shared_frozen       boolean NOT NULL DEFAULT false
);
CREATE INDEX report_generation_report ON report_generation (report_id);

-- Benchmark peer lists, personal (owner = Keycloak / Access user).
CREATE TABLE benchmark_peer_group (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner      text NOT NULL,
  name       text NOT NULL,
  rors       text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, name)
);

-- ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Identifier values carried by several people (rule annuaire_ids_partages; lot 0 § 2).
CREATE VIEW identifier_conflict AS
  SELECT scheme, value, array_agg(DISTINCT person_id ORDER BY person_id) AS person_ids, count(DISTINCT person_id) AS people
  FROM person_identifier
  GROUP BY scheme, value
  HAVING count(DISTINCT person_id) > 1;

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['establishment', 'structure', 'person', 'person_identifier', 'membership',
                           'alignment_candidate', 'task', 'report', 'benchmark_peer_group'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
  -- Audited: the directory and the human decisions. Not audited: append-only journals (task_event, merge_log,
  -- report_generation, audit_log) and the sync bookkeeping (sync_state).
  FOREACH t IN ARRAY ARRAY['establishment', 'structure', 'ref_corps_grade', 'person', 'person_identifier',
                           'person_identifier_check', 'person_link', 'membership', 'membership_team',
                           'alignment_candidate', 'task', 'import_batch', 'import_row', 'report', 'report_share',
                           'benchmark_peer_group'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
  END LOOP;
END $$;

-- The audit log is append-only for the application: it reads it, the triggers write it. The migration journal of
-- dbmate is the owner's.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'druid_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM druid_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM druid_app;
  END IF;
END $$;

-- migrate:down
DROP VIEW identifier_conflict;
DROP TABLE benchmark_peer_group, report_generation, report_share, report, import_row, import_batch, task_event, task,
  merge_log, alignment_candidate, sync_state, membership_team, membership, person_link, person_identifier_check,
  person_identifier, person, structure, ref_corps_grade, establishment, audit_log;
DROP FUNCTION audit_row(), set_updated_at(), fuzzy_date_upper(text), fuzzy_date_lower(text);
DROP DOMAIN fuzzy_date;
DROP FUNCTION fuzzy_date_is_valid(text);
