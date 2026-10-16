-- migrate:up
-- Doctoral theses of the researchers (druid-internal docs/plan-funding-calls.md, lot 5): the year of the PhD drives the
-- eligibility to the young researcher schemes (ERC Starting / Consolidator, MSCA Postdoctoral Fellowships, ANR JCJC…).
-- Read from theses.fr by the IdRef of the person (scripts/sync_theses.ts); a thesis typed by hand is `source = manual`
-- and never overwritten by the sync. Every check of a person is remembered, a thesis found or not.

CREATE TABLE person_thesis (
  person_id    uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  -- National thesis number (theses.fr), `manual-<n>` for a thesis typed by hand.
  nnt          text NOT NULL,
  title        text NOT NULL DEFAULT '',
  -- Year when theses.fr gives 1 January (its value for a date it does not know), the day otherwise.
  defended_on  fuzzy_date,
  status       text NOT NULL CHECK (status IN ('defended', 'in_progress')),
  institution  text NOT NULL DEFAULT '',
  discipline   text NOT NULL DEFAULT '',
  source       text NOT NULL DEFAULT 'theses.fr' CHECK (source IN ('theses.fr', 'manual')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, nnt)
);

CREATE TABLE person_thesis_check (
  person_id    uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  -- IdRef queried: a new IdRef makes the person due again.
  idref        text NOT NULL,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  -- Theses found as author (0 when theses.fr does not know the person).
  found        integer NOT NULL DEFAULT 0,
  error        text NOT NULL DEFAULT ''
);

-- migrate:down
DROP TABLE person_thesis_check;
DROP TABLE person_thesis;
