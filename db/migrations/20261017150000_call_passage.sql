-- migrate:up
-- Passages of the open and forthcoming calls with their bge-m3 vector (druid-internal docs/plan-funding-calls.md, lot 7,
-- « My project » assistant): a project described in any language is compared with them to find the calls that fit it.
-- Written by scripts/embed_calls.ts after each collection (a passage is re-embedded only when its text or the model
-- changes), dropped with its call or once the call is closed. A few thousand rows of 1 024 floats: compared in memory by
-- the server, no vector extension needed.

CREATE TABLE call_passage (
  call_id    text NOT NULL REFERENCES funding_call(call_id) ON DELETE CASCADE,
  idx        integer NOT NULL,
  -- Part of the call the passage comes from: summary (title and summary), objectives or scope.
  section    text NOT NULL CHECK (section IN ('summary', 'objectives', 'scope')),
  text       text NOT NULL,
  -- Hash of the text embedded (title included) and model of the vector: a passage is re-embedded when either changes.
  text_hash  text NOT NULL,
  model      text NOT NULL,
  embedding  real[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, idx)
);

-- migrate:down
DROP TABLE call_passage;
