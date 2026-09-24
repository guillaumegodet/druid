// Run: docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/idref-qualinka.cjs
// Harness for the pure functions of sync_idref_qualinka.cjs (no network, no Grist) —
// untested until now (see docs/archive/lot0-inventaire-derive-2026-09-18.md, docs/archive/plan-fusion-centrale-2026-09.md
// § 3 sub-lot 3: the script was reworked to reuse scripts/lib/align_common.cjs instead of
// duplicating its HTTP/Grist/cache foundation).
const { computeAlignDiff, buildIdrefReviewColumns, tokens, dice, coverage } = require('../sync_idref_qualinka.cjs');

let ko = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ko++;
  console.log(`${ok ? 'OK ' : 'KO '} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (attendu ${JSON.stringify(want)})`}`);
};

// ── tokens/dice/coverage ──────────────────────────────────────────────────────
check('tokens: accents + stop words', tokens('de la Recherche Étienne'), ['recherche', 'etienne']);
check('dice : ensembles disjoints', dice(new Set(['a']), new Set(['b'])), 0);
check('dice : recouvrement total', dice(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
check('coverage : vide', coverage([], new Set(['a'])), 0);
check('coverage: half', coverage(['a', 'b'], new Set(['a'])), 0.5);

// ── computeAlignDiff ──────────────────────────────────────────────────────────
const ALL = [
  { key: 'u1', recId: 1, uid: 'u1', first: 'Ada', last: 'Lovelace', idref: '', orcid: '', idhal: '', labo: 'LS2N' },
  { key: 'g2', recId: 2, uid: '', first: 'Guest', last: 'External', idref: '', orcid: '', idhal: '', labo: 'CEISAM' },
  { key: 'u3', recId: 3, uid: 'u3', first: 'Already', last: 'Idreffed', idref: '026677604', orcid: '', idhal: '', labo: 'LS2N' },
];

{
  // accepted, no conflict → aRenseigner (IdRef + ORCID/IdHAL of the authority record). No death (current
  // researcher): a death before DEATH_MIN_YEAR (2015) would discard the candidate, see dedicated test below.
  const cache = {
    u1: { mode: 'align', status: 'accepted', best: '026677605', queryName: 'Ada Lovelace',
      identifiers: { orcid: '0000-0001-9900-9054', idhal: '' },
      candidates: [{ ppn: '026677605', prefered: 'Lovelace, Ada', birth: '1980' }] },
  };
  const { aRenseigner, ambigus } = computeAlignDiff(cache, ALL, new Set());
  check('accepted → 1 aRenseigner, 0 ambigus', [aRenseigner.length, ambigus.length], [1, 0]);
  check('aRenseigner: uid = cache key', aRenseigner[0].uid, 'u1');
  check('aRenseigner : candidat = best', aRenseigner[0].candidate.ppn, '026677605');
  check('aRenseigner: ORCID of the record proposed', aRenseigner[0].candidate.orcid, '0000-0001-9900-9054');
}

{
  // ambiguous → ambigus, g<recId> key for an external preserved
  const cache = {
    g2: { mode: 'align', status: 'ambiguous', queryName: 'Guest External',
      candidates: [{ ppn: '111', prefered: 'External, Guest A' }, { ppn: '222', prefered: 'External, Guest B' }] },
  };
  const { aRenseigner, ambigus } = computeAlignDiff(cache, ALL, new Set());
  check('ambiguous → 0 aRenseigner, 1 ambigus', [aRenseigner.length, ambigus.length], [0, 1]);
  check('ambigus: external key g<recId> preserved', ambigus[0].uid, 'g2');
  check('ambigus: both candidates surface', ambigus[0].candidates.length, 2);
}

{
  // candidate rejected in the Grist review (blacklist) → discarded from the diff
  const cache = {
    u1: { mode: 'align', status: 'accepted', best: '026677605', queryName: 'Ada Lovelace',
      candidates: [{ ppn: '026677605', prefered: 'Lovelace, Ada' }] },
  };
  const rejected = new Set(['u1::026677605']);
  const { aRenseigner, ambigus } = computeAlignDiff(cache, ALL, rejected);
  check('rejected candidate → no suggestion', [aRenseigner.length, ambigus.length], [0, 0]);
}

{
  // record already holding an IdRef → never proposed, even if in the cache
  const cache = {
    u3: { mode: 'align', status: 'accepted', best: '026677605', queryName: 'Already Idreffed',
      candidates: [{ ppn: '026677605', prefered: 'Idreffed, Already' }] },
  };
  const { aRenseigner } = computeAlignDiff(cache, ALL, new Set());
  check('IdRef already filled → no IdRef proposal (only ORCID/IdHAL if missing)', aRenseigner.length, 0);
}

{
  // candidate obviously deceased before DEATH_MIN_YEAR (2015) → obvious bad candidate, discarded
  // even if it was the "best" of the run (the researchers looked up are current staff/PhD students)
  const cache = {
    u1: { mode: 'align', status: 'accepted', best: '026677605', queryName: 'Ada Lovelace',
      candidates: [{ ppn: '026677605', prefered: 'Lovelace, Ada', birth: '1815', death: '1852' }] },
  };
  const { aRenseigner, ambigus } = computeAlignDiff(cache, ALL, new Set());
  check('candidate deceased before 2015 → discarded (no suggestion)', [aRenseigner.length, ambigus.length], [0, 0]);
}

{
  // mode != 'align' (cache of another script) → ignored
  const cache = { u1: { mode: 'search', status: 'found' } };
  const { aRenseigner, ambigus } = computeAlignDiff(cache, ALL, new Set());
  check('entry with mode!=align ignored', [aRenseigner.length, ambigus.length], [0, 0]);
}

// ── buildIdrefReviewColumns (schema shared with the review table) ────────────
{
  const cols = buildIdrefReviewColumns();
  const ids = cols.map((c) => c.id);
  check('Annuaire_id column present (Nantes superset schema)', ids.includes('Annuaire_id'), true);
  check('uid_dyna column present', ids.includes('uid_dyna'), true);
  check('shared decision columns carried over (Decision)', ids.includes('Decision'), true);
  check('shared decision columns carried over (Meler_action)', ids.includes('Meler_action'), true);
}

console.log(ko === 0 ? '\nAll OK' : `\n${ko} failure(s)`);
if (ko) process.exit(1);
