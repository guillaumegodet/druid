-- migrate:up
-- Team links of a membership must point at a team of its lab. Until 2026-10-14 a team label was linked to the one
-- structure bearing that acronym even under another lab (lib/directory/pg/recordFields.ts, resolveStructures): the
-- members coded E1, E2… of several labs pointed at the teams of the only lab declaring those codes as structures.
-- The wrong links are removed; the labels (membership.team_labels) are kept, and the next save of a record or the
-- creation of the lab's teams links them again.
DELETE FROM membership_team mt
USING membership m, structure t
WHERE mt.membership_id = m.id
  AND t.id = mt.team_structure_id
  AND m.structure_id IS NOT NULL
  AND t.parent_id IS DISTINCT FROM m.structure_id;

-- migrate:down
-- Nothing to restore: the removed links were wrong.
SELECT 1;
