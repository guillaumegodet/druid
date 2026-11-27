-- migrate:up
-- Lot 5 of druid-internal `docs/plan-maj-chercheurs.md` (D6): the order of the sources of a field becomes a setting
-- of the instance (Administration › Record sources); its changes go to the audit log like the records'.
CREATE TRIGGER field_source_priority_audit AFTER INSERT OR UPDATE OR DELETE ON field_source_priority
  FOR EACH ROW EXECUTE FUNCTION audit_row();

-- migrate:down
DROP TRIGGER field_source_priority_audit ON field_source_priority;
