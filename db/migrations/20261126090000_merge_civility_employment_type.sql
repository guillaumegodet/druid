-- migrate:up
-- D11 of druid-internal `docs/plan-maj-chercheurs.md` (lot 3): the civility and the employment type join the fields
-- merged by source. Both were still overlaid by the LDAP on display (and the employment type locked in the record):
-- now the LDAP is a source of the merge, a value typed in the record a manual correction that wins over it.
-- Same order of the sources as the grade. Defaults of new fields: ON CONFLICT DO NOTHING (an instance's settings win).
INSERT INTO field_source_priority (field, source, rank) VALUES
  ('civility', 'ldap', 10),
  ('civility', 'hr_file', 20),
  ('civility', 'partner_directory', 30),
  ('civility', 'site', 40),
  ('civility', 'lab_file', 50),
  ('civility', 'legacy', 90),
  ('employment_type', 'ldap', 10),
  ('employment_type', 'hr_file', 20),
  ('employment_type', 'partner_directory', 30),
  ('employment_type', 'site', 40),
  ('employment_type', 'lab_file', 50),
  ('employment_type', 'legacy', 90)
ON CONFLICT DO NOTHING;

-- Current values, with the provenance the audit log gives (seed_person_field_value only fills the (person, field)
-- pairs without rows: here, the two new fields). Measured on the Nantes database on 2026-11-26: 27 manual civilities
-- out of 5 334, 1 manual employment type out of 6 427.
SELECT seed_person_field_value('seed 20261126090000');

-- migrate:down
DELETE FROM person_field_value WHERE field IN ('civility', 'employment_type');
DELETE FROM field_source_priority WHERE field IN ('civility', 'employment_type');
