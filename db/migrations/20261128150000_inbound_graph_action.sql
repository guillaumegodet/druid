-- migrate:up
-- Identifier actions coming back from the CRISalid graph bus (lot 3 of druid-internal
-- docs/plan-retour-identifiants-sovisuplus.md): since CRISalid 1.7, researchers and library staff add and remove
-- identifiers in SoVisu+, which publishes them on the exchange `graph`; scripts/graph_consume.ts reads them from the
-- queue druid-person-actions and takes them over in the record (lib/graph/inboundActions.ts, inboundPg.ts).

-- One row per message received (the `id` of the action, or a hash of the body when it has none): the key of
-- idempotence, and the journal of what Druid did with it. planned = read in dry-run mode, applied when the mode turns
-- `on`; applied = the record changed; task = a person has to decide (task created); ignored = nothing to do, with the
-- reason; failed = an error, retried (`attempts`) before the message goes to the dead-letter queue.
CREATE TABLE inbound_graph_action (
  id              text PRIMARY KEY CHECK (id <> ''),
  application     text,
  action_type     text,
  uid             text,
  identifier_type text,
  value           text,
  authenticated   boolean NOT NULL DEFAULT false,
  status          text NOT NULL CHECK (status IN ('planned', 'applied', 'task', 'ignored', 'failed')),
  reason          text,
  effects         jsonb NOT NULL DEFAULT '[]',
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_graph_action_status ON inbound_graph_action (status, received_at);
CREATE INDEX inbound_graph_action_uid ON inbound_graph_action (uid);
CREATE TRIGGER inbound_graph_action_updated_at BEFORE UPDATE ON inbound_graph_action FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The graph holds what SoVisu+ added (the IKG applies the same message): origin `sovisuplus` in the known state, so
-- that the publisher never queues the removal of a value a researcher or a librarian chose.
ALTER TABLE graph_identifier_state DROP CONSTRAINT graph_identifier_state_origin_check;
ALTER TABLE graph_identifier_state ADD CONSTRAINT graph_identifier_state_origin_check
  CHECK (origin IN ('snapshot', 'people_csv', 'sovisuplus'));

-- migrate:down
DELETE FROM graph_identifier_state WHERE origin = 'sovisuplus';
ALTER TABLE graph_identifier_state DROP CONSTRAINT graph_identifier_state_origin_check;
ALTER TABLE graph_identifier_state ADD CONSTRAINT graph_identifier_state_origin_check
  CHECK (origin IN ('snapshot', 'people_csv'));
DROP TABLE inbound_graph_action;
