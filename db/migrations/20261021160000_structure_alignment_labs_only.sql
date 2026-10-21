-- migrate:up
-- Only the labs are aligned (decision of 2026-10-21): the harvesting uses their identifiers, a team has none of its
-- own, institutions and groupings keep theirs on their record. The candidates and search bookkeeping of the first run
-- on the other levels go; their confirmed identifiers stay.
DELETE FROM structure_alignment_candidate c USING structure s WHERE s.id = c.structure_id AND s.level IS DISTINCT FROM '2';
DELETE FROM structure_alignment_search x USING structure s WHERE s.id = x.structure_id AND s.level IS DISTINCT FROM '2';

-- migrate:down
-- Nothing to restore: the rows removed were proposals of a job, recomputed by its next run.
SELECT 1;
