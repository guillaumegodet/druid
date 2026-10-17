-- migrate:up
-- HAL alignment decisions keyed by the HAL person (druid-internal docs/plan-alignement-idhal-i.md, decision D4): a
-- candidate is a person (idHal_i), with or without an IdHAL, so `candidate_id` becomes its idHal_i and the IdHAL moves to
-- the payload (`IdHAL_candidat`). Rows without a numeric IdHAL_i_candidat keep their IdHAL as key (no longer matched).
UPDATE alignment_candidate
SET candidate_id = payload->>'IdHAL_i_candidat',
    payload = (payload - 'IdHAL_i_candidat') || jsonb_build_object('IdHAL_candidat', candidate_id)
WHERE source = 'hal' AND payload->>'IdHAL_i_candidat' ~ '^[0-9]+$';

-- migrate:down
UPDATE alignment_candidate
SET candidate_id = payload->>'IdHAL_candidat',
    payload = (payload - 'IdHAL_candidat') || jsonb_build_object('IdHAL_i_candidat', candidate_id)
WHERE source = 'hal' AND coalesce(payload->>'IdHAL_candidat', '') <> '' AND candidate_id ~ '^[0-9]+$';
