// In-memory Grist for the contract tests of the commands (druid-internal docs/plan-migration-postgresql.md, lot 6):
// writable tables, the column types of a migrated Annuaire, and Grist's defaults on a new row.
import type { GristClient } from '../../directory/repository';
import type { GristRecord } from '../../directory/gristMapping';

/** In-memory Grist: the tables of the fixture, writable, with the column types of a migrated Annuaire. */
export const memoryGrist = (initial: Record<string, GristRecord[]>): GristClient => {
  const tables: Record<string, GristRecord[]> = JSON.parse(JSON.stringify(initial));
  const typeOf = (c: string) => (c === 'DATE_DE_NAISSANCE_JJ_MM_AAAA' || c === 'validation_date' ? 'Date' : c === 'Employeur' ? 'Ref:Etablissements'
    : ['etp_quotite', 'etp_recherche', 'ID_SCOPUS', 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_'].includes(c) ? 'Numeric' : c === 'validated' ? 'Bool' : 'Text');
  const annuaireColumns = ['uid_dyna', 'Nom', 'Prenom', 'Civilite', 'Email', 'Nationalite', 'DATE_DE_NAISSANCE_JJ_MM_AAAA', 'LABO', 'team',
    'affiliation_start_date', 'affiliation_end_date', 'membership_type', 'rattachement', 'doublon_decision', 'Employeur', 'employment_start_date',
    'employment_end_date', 'Corps_grade', 'TYPE_EMPLOI', 'LIB_TYPE_EMPLOI', 'etp_quotite', 'etp_recherche', 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_',
    'ORCID', 'IdRef', 'IdRef_nom_valide', 'IdHAL', 'IdHAL_i', 'ID_SCOPUS', 'OpenAlex_ids', 'openalex_author_id', 'photo_url', 'Bluesky', 'Mastodon', 'YouTube',
    'Podcast_flux', 'Blog', 'LinkedIn', 'CV_institutionnel', 'CV_site_labo', 'CV_pdf_docx_', 'CV_HAL', 'Academia', 'Researchgate', 'Profil_GS',
    'Site_web', 'validated', 'validated_status', 'validation_date', 'validation_source', 'validation_scope', 'validated_by', 'statut_dyna',
    'Data_source', 'LDAP_derniere_maj', 'groupes', 'ABES_export_hash', 'ABES_export_date', 'Commentaires', 'HDR', 'ANNEE_HDR',
    'ED_de_rattachement', 'annuaire_url'];
  // Row ids never come back after a deletion (as PostgreSQL sequences): a monotonic counter per table.
  const counters: Record<string, number> = {};
  const nextId = (t: string) => (counters[t] = Math.max(counters[t] ?? 0, ...(tables[t] || []).map((r) => r.id)) + 1);
  return {
    docUpdatedAt: async () => String(Math.random()),
    tableIds: async () => Object.keys(tables),
    records: async (t, filter) => JSON.parse(JSON.stringify((tables[t] || []).filter((r) =>
      !filter || Object.entries(filter).every(([col, values]) => values.includes(col === 'id' ? r.id : r.fields[col]))))),
    columns: async (t) => (t === 'Annuaire' ? annuaireColumns.map((id) => ({ id, fields: { label: id, type: typeOf(id), isFormula: false } })) : []),
    addColumns: async () => {},
    updateColumns: async () => {},
    addTables: async (list) => { for (const x of list) tables[x.id] ??= []; },
    // A new Annuaire row gets the default of every column it does not set, as Grist does ('' / 0 / false / null).
    addRecords: async (t, records) => records.map((r) => {
      const id = nextId(t);
      // The FTE columns have a « None » trigger formula (scripts/add_fte_columns.cjs): null, not 0, on a new row.
      const defaults = t === 'Annuaire' ? Object.fromEntries(annuaireColumns.map((c) => [c,
        c.startsWith('etp_') ? null : { Date: null, Numeric: 0, Bool: false }[typeOf(c)] ?? ''])) : {};
      (tables[t] ??= []).push({ id, fields: { ...defaults, Employeur: t === 'Annuaire' ? 0 : undefined, ...r.fields } });
      return id;
    }),
    updateRecords: async (t, records) => { for (const r of records) Object.assign(tables[t].find((x) => x.id === r.id)!.fields, r.fields); },
    deleteRecords: async (t, ids) => { tables[t] = tables[t].filter((r) => !ids.includes(r.id)); },
    sql: async (query, args) => {
      // SELECT <columns> FROM "<table>" WHERE "<column>" = ? (tasks of a record).
      const where = /^SELECT ([\w, ]+) FROM "(\w+)" WHERE "(\w+)" = \?$/.exec(query);
      if (where) {
        const cols = where[1].split(',').map((c) => c.trim());
        return (tables[where[2]] || []).filter((r) => r.fields[where[3]] === args[0])
          .map((r) => Object.fromEntries(cols.map((c) => [c, c === 'id' ? r.id : r.fields[c]])));
      }
      const t = /FROM (\w+)/.exec(query)![1];
      const col = /SELECT id, (\w+) AS v/.exec(query)![1];
      return (tables[t] || []).filter((r) => (args as number[]).includes(r.id)).map((r) => ({ id: r.id, v: r.fields[col] }));
    },
  };
};
