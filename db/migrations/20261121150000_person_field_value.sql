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
-- Ranks are unique per field, so that two sources never tie. `customized` marks a rank changed by the instance (SaaS
-- settings): a later migration that adds the defaults of a new field or source uses ON CONFLICT DO NOTHING and never
-- touches a customized row.
CREATE TABLE field_source_priority (
  field      text NOT NULL,
  source     text NOT NULL CHECK (source <> 'manual'),
  rank       integer NOT NULL CHECK (rank >= 0),
  customized boolean NOT NULL DEFAULT false,
  PRIMARY KEY (field, source),
  UNIQUE (field, rank)
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

-- Seed: the value stored today, with the best provenance the audit log gives. The last write of the value decides:
--   * no actor, `server` (the « tables » view) or a prefixed technical actor (`job:…`, `import:…`): `legacy`;
--   * a named user whose write appended a dated line to the note of the record says which operation it was (the
--     directory writes one on every sync): `MAJ LDAP:` (LDAP review, lib/directory/ldap.ts) → `ldap`;
--     `Arbitrage DRPI (` (HR list, scripts/lib/import_conflicts.cjs) → `hr_file`; any other `Arbitrage <source> (` →
--     `partner_directory`; `Fusion :` (merge of duplicates, lib/mergeProposal.ts) → `legacy`;
--   * a named user who wrote another record within 2 seconds ran a batch (file or site import): `legacy`;
--   * otherwise a correction typed in the record: `manual`.
-- Measured on the Nantes database on 2026-11-24: 34 manual values out of 12 853 (892 with the actor alone).
-- Values loaded from Grist (triggers disabled, no audit line) are `legacy`, ranked last, so that the next LDAP or HR
-- import takes over exactly as the LDAP overlay of lib/directory/people.ts does today.
--
-- A function rather than a statement: until the importers write person_field_value (next lot), the `person` columns
-- can still move; that lot deletes the rows noted `seed%` and runs it again. Only (person, field) pairs without any row
-- are filled. No `SET search_path`: it runs in the schema of the instance (SaaS tenants).
-- Seed helper: true when the note `after` holds more lines matching `pattern` than `before` (the write appended one).
CREATE FUNCTION note_line_added(before text, after text, pattern text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT (SELECT count(*) FROM regexp_matches(coalesce(after, ''), pattern, 'g'))
       > (SELECT count(*) FROM regexp_matches(coalesce(before, ''), pattern, 'g'))
$$;

CREATE FUNCTION seed_person_field_value(p_note text) RETURNS integer
  LANGUAGE plpgsql AS $$
DECLARE
  inserted integer;
BEGIN
  WITH fields AS (SELECT DISTINCT field FROM field_source_priority),
  current_values AS (
    SELECT p.id, f.field, nullif(trim(to_jsonb(p) ->> f.field), '') AS value
    FROM person p CROSS JOIN fields f
  ),
  last_write AS (
    SELECT DISTINCT ON (a.row_id, f.field)
           a.row_id, f.field, a.actor, a.at, a.before ->> 'note' AS note_before, a.after ->> 'note' AS note_after
    FROM audit_log a
    CROSS JOIN fields f
    WHERE a.table_name = 'person' AND a.action IN ('insert', 'update')
      AND (a.after ->> f.field) IS NOT NULL
      AND (a.action = 'insert' OR (a.before ->> f.field) IS DISTINCT FROM (a.after ->> f.field))
    ORDER BY a.row_id, f.field, a.at DESC, a.id DESC
  ),
  classified AS (
    SELECT w.row_id, w.field, w.actor, w.at,
      CASE
        WHEN w.actor IS NULL OR w.actor = 'server' OR w.actor ~ '^[a-z_-]+:' THEN 'legacy'
        WHEN note_line_added(w.note_before, w.note_after, '\] MAJ LDAP:') THEN 'ldap'
        WHEN note_line_added(w.note_before, w.note_after, '\] Arbitrage DRPI \(') THEN 'hr_file'
        WHEN note_line_added(w.note_before, w.note_after, '\] Arbitrage [^(]+\(') THEN 'partner_directory'
        WHEN note_line_added(w.note_before, w.note_after, '\] Fusion :') THEN 'legacy'
        WHEN EXISTS (
          SELECT 1 FROM audit_log b
          WHERE b.table_name = 'person' AND b.actor = w.actor AND b.row_id <> w.row_id
            AND b.at BETWEEN w.at - interval '2 seconds' AND w.at + interval '2 seconds'
        ) THEN 'legacy'
        ELSE 'manual'
      END AS source
    FROM last_write w
  )
  INSERT INTO person_field_value (person_id, field, source, value, asserted_at, observed_at, asserted_by, note)
  SELECT c.id, c.field, coalesce(k.source, 'legacy'), c.value,
         coalesce(k.at, now()), coalesce(k.at, now()), k.actor, p_note
  FROM current_values c
  LEFT JOIN classified k ON k.row_id = c.id::text AND k.field = c.field
  WHERE c.value IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM person_field_value v WHERE v.person_id = c.id AND v.field = c.field);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

SELECT seed_person_field_value('seed 20261121150000');

-- migrate:down
DROP FUNCTION seed_person_field_value(text);
DROP FUNCTION note_line_added(text, text, text);
DROP TABLE person_field_value;
DROP TABLE field_source_priority;
