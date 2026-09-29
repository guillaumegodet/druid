// Run: docker run --rm -v "$PWD":/app -w /app -e VITE_GRIST_DOC_ID=docA -e GRIST_API_KEY=k node:20-slim node scripts/tests/cdb-export.cjs
// (server.cjs loaded as a module: it does not listen.)
// Harness: the pure functions generating the cdb exports (people.csv, structures.csv),
// extracted from the Express handlers /api/sync-sovisuplus and /api/sync-structures-csv (lot 2,
// docs/plan-architecture-multi-instances.md). No test existed on these exports until now
// (see docs/druid-audit-qualite-crisalid in the project memory: « 0 test/lint/CI »).
const { buildPeopleCsv, buildStructuresCsv, gristCell, countCsvRecords } = require(require('path').join(__dirname, '../../server.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'ok ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (attendu ${JSON.stringify(want)})`}`);
};

const STRUCTURES = [{ acronym: 'LS2N', localId: 'LS2N-LOCAL-ID' }];
const baseResearcher = (over = {}) => ({
  uid: 'u1', firstName: 'Ada', lastName: 'Lovelace',
  eppn: 'ada@example.org',
  affiliations: [{ isPrimary: true, structureName: 'LS2N', startDate: '2020-01-01', endDate: '', membershipType: 'stat_mmb' }],
  employment: { institutionId: '', grade: 'MCF', startDate: '2020-01-01', endDate: '' },
  identifiers: {},
  nuFields: {},
  ...over,
});

// ── buildPeopleCsv ───────────────────────────────────────────────────────────
{
  const { csv, count, skipped, dedup } = buildPeopleCsv([baseResearcher()], STRUCTURES);
  const lines = csv.trim().split('\n');
  check('people.csv: 1 data row + header', lines.length, 2);
  check('people.csv : count/skipped/dedup', { count, skipped, dedup }, { count: 1, skipped: 0, dedup: 0 });
  const cols = lines[1].split(',');
  check('people.csv: main_research_structure = local_id (resolved by acronym)', cols[2], 'LS2N-LOCAL-ID');
  check('people.csv : tracking_id = uid', cols[3], 'u1');
  check('people.csv: valid membership_type kept', cols[cols.length - 1], 'stat_mmb');
}
{
  // Structure not found by acronym → empty main_research_structure, no error.
  const { csv } = buildPeopleCsv([baseResearcher({ affiliations: [{ isPrimary: true, structureName: 'INCONNU' }] })], STRUCTURES);
  check('people.csv : acronyme structure inconnu → colonne vide', csv.trim().split('\n')[1].split(',')[2], '');
}
{
  // Missing uid → ignored (skipped), not in the CSV.
  const { count, skipped } = buildPeopleCsv([baseResearcher({ uid: '' })], STRUCTURES);
  check('people.csv: missing uid → skipped, 0 row', { count, skipped }, { count: 0, skipped: 1 });
}
{
  // Duplicated uid → only the 1st occurrence is kept (dedup counts the 2nd).
  const { count, dedup } = buildPeopleCsv([baseResearcher(), baseResearcher({ firstName: 'Autre' })], STRUCTURES);
  check('people.csv: duplicated uid → 1 row, dedup=1', { count, dedup }, { count: 1, dedup: 1 });
}
{
  // hdr: true -> 'yes'; absent/false -> '' (never 'no' — cdb only accepts yes/no, empty = unknown).
  const withHdr = buildPeopleCsv([baseResearcher({ uid: 'u2', nuFields: { hdr: true } })], STRUCTURES);
  const withoutHdr = buildPeopleCsv([baseResearcher({ uid: 'u3', nuFields: {} })], STRUCTURES);
  const HDR_COL = CSV_INDEX('hdr');
  check('people.csv : hdr=true → "yes"', withHdr.csv.trim().split('\n')[1].split(',')[HDR_COL], 'yes');
  check('people.csv: hdr missing → empty (not "no")', withoutHdr.csv.trim().split('\n')[1].split(',')[HDR_COL], '');
}
{
  // Malformed dates → empty column rather than a non-ISO value propagated into the cdb CSV.
  const { csv } = buildPeopleCsv([baseResearcher({ employment: { grade: 'MCF', startDate: 'pas-une-date', endDate: '' } })], STRUCTURES);
  const START_COL = CSV_INDEX('employment_start_date');
  check('people.csv: malformed date → empty column', csv.trim().split('\n')[1].split(',')[START_COL], '');
}
{
  // Reduced-precision dates (lib/dates.ts): expanded to the period bounds — start → first day, end → last day.
  const { csv } = buildPeopleCsv([baseResearcher({
    employment: { grade: 'MCF', startDate: '2019', endDate: '2024-02' },
    affiliations: [{ isPrimary: true, structureName: 'LS2N', startDate: '2020-03', endDate: '2023', membershipType: 'stat_mmb' }],
  })], STRUCTURES);
  const cols = csv.trim().split('\n')[1].split(',');
  check('people.csv : fuzzy employment_start_date → first day', cols[CSV_INDEX('employment_start_date')], '2019-01-01');
  check('people.csv : fuzzy employment_end_date → last day of month', cols[CSV_INDEX('employment_end_date')], '2024-02-29');
  check('people.csv : fuzzy membership_start_date → first day', cols[CSV_INDEX('membership_start_date')], '2020-03-01');
  check('people.csv : fuzzy membership_end_date → last day of year', cols[CSV_INDEX('membership_end_date')], '2023-12-31');
}
{
  // membershipType outside the cdb vocabulary → empty column rather than the raw value.
  const { csv } = buildPeopleCsv([baseResearcher({ affiliations: [{ isPrimary: true, structureName: 'LS2N', membershipType: 'inconnu' }] })], STRUCTURES);
  check('people.csv : membership_type inconnu → colonne vide', csv.trim().split('\n')[1].split(',').pop(), '');
}
{
  // Comma in a name → quoted field (csvEscape): the raw CSV line contains the
  // escaped field as is (a naive split on ',' is not suitable to check a column
  // inside a quoted field — RFC4180 — hence a test on the whole line).
  const { csv } = buildPeopleCsv([baseResearcher({ lastName: 'Dupont, Martin' })], STRUCTURES);
  const line = csv.trim().split('\n')[1];
  check('people.csv: comma in the name → escaped', line.includes('"Dupont, Martin"'), true);
}

function CSV_INDEX(header) {
  // Reproduces the CSV_HEADERS order of server.cjs (deliberately duplicated here: a test that
  // imports CSV_HEADERS from server.cjs would not detect a header renamed by mistake).
  const HEADERS = [
    'first_names', 'last_name', 'main_research_structure', 'tracking_id', 'local',
    'eppn', 'idhals', 'idhali', 'orcid', 'idref', 'scopus', 'openalex',
    'institution_identifier', 'institution_id_nomenclature', 'position',
    'employment_start_date', 'employment_end_date', 'hdr',
    'membership_start_date', 'membership_end_date', 'membership_type',
  ];
  return HEADERS.indexOf(header);
}

// ── gristCell ────────────────────────────────────────────────────────────────
check('gristCell : null → vide', gristCell(null), '');
check('gristCell : undefined → vide', gristCell(undefined), '');
check('gristCell : Numeric vide (0) → vide', gristCell(0), '');
check('gristCell: non-zero number → string', gristCell(42), '42');
check('gristCell : ChoiceList (avec sentinelle L) → jointe par |', gristCell(['L', 'UMR', 'CNRS']), 'UMR|CNRS');
check('gristCell: string passthrough', gristCell('LS2N'), 'LS2N');

// ── buildStructuresCsv ────────────────────────────────────────────────────────
function STRUCT_INDEX(header) {
  // Deliberately duplicated (see CSV_INDEX above): detects a header renamed by mistake.
  const HEADERS = [
    'generic_type', 'type', 'local_types', 'main_mission', 'secondary_missions',
    'local_id', 'tracking_id', 'short_labels', 'long_labels', 'descriptions',
    'inclusions', 'participations', 'uai', 'nns', 'ror', 'isni', 'wikidata',
    'scopus', 'erc_research_field', 'hceres_research_areas', 'hal_collection',
    'web', 'signature', 'campus',
  ];
  return HEADERS.indexOf(header);
}
{
  const { csv, count } = buildStructuresCsv([
    { fields: { local_id: 'L1', short_labels: 'LS2N[fr]|LS2N[en]', scopus: 0, local_types: ['L', 'UMR'] } },
  ]);
  const lines = csv.trim().split('\n');
  check('structures.csv: header + 1 row', lines.length, 2);
  check('structures.csv: 24 columns (faithful to cdb structures.csv)', lines[0].split(',').length, 24);
  check('structures.csv : count', count, 1);
  const cols = lines[1].split(',');
  check('structures.csv: empty Numeric (0) → empty column, not "0"', cols[STRUCT_INDEX('scopus')], '');
  check('structures.csv: local_id faithful', cols[STRUCT_INDEX('local_id')], 'L1');
  check('structures.csv: ChoiceList without the L sentinel', cols[STRUCT_INDEX('local_types')], 'UMR');
}
{
  const { csv, count } = buildStructuresCsv([]);
  check('structures.csv: no record → 0 data row', { lines: csv.trim().split('\n').length, count }, { lines: 1, count: 0 });
}

// ── countCsvRecords (export status shown in Administration) ──────────────────
check('count: header only → 0', countCsvRecords('a,b\n'), 0);
check('count: 2 rows, no trailing newline', countCsvRecords('a,b\n1,2\n3,4'), 2);
check('count: quoted cell on 2 lines = 1 record', countCsvRecords('a,b\n"x\ny",2\n'), 1);
check('count: CRLF + blank line ignored', countCsvRecords('a,b\r\n1,2\r\n\r\n'), 1);
check('count: output of buildStructuresCsv', countCsvRecords(buildStructuresCsv([
  { fields: { local_id: 'L1', descriptions: 'line 1\nline 2' } }, { fields: { local_id: 'L2' } },
]).csv), 2);

console.log(ko ? `${ko} failure(s)` : 'all cases OK');
process.exit(ko ? 1 : 0);
