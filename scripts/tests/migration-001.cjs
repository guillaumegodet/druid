// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/migration-001.cjs
// Migration 001 (task channel rename): rows moved, obsolete choice dropped only once unused.
const path = require('path');
const { planMigration } = require(path.join(__dirname, '../migrations/001-tasks-channel-rename.cjs'));

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`}`);
};

const KNOWN = ['correspondant_idref', 'lot_abes', 'interne'];
const rows = [
  { id: 1, fields: { canal: 'old_channel' } },
  { id: 2, fields: { canal: 'lot_abes' } },
  { id: 3, fields: { canal: 'old_channel' } },
  { id: 4, fields: { canal: 'typed_by_hand' } },
];
const opts = JSON.stringify({ choices: ['old_channel', 'lot_abes', 'interne', 'typed_by_hand'], choiceOptions: {} });

const plan = planMigration(rows, opts, 'old_channel', 'correspondant_idref', KNOWN);
check('rows carrying the old value are moved', plan.updates.map((u) => u.id), [1, 3]);
check('new value written', plan.updates[0].fields, { canal: 'correspondant_idref' });
check('old choice dropped, value still in use kept, new one appended', plan.choices, ['lot_abes', 'interne', 'typed_by_hand', 'correspondant_idref']);
check('other options kept', JSON.parse(plan.widgetOptions).choiceOptions, {});

const done = planMigration(rows.map((r) => (r.fields.canal === 'old_channel' ? { ...r, fields: { canal: 'correspondant_idref' } } : r)),
  JSON.stringify({ choices: plan.choices }), 'old_channel', 'correspondant_idref', KNOWN);
check('second run: nothing to do', [done.updates.length, done.choicesChanged], [0, false]);
check('no --from: no row moved', planMigration(rows, opts, '', 'correspondant_idref', KNOWN).updates.length, 0);

console.log(ko ? `${ko} failure(s)` : 'All checks passed');
process.exit(ko ? 1 : 0);
