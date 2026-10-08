-- migrate:up
-- Decision recorded on the rows of a duplicate group (Doublons page: « CONCOMITANT 2026-10-09 alice »…): it belongs to
-- each membership, like the Grist `doublon_decision` cell of each Annuaire row (lot 6 c of druid-internal
-- docs/plan-migration-postgresql.md).
ALTER TABLE membership ADD COLUMN duplicate_decision text;

-- migrate:down
ALTER TABLE membership DROP COLUMN duplicate_decision;
