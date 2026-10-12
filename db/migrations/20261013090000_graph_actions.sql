-- migrate:up
-- Corrections of the directory carried to the CRISalid knowledge graph (IKG) as user actions (lot 11 of druid-internal
-- docs/plan-migration-postgresql.md, D12). people.csv removes a wrong identifier from a person of the graph but leaves
-- the publications harvested with it; only the user action REMOVE cleans them up. Druid keeps what it believes the
-- graph holds and a publisher derives the actions from the difference with the directory (state reconciliation: every
-- path that writes person_identifier is covered, the catch-up is the same computation as the daily run).

-- Identifiers the graph holds for a person `local-<uid>`, as Druid knows them: loaded from a graph snapshot, then
-- kept up to date by the actions sent and the people.csv exports. One value per type, as in the graph.
CREATE TABLE graph_identifier_state (
  uid        text NOT NULL,
  type       text NOT NULL CHECK (type IN ('orcid', 'idref', 'idhals', 'idhali', 'scopus')),
  value      text NOT NULL CHECK (value <> ''),
  origin     text NOT NULL CHECK (origin IN ('snapshot', 'people_csv')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, type)
);

-- The outbox: one row per user action message (the `id` of the message). pending = to send; sent = published to the
-- bus (the IKG sends no acknowledgement for identifier actions yet); blocked = a type the IKG refuses, kept until it
-- accepts it; failed = the bus refused it, retried; cancelled = no longer needed before being sent (the directory came
-- back to the value of the graph).
CREATE TABLE graph_action (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type IN ('REMOVE')),
  uid         text NOT NULL,
  type        text NOT NULL,
  value       text NOT NULL,
  -- Author of the correction (personUid of the message): last actor of the identifier in the audit log.
  actor       text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'blocked', 'failed', 'cancelled')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX graph_action_status ON graph_action (status, created_at);
-- At most one open action per identifier: a pass never queues the same removal twice.
CREATE UNIQUE INDEX graph_action_open ON graph_action (uid, type, value, action_type)
  WHERE status IN ('pending', 'blocked', 'failed');
CREATE TRIGGER graph_action_updated_at BEFORE UPDATE ON graph_action FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down
DROP TABLE graph_action;
DROP TABLE graph_identifier_state;
