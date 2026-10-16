-- migrate:up
-- Eligibility of the researchers to the calls reserved by career stage (druid-internal docs/plan-funding-calls.md,
-- lot 5, view « Candidates », institution right only, decision D5): the rule a call states (PhD window read from its
-- text, lib/calls/eligibility.ts) and the people it makes eligible or to check, recomputed by
-- scripts/compute_eligibility.ts. Kept apart from call_match: these are not thematic matches and are not shown to the
-- lab rights.

CREATE TABLE call_eligibility_rule (
  call_id          text PRIMARY KEY REFERENCES funding_call(call_id) ON DELETE CASCADE,
  scheme           text NOT NULL DEFAULT '',
  phd_from         date NOT NULL,
  phd_to           date NOT NULL,
  extension_years  integer NOT NULL DEFAULT 0,
  source_text      text NOT NULL DEFAULT '',
  computed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_eligibility (
  call_id      text NOT NULL REFERENCES call_eligibility_rule(call_id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  uid          text NOT NULL DEFAULT '',
  person_name  text NOT NULL DEFAULT '',
  -- Labs of the current memberships, grade (Corps_grade): the institution filters the candidates by position.
  units        text[] NOT NULL DEFAULT '{}',
  grade        text NOT NULL DEFAULT '',
  verdict      text NOT NULL CHECK (verdict IN ('eligible', 'check')),
  reasons      text[] NOT NULL DEFAULT '{}',
  phd_on       fuzzy_date,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, person_id)
);

-- migrate:down
DROP TABLE call_eligibility;
DROP TABLE call_eligibility_rule;
