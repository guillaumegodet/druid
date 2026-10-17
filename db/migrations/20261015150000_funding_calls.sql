-- migrate:up
-- « Calls for proposals » tab (druid-internal docs/plan-funding-calls.md, lot 1): the tables of the « European
-- calls » (eu_*, Horizon Europe only, docs/archive/plan-eu-calls.md) become a generic model funder → programme → call →
-- match, so that the same tab serves every funding source (ANR, ERC, MSCA, regional schemes…). The Horizon Europe
-- data already imported is carried over, then the eu_* tables are dropped.

-- A funding body. `category` is the one of the « Funding » tab (components/dashboard/fundersAggregates.ts).
CREATE TABLE funder (
  funder_id  text PRIMARY KEY,
  name       text NOT NULL,
  country    text NOT NULL DEFAULT '',
  category   text NOT NULL CHECK (category IN ('ANR', 'Europe', 'Recherche nationale', 'Régional', 'International', 'Privé / fondations', 'Autre')),
  url        text NOT NULL DEFAULT ''
);

-- A programme of a funder (Horizon Europe, ERC, AAPG…). `kind` says how its calls are matched to the researchers:
-- thematic (text of the call × publications), open (axes or panels × profile), eligibility (career rules), mixed.
-- `source` names the collector that feeds it (trm-report, ft-portal, anr, url-sheet, csv…), `subset_label` what
-- its calls are partitioned by (cluster, axis, panel), shown as a filter of the tab.
CREATE TABLE funding_programme (
  programme_id text PRIMARY KEY,
  funder_id    text NOT NULL REFERENCES funder (funder_id),
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'thematic' CHECK (kind IN ('thematic', 'open', 'eligibility', 'mixed')),
  url          text NOT NULL DEFAULT '',
  source       text NOT NULL DEFAULT 'manual',
  refresh      text NOT NULL DEFAULT 'manual' CHECK (refresh IN ('daily', 'weekly', 'manual')),
  subset_label text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- A call (topic, axis, panel, scheme edition) of a programme. `objectives` and `scope` hold the full text when the
-- collector gives it (input of the thematic matching); `summary` the short text written by the batch or the source.
-- `eligibility` = rules of the call ({phd_years: [2, 7], hdr: true, …}, lot 5); `taxonomy` = classification fields of
-- the source (destination, type of action, panel…); `budget` = amounts as the source gives them.
CREATE TABLE funding_call (
  call_id       text PRIMARY KEY,
  programme_id  text NOT NULL REFERENCES funding_programme (programme_id),
  -- Partition of the programme the call belongs to (cluster CL4, axis H.12, panel PE5), '' when the programme has none.
  subset        text NOT NULL DEFAULT '',
  scheme        text NOT NULL DEFAULT '',
  title         text NOT NULL,
  title_fr      text NOT NULL DEFAULT '',
  summary       text NOT NULL DEFAULT '',
  summary_fr    text NOT NULL DEFAULT '',
  objectives    text NOT NULL DEFAULT '',
  scope         text NOT NULL DEFAULT '',
  eligibility   jsonb NOT NULL DEFAULT '{}',
  taxonomy      jsonb NOT NULL DEFAULT '{}',
  opening_date  date,
  -- Submission deadlines, 'YYYY-MM-DD' (one, or two for a two-stage call).
  deadlines     text[] NOT NULL DEFAULT '{}',
  budget        jsonb NOT NULL DEFAULT '{}',
  url           text NOT NULL DEFAULT '',
  lang          text NOT NULL DEFAULT 'en',
  -- Hash of the texts, so that a collection without change does not trigger a new matching.
  content_hash  text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'unknown' CHECK (status IN ('forthcoming', 'open', 'closed', 'unknown')),
  -- A call added by hand from its URL (lot 6) waits for a validation; the collectors import validated calls.
  review_status text NOT NULL DEFAULT 'imported' CHECK (review_status IN ('imported', 'to_validate', 'validated', 'rejected')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funding_call_programme ON funding_call (programme_id, subset);
CREATE INDEX funding_call_status ON funding_call (status);

-- One run of a matching engine per programme and subset: a new import replaces the previous run (and its matches).
-- `perimeter` = the structures whose publications the engine could see (recorded at import, shown by the tab).
CREATE TABLE call_match_run (
  run_id        text PRIMARY KEY,
  programme_id  text NOT NULL REFERENCES funding_programme (programme_id),
  subset        text NOT NULL DEFAULT '',
  engine        text NOT NULL DEFAULT 'trm' CHECK (engine IN ('trm', 'profile', 'eligibility')),
  perimeter     text NOT NULL DEFAULT '',
  started_at    timestamptz NOT NULL,
  model         text NOT NULL DEFAULT '',
  settings      jsonb NOT NULL DEFAULT '{}',
  calls         integer NOT NULL DEFAULT 0,
  failed_calls  integer NOT NULL DEFAULT 0,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX call_match_run_key ON call_match_run (programme_id, subset, engine);

-- A researcher retained for a call. `person_uid` is the uid of the person in the CRISalid graph (local-<uid>), `uid`
-- the directory uid (Researcher.uid) it maps to. `eligible` is filled by the eligibility engine (lot 5), null otherwise.
CREATE TABLE call_match (
  pair_id             text PRIMARY KEY,
  run_id              text NOT NULL REFERENCES call_match_run (run_id) ON DELETE CASCADE,
  call_id             text NOT NULL REFERENCES funding_call (call_id),
  person_uid          text NOT NULL,
  uid                 text NOT NULL,
  person_name         text NOT NULL DEFAULT '',
  -- Research units of the person as the graph names them (display only: Druid knows its own memberships).
  units               text[] NOT NULL DEFAULT '{}',
  -- Normalised within the call, in [0, 1].
  score               double precision NOT NULL,
  raw_score           double precision NOT NULL DEFAULT 0,
  overall             text NOT NULL CHECK (overall IN ('strong', 'plausible', 'weak', 'none')),
  justification       text NOT NULL DEFAULT '',
  justification_fr    text NOT NULL DEFAULT '',
  -- [{uid, title, year, score, relevant, reason}] of the publications the batch verified.
  publications        jsonb NOT NULL DEFAULT '[]',
  eligible            boolean,
  eligibility_reasons text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX call_match_uid ON call_match (uid);
CREATE INDEX call_match_call ON call_match (call_id);

-- Opinion of a Druid user on a pair; one per user and pair (the last one wins). Keyed by the pair id rather than the
-- row of call_match, so that a new import keeps the opinions already given.
CREATE TABLE call_feedback (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  pair_id    text NOT NULL,
  author     text NOT NULL,
  verdict    text NOT NULL CHECK (verdict IN ('relevant', 'not_relevant', 'already_applying')),
  comment    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_id, author)
);

-- Carry-over of the Horizon Europe data (lib/calls/programmes.ts declares the same funder and programme).
INSERT INTO funder (funder_id, name, country, category, url)
VALUES ('eu', 'Union européenne', 'EU', 'Europe', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/');
INSERT INTO funding_programme (programme_id, funder_id, name, kind, url, source, refresh, subset_label)
VALUES ('horizon-europe', 'eu', 'Horizon Europe', 'thematic',
        'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/programmes/horizon', 'trm-report', 'manual', 'cluster');

INSERT INTO funding_call (call_id, programme_id, subset, title, summary, summary_fr, taxonomy, deadlines, url, status, updated_at)
SELECT topic_id, 'horizon-europe', cluster, title, summary, summary_fr,
       jsonb_strip_nulls(jsonb_build_object('destination', NULLIF(destination, ''), 'call', NULLIF(call_id, ''))),
       deadlines,
       'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/' || lower(topic_id),
       CASE
         WHEN cardinality(deadlines) = 0 THEN 'unknown'
         WHEN EXISTS (SELECT 1 FROM unnest(deadlines) d WHERE d >= to_char(current_date, 'YYYY-MM-DD')) THEN 'open'
         ELSE 'closed'
       END,
       updated_at
FROM eu_topic;

INSERT INTO call_match_run (run_id, programme_id, subset, engine, perimeter, started_at, model, settings, calls, failed_calls, imported_at, imported_by)
SELECT run_id, 'horizon-europe', cluster, 'trm', COALESCE(settings ->> 'scope', ''), started_at, model, settings - 'scope',
       topics, failed_topics, imported_at, imported_by
FROM eu_topic_match_run;

INSERT INTO call_match (pair_id, run_id, call_id, person_uid, uid, person_name, units, score, raw_score, overall, justification, justification_fr, publications)
SELECT pair_id, run_id, topic_id, person_uid, uid, person_name, units, score, raw_score, overall, justification, justification_fr, publications
FROM eu_topic_match;

INSERT INTO call_feedback (pair_id, author, verdict, comment, created_at)
SELECT pair_id, author, verdict, comment, created_at FROM eu_topic_feedback;

DROP TABLE eu_topic_feedback;
DROP TABLE eu_topic_match;
DROP TABLE eu_topic_match_run;
DROP TABLE eu_topic;

-- migrate:down
-- The Horizon Europe data goes back to the eu_* tables; calls of other programmes are lost.
CREATE TABLE eu_topic (
  topic_id    text PRIMARY KEY,
  cluster     text NOT NULL,
  title       text NOT NULL,
  call_id     text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT '',
  deadlines   text[] NOT NULL DEFAULT '{}',
  summary     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  summary_fr  text NOT NULL DEFAULT ''
);
CREATE INDEX eu_topic_cluster ON eu_topic (cluster);
CREATE TABLE eu_topic_match_run (
  run_id        text PRIMARY KEY,
  cluster       text NOT NULL,
  started_at    timestamptz NOT NULL,
  model         text NOT NULL DEFAULT '',
  settings      jsonb NOT NULL DEFAULT '{}',
  topics        integer NOT NULL DEFAULT 0,
  failed_topics integer NOT NULL DEFAULT 0,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX eu_topic_match_run_cluster ON eu_topic_match_run (cluster);
CREATE TABLE eu_topic_match (
  pair_id          text PRIMARY KEY,
  run_id           text NOT NULL REFERENCES eu_topic_match_run (run_id) ON DELETE CASCADE,
  topic_id         text NOT NULL REFERENCES eu_topic (topic_id),
  person_uid       text NOT NULL,
  uid              text NOT NULL,
  person_name      text NOT NULL DEFAULT '',
  units            text[] NOT NULL DEFAULT '{}',
  score            double precision NOT NULL,
  raw_score        double precision NOT NULL DEFAULT 0,
  overall          text NOT NULL CHECK (overall IN ('strong', 'plausible', 'weak', 'none')),
  justification    text NOT NULL DEFAULT '',
  publications     jsonb NOT NULL DEFAULT '[]',
  justification_fr text NOT NULL DEFAULT ''
);
CREATE INDEX eu_topic_match_uid ON eu_topic_match (uid);
CREATE INDEX eu_topic_match_topic ON eu_topic_match (topic_id);
CREATE TABLE eu_topic_feedback (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  pair_id    text NOT NULL,
  author     text NOT NULL,
  verdict    text NOT NULL CHECK (verdict IN ('relevant', 'not_relevant', 'already_applying')),
  comment    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_id, author)
);
INSERT INTO eu_topic (topic_id, cluster, title, call_id, destination, deadlines, summary, summary_fr, updated_at)
SELECT call_id, subset, title, COALESCE(taxonomy ->> 'call', ''), COALESCE(taxonomy ->> 'destination', ''), deadlines, summary, summary_fr, updated_at
FROM funding_call WHERE programme_id = 'horizon-europe';
INSERT INTO eu_topic_match_run (run_id, cluster, started_at, model, settings, topics, failed_topics, imported_at, imported_by)
SELECT run_id, subset, started_at, model,
       CASE WHEN perimeter <> '' THEN settings || jsonb_build_object('scope', perimeter) ELSE settings END,
       calls, failed_calls, imported_at, imported_by
FROM call_match_run WHERE programme_id = 'horizon-europe' AND engine = 'trm';
INSERT INTO eu_topic_match (pair_id, run_id, topic_id, person_uid, uid, person_name, units, score, raw_score, overall, justification, justification_fr, publications)
SELECT m.pair_id, m.run_id, m.call_id, m.person_uid, m.uid, m.person_name, m.units, m.score, m.raw_score, m.overall, m.justification, m.justification_fr, m.publications
FROM call_match m JOIN call_match_run r ON r.run_id = m.run_id WHERE r.programme_id = 'horizon-europe' AND r.engine = 'trm';
INSERT INTO eu_topic_feedback (pair_id, author, verdict, comment, created_at)
SELECT pair_id, author, verdict, comment, created_at FROM call_feedback;
DROP TABLE call_feedback;
DROP TABLE call_match;
DROP TABLE call_match_run;
DROP TABLE funding_call;
DROP TABLE funding_programme;
DROP TABLE funder;
