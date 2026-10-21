-- migrate:up
-- Identifiers of the structures and their alignment (druid-internal docs/plan-druid-saas.md, § 4 and lot 4 a).
--
-- structure_identifier is the table of record of the identifiers of a structure, multi-valued (a lab commonly has
-- several HAL structure records or several OpenAlex institutions), with a status, a source and the date of the last
-- verification. The `ror` / `rnsr` / `idref` columns of `structure` and the V2 fields of `extra` (ror, nns, idref,
-- hal_collection, uai, isni, wikidata, scopus, hal_struct_ids, openalex_ids) stay what the exports and the record
-- read: they are a PROJECTION of the confirmed primary identifiers, recomputed by the application on every decision
-- (lib/structures/pg/identifiers.ts); a V2 write of one of these fields (record form, import, LDAP sync) is taken as
-- a manual confirmation. The seed below copies the values present today.
CREATE TABLE structure_identifier (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  structure_id bigint NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('rnsr', 'ror', 'hal_struct', 'hal_collection', 'openalex', 'idref', 'wikidata', 'isni', 'uai', 'siret', 'grid', 'scopus_affil')),
  value        text NOT NULL CHECK (value <> ''),
  is_primary   boolean NOT NULL DEFAULT true,
  -- confirmed = in use (exports, ETL); rejected = refused by a user (never proposed again by the alignment).
  status       text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'rejected')),
  -- manual | import | migration | alignment (accepted candidate) | bridge
  source       text NOT NULL DEFAULT 'manual',
  note         text,
  decided_by   text,
  -- Last verification of the record by the alignment job (verify mode) and what it saw (label, closed, links…).
  checked_at   timestamptz,
  check_result jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (structure_id, type, value)
);
CREATE UNIQUE INDEX structure_identifier_primary ON structure_identifier (structure_id, type) WHERE is_primary AND status = 'confirmed';
CREATE INDEX structure_identifier_lookup ON structure_identifier (type, value);

-- Candidates proposed by the alignment job (lib/structures/alignEngine.ts), on the model of alignment_candidate:
-- `evidence` keeps what the user needs to decide (label, acronym, city, supervising institutions, works count, the
-- bridges that reached the value, closed record…); `strength` is the job's reading of the score.
CREATE TABLE structure_alignment_candidate (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  structure_id bigint NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('rnsr', 'ror', 'hal_struct', 'hal_collection', 'openalex', 'idref', 'wikidata', 'isni', 'uai', 'siret', 'grid', 'scopus_affil')),
  candidate_id text NOT NULL CHECK (candidate_id <> ''),
  score        numeric,
  strength     text NOT NULL CHECK (strength IN ('strong', 'medium', 'weak', 'conflict')),
  evidence     jsonb NOT NULL DEFAULT '{}',
  mode         text NOT NULL CHECK (mode IN ('search', 'verify')),
  decision     text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'accepted', 'rejected')),
  note         text,
  decided_by   text,
  decided_at   timestamptz,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (structure_id, type, candidate_id)
);
CREATE INDEX structure_alignment_candidate_structure ON structure_alignment_candidate (structure_id, type);

-- What the job searched, per structure and type: tells « absent » (searched, nothing found) from « never searched ».
CREATE TABLE structure_alignment_search (
  structure_id bigint NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
  type         text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('search', 'verify')),
  searched_at  timestamptz NOT NULL DEFAULT now(),
  candidates   integer NOT NULL DEFAULT 0,
  error        text,
  PRIMARY KEY (structure_id, type)
);

CREATE TRIGGER structure_identifier_updated_at BEFORE UPDATE ON structure_identifier FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER structure_identifier_audit AFTER INSERT OR UPDATE OR DELETE ON structure_identifier FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER structure_alignment_candidate_updated_at BEFORE UPDATE ON structure_alignment_candidate FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER structure_alignment_candidate_audit AFTER INSERT OR UPDATE OR DELETE ON structure_alignment_candidate FOR EACH ROW EXECUTE FUNCTION audit_row();

-- Seed: the identifiers present today (columns and V2 fields), confirmed, primary, source « migration ». Values are
-- normalized as the application does (lib/structures/identifiers.ts): a ROR or HAL collection given as a URL keeps
-- its last path segment; an ISNI loses its spaces.
INSERT INTO structure_identifier (structure_id, type, value, source)
SELECT s.id, v.type, v.value, 'migration'
FROM structure s
CROSS JOIN LATERAL (VALUES
  ('rnsr',           upper(trim(s.rnsr))),
  ('ror',            lower(regexp_replace(trim(s.ror), '^.*/', ''))),
  ('idref',          upper(trim(s.idref))),
  ('hal_collection', upper(regexp_replace(regexp_replace(trim(s.extra->>'hal_collection'), '/+$', ''), '^.*/', ''))),
  ('uai',            upper(trim(s.extra->>'uai'))),
  ('isni',           regexp_replace(trim(s.extra->>'isni'), '[^0-9X]', '', 'g')),
  ('wikidata',       upper(trim(s.extra->>'wikidata'))),
  ('scopus_affil',   trim(s.extra->>'scopus'))
) AS v (type, value)
WHERE v.value IS NOT NULL AND v.value <> '' AND v.value <> 'null'
ON CONFLICT DO NOTHING;

-- migrate:down
DROP TABLE structure_alignment_search;
DROP TABLE structure_alignment_candidate;
DROP TABLE structure_identifier;
