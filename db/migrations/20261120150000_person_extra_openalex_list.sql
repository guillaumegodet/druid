-- migrate:up
-- The Grist migration kept `extra.OpenAlex_ids` (the cell of the person's main row) when the person's A-ids, gathered
-- from all its rows into person_identifier, read differently. The record and the list showed that partial copy, and
-- writers completing the list from it would have dropped the other A-ids. person_identifier is now the only source.
UPDATE person SET extra = extra - 'OpenAlex_ids' WHERE extra ? 'OpenAlex_ids';

-- migrate:down
-- Nothing to restore: the A-ids are in person_identifier, the removed cells only listed part of them.
SELECT 1;
