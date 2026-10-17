-- migrate:up
-- French rendering of the texts of the European calls (docs/archive/plan-eu-calls.md, recette of 2026-10-14): the summaries
-- of the topics and the justifications of the matches are written in English by the batch; the import translates
-- them once with the language model (scripts/import_trm.ts --translate) and the tab shows the French to a French
-- interface. Empty = not translated (yet): the English stays.
ALTER TABLE eu_topic ADD COLUMN summary_fr text NOT NULL DEFAULT '';
ALTER TABLE eu_topic_match ADD COLUMN justification_fr text NOT NULL DEFAULT '';

-- migrate:down
ALTER TABLE eu_topic_match DROP COLUMN justification_fr;
ALTER TABLE eu_topic DROP COLUMN summary_fr;
