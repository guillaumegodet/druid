-- migrate:up
-- Nightly reconciliation with the SoVisu+ action table (lot 5 of druid-internal
-- docs/plan-retour-identifiants-sovisuplus.md): an action the bus did not deliver (SoVisu+ keeps undelivered messages in
-- memory and drops them past 100, the consumer may be down) is replayed from SoVisu+'s own journal. `channel` tells how
-- Druid received each message: a growing share of `reconcile` means the bus loses messages.
ALTER TABLE inbound_graph_action ADD COLUMN channel text NOT NULL DEFAULT 'bus' CHECK (channel IN ('bus', 'reconcile'));

-- migrate:down
ALTER TABLE inbound_graph_action DROP COLUMN channel;
