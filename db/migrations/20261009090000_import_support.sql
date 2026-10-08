-- migrate:up
-- What the Grist import (lot 5 of druid-internal docs/plan-migration-postgresql.md) needs to keep everything:
-- - membership.team_labels: the team names as typed in the Annuaire (`team`, `|`-separated), kept even when they
--   resolve to a structure (membership_team), since most are free labels;
-- - establishment.extra and ref_corps_grade.extra: the columns without a normalized home (commentaire; the unnamed
--   columns of Corps_Categorie).
ALTER TABLE membership ADD COLUMN team_labels text[] NOT NULL DEFAULT '{}';
ALTER TABLE establishment ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ref_corps_grade ADD COLUMN extra jsonb NOT NULL DEFAULT '{}';

-- migrate:down
ALTER TABLE ref_corps_grade DROP COLUMN extra;
ALTER TABLE establishment DROP COLUMN extra;
ALTER TABLE membership DROP COLUMN team_labels;
