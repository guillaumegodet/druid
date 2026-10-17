-- migrate:up
-- Calls added by hand (druid-internal docs/plan-funding-calls.md, lot 6): from the URL or the PDF of a call (text read
-- by the server, fields proposed by the language model of the instance, reviewed by a person) or from the catalogue of
-- the research office (CSV or spreadsheet), in programmes of the `manual` source. Who added a call and who reviewed it,
-- for the validation queue of Administration › Calls for proposals; a call waits in `to_validate` until reviewed.
ALTER TABLE funding_call
  ADD COLUMN added_by    text NOT NULL DEFAULT '',
  ADD COLUMN reviewed_by text NOT NULL DEFAULT '',
  ADD COLUMN reviewed_at timestamptz;
CREATE INDEX funding_call_review ON funding_call (review_status) WHERE review_status <> 'imported';

-- migrate:down
DROP INDEX funding_call_review;
ALTER TABLE funding_call DROP COLUMN reviewed_at, DROP COLUMN reviewed_by, DROP COLUMN added_by;
