-- migrate:up
-- D11 of druid-internal `docs/plan-maj-chercheurs.md` (lot 3): the employer and the employment dates join the fields
-- merged by source. They drive the presence (lib/presence.ts): a manual correction now wins over a later import, and a
-- source that changes after it is a conflict to review.
-- Employer: no LDAP source at sync time (the cache has no supannRefId to infer it); `ldap` ranks after `legacy`, for the
-- values an « attach to LDAP » or a former LDAP review wrote. Employment end: the LDAP (« datefin » of supannEmpProfil,
-- internal employers only) first, as the LDAP review proposed it.
INSERT INTO field_source_priority (field, source, rank) VALUES
  ('employer_id', 'hr_file', 10),
  ('employer_id', 'partner_directory', 20),
  ('employer_id', 'site', 30),
  ('employer_id', 'lab_file', 40),
  ('employer_id', 'legacy', 90),
  ('employer_id', 'ldap', 95),
  ('employment_start', 'hr_file', 10),
  ('employment_start', 'partner_directory', 20),
  ('employment_start', 'lab_file', 30),
  ('employment_start', 'site', 40),
  ('employment_start', 'legacy', 90),
  ('employment_end', 'ldap', 10),
  ('employment_end', 'hr_file', 20),
  ('employment_end', 'partner_directory', 30),
  ('employment_end', 'lab_file', 40),
  ('employment_end', 'site', 50),
  ('employment_end', 'legacy', 90)
ON CONFLICT DO NOTHING;

-- Current values with their provenance (only the new fields have no rows yet). Measured on the Nantes database on
-- 2026-11-26: 3 manual employers out of 5 899, 5 manual employment starts out of 2 208, 222 employment ends from the
-- LDAP review out of 2 694; the LDAP gives one new employment end.
SELECT seed_person_field_value('seed 20261126150000');

-- migrate:down
DELETE FROM person_field_value WHERE field IN ('employer_id', 'employment_start', 'employment_end');
DELETE FROM field_source_priority WHERE field IN ('employer_id', 'employment_start', 'employment_end');
