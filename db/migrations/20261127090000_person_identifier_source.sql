-- migrate:up
-- Lot 4 b of druid-internal `docs/plan-maj-chercheurs.md`: provenance of the identifiers (ORCID, IdRef, IdHAL, IdHAL_i,
-- Scopus, OpenAlex A-ids). person_identifier stays the list the record shows and the exports read; this table keeps,
-- for each value, every source that brought or confirmed it (alignment of a source, import, LDAP, SoVisu+, record…),
-- with its author and dates. A value removed from the record keeps its rows: who brought it stays known.
-- A removal typed in the record is a « Rejeté » decision in alignment_candidate (lib/directory/pg/identifierProvenance.ts),
-- which the automatic writers (sync_openalex, sync_hal) respect.
CREATE TABLE person_identifier_source (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  scheme          text NOT NULL CHECK (scheme ~ '^[a-z][a-z0-9_]*$'),
  value           text NOT NULL CHECK (value <> ''),
  -- manual | align:<source> | job | lab_file | site | hr_file | partner_directory | ldap | sovisuplus | graph | legacy…
  source          text NOT NULL CHECK (source <> ''),
  asserted_at     timestamptz NOT NULL DEFAULT now(),
  observed_at     timestamptz NOT NULL DEFAULT now(),
  asserted_by     text,
  import_batch_id bigint REFERENCES import_batch (id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, scheme, value, source)
);
CREATE INDEX person_identifier_source_value ON person_identifier_source (scheme, value);
CREATE TRIGGER person_identifier_source_updated_at BEFORE UPDATE ON person_identifier_source FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER person_identifier_source_audit AFTER INSERT OR UPDATE OR DELETE ON person_identifier_source FOR EACH ROW EXECUTE FUNCTION audit_row();

-- The identifiers held today, without known provenance (the audit log does not say which flow wrote them).
INSERT INTO person_identifier_source (person_id, scheme, value, source, asserted_at, observed_at, note)
SELECT person_id, scheme, value, 'legacy', created_at, created_at, 'seed 20261127090000'
FROM person_identifier
WHERE scheme IN ('orcid', 'idref', 'idhal', 'idhal_i', 'scopus', 'openalex')
ON CONFLICT DO NOTHING;

-- migrate:down
DROP TABLE person_identifier_source;
