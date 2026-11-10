-- migrate:up
-- Lifecycle e-mails (druid-internal docs/plan-druid-saas.md, lot 6 d): when the owners of a tenant nobody signed in to
-- for 90 days were last told. The runner tells them again only after a sign-in followed by a new inactive spell.
ALTER TABLE tenant ADD COLUMN inactivity_notified_at timestamptz;

-- migrate:down
ALTER TABLE tenant DROP COLUMN inactivity_notified_at;
