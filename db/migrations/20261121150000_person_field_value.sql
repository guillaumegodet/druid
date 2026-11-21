-- migrate:up
-- Per-field provenance of the person record and merge by source priority (same principle as the CRISalid-labo merge
-- module: the record shown is the best reconciliation of the sources, and validated manual corrections are replayed
-- on top of every recomputation instead of being overwritten by the next import).
--
-- person_field_value holds, for one person and one field, the LAST value asserted by each source (one row per
-- source; the previous values stay in audit_log). The `person` columns of the fields listed in field_source_priority
-- become a PROJECTION of these rows, recomputed by the application after every write (lib/directory/fieldMerge.ts,
-- lib/directory/pg/fieldValues.ts), like structure_identifier → structure.
--
-- First fields covered: birth_date and corps_grade. Other fields join by adding their priorities below.

-- Trust of each source for each field: the lower the rank, the more trusted. A source absent for a field ranks after
-- all the listed ones. `manual` is never listed: a manual correction always wins (see fieldMerge.ts).
CREATE TABLE field_source_priority (
  field  text NOT NULL,
  source text NOT NULL CHECK (source <> 'manual'),
  rank   integer NOT NULL CHECK (rank >= 0),
  PRIMARY KEY (field, source)
);

INSERT INTO field_source_priority (field, source, rank) VALUES
  -- Birth date: the institution's HR directory first; the files of the labs are often typed by hand.
  ('birth_date', 'ldap', 10),
  ('birth_date', 'hr_file', 20),
  ('birth_date', 'partner_directory', 30),
  ('birth_date', 'lab_file', 40),
  ('birth_date', 'legacy', 90),
  -- Corps / grade: same order, the public directory site comes before the labs' files.
  ('corps_grade', 'ldap', 10),
  ('corps_grade', 'hr_file', 20),
  ('corps_grade', 'partner_directory', 30),
  ('corps_grade', 'site', 40),
  ('corps_grade', 'lab_file', 50),
  ('corps_grade', 'legacy', 90);

CREATE TABLE person_field_value (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  -- Column of `person` the value is for (birth_date, corps_grade…).
  field           text NOT NULL,
  -- manual | ldap | hr_file | lab_file | site | partner_directory | legacy | …
  source          text NOT NULL CHECK (source <> ''),
  -- Normalized text form (fuzzy date YYYY[-MM[-DD]], grade code…); NULL = the source says it has no value.
  value           text,
  -- When the source first gave this value, and when it last confirmed it (a re-import of the same value only moves
  -- observed_at).
  asserted_at     timestamptz NOT NULL DEFAULT now(),
  observed_at     timestamptz NOT NULL DEFAULT now(),
  -- User of a manual correction, or the job / import that brought the value.
  asserted_by     text,
  import_batch_id bigint REFERENCES import_batch (id) ON DELETE SET NULL,
  -- Manual rows only: the value of each other source when the correction was made ({"ldap": "1980-05-12"}). A source
  -- that still says the same thing is a known divergence; a source that changed since raises a conflict to review.
  acknowledged    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(acknowledged) = 'object'),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, field, source),
  CHECK (source = 'manual' OR acknowledged = '{}')
);
CREATE INDEX person_field_value_field ON person_field_value (field, source);

CREATE TRIGGER person_field_value_updated_at BEFORE UPDATE ON person_field_value FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_field_value_audit AFTER INSERT OR UPDATE OR DELETE ON person_field_value FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Seed: the value stored today, with the best provenance the audit log gives. A value last written by a named user
-- (not a job: no actor; not the « tables » view of the server; not a prefixed technical actor such as
-- `import:newsletter`) is taken as a manual correction; anything else is `legacy`, ranked last, so that the next
-- LDAP or HR import takes over exactly as the LDAP overlay of lib/directory/people.ts does today.
WITH last_write AS (
  SELECT DISTINCT ON (a.row_id, f.field)
         a.row_id, f.field, a.actor, a.at
  FROM audit_log a
  CROSS JOIN (VALUES ('birth_date'), ('corps_grade')) AS f (field)
  WHERE a.table_name = 'person' AND a.action IN ('insert', 'update')
    AND (a.after ->> f.field) IS NOT NULL
    AND (a.action = 'insert' OR (a.before ->> f.field) IS DISTINCT FROM (a.after ->> f.field))
  ORDER BY a.row_id, f.field, a.at DESC, a.id DESC
),
current_values AS (
  SELECT p.id, 'birth_date' AS field, p.birth_date::text AS value FROM person p WHERE p.birth_date IS NOT NULL
  UNION ALL
  SELECT p.id, 'corps_grade', p.corps_grade FROM person p WHERE nullif(trim(p.corps_grade), '') IS NOT NULL
)
INSERT INTO person_field_value (person_id, field, source, value, asserted_at, observed_at, asserted_by, note)
SELECT c.id, c.field,
       CASE WHEN w.actor IS NOT NULL AND w.actor <> 'server' AND w.actor !~ '^[a-z_-]+:' THEN 'manual' ELSE 'legacy' END,
       c.value,
       coalesce(w.at, now()), coalesce(w.at, now()), w.actor,
       'seed 20261121150000'
FROM current_values c
LEFT JOIN last_write w ON w.row_id = c.id::text AND w.field = c.field;

-- migrate:down
DROP TABLE person_field_value;
DROP TABLE field_source_priority;
