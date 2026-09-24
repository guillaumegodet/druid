// Document frequency of significant words — port of _keyword_frequencies
// from the old Streamlit dashboard of druid-biblio (removed on 2026-09-10, see git history): words of ≥ 4 letters from titles and OpenAlex topics
// (abstracts are not exported to dashboard.json), FR/EN stopwords
// excluded, counted ONCE per publication.

import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';

const WORD_RE = /[a-zàâäçéèêëîïíôöóùûüúÿœ]{4,}/g;

// Same list as the Streamlit one (dashboard.py, _STOPWORDS)
const STOPWORDS = new Set(
  `le la les un une des du de au aux en dans pour par sur avec sans sous vers chez
ce cet cette ces son sa ses leur leurs notre nos votre vos qui que quoi dont mais
est sont etre etant ete avoir ayant ont deux trois ainsi donc plus moins tres
nous vous ils elles elle cela entre lors selon afin peut peuvent aussi comme cas
etude etudes analyse analyses resultats resultat methode methodes modele modeles
approche cadre travail travaux article nouvelle nouveau nouveaux notamment effet
the and for with from this that these those their our your they not are was were
have has had been being which whom what when where while into onto over under
study studies analysis approach approaches results result method methods model
models using used based paper novel new towards within between three high low
both also however therefore thus can may will more most less than then them this`
    .split(/\s+/)
    .filter(Boolean),
);

export interface KeywordFreq {
  word: string;
  count: number;
}

export function keywordFrequencies(
  pubs: DashboardPublication[],
  range: YearRange,
  maxRows = 3000,
): KeywordFreq[] {
  // maxRows caps the RETURNED frequency table, not the publications scanned: truncating
  // them upstream (dataset.publications order, not a sample) silently under-represented
  // large dashboards (institution level, tens of thousands of publications) —
  // review lot 8.
  const inRange = pubs.filter(
    (p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end,
  );

  const counts = new Map<string, number>();
  for (const p of inRange) {
    const seen = new Set<string>();
    const texts = [p.title ?? '', ...p.topics];
    for (const text of texts) {
      for (const m of text.toLowerCase().matchAll(WORD_RE)) {
        if (!STOPWORDS.has(m[0])) seen.add(m[0]);
      }
    }
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxRows);
}
