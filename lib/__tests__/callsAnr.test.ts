import { describe, expect, it } from 'vitest';
import { aapgTextUrl, anrStatus, ercPanelsOf, parseAapgAxes, parseAnrCallPage, parseAnrListing, sdgsOf } from '../calls/anr';
import { aapgAxisCallId, anrCallId, collectFromAnr, MIN_AAPG_AXES } from '../calls/collectAnr';
import type { CollectedCall, CollectorStore, StoredCallSummary } from '../calls/collect';
import { ANR_PROGRAMMES_BUILT_IN } from '../calls/programmes';

// Fragments shaped like the pages of anr.fr (2026-10-16): cards of the list of calls, page of a call with its timeline.
const card = (uid: string, tag: string, label: string, href: string, title: string) => `
  <!--
  Score: 1
  Document ID:  7ec53ff8/tx_anrprojects_domain_model_requestforprojects/${uid}
  -->
  <div class="card appel col-12"><div class="card-header pb-0"><div class="categories XPA2">
    <span class="tag-type" data-tag-type="${tag}">
      ${label}
    </span></div><div class="date my-2">Septembre 2026 - Novembre 2026</div></div>
  <div class="card-body d-flex flex-column"><div class="content mb-auto h-100"><div class="main_content h-100">
    <h2>
      <a href="${href}">
        ${title}
      </a>
    </h2></div>
    <div class="abstract h-100 d-none"><p>Résumé de ${uid} &amp; co.</p></div></div>
    <a href="${href}"><div class="circle_icon next"></div></a>
  </div></div>`;

const listing = (...cards: string[]) => `<html><body><div class="cards">${cards.join('\n')}</div></body></html>`;

const page = (title: string, state: string, open: [string, string], tasks: [string, string][], body = '<p>Texte de l’appel.</p>', documents: string[] = []) => `
<html><body><nav class="page-breadcrumbs"></nav>
<div class="page-grid__content"><div id="c1" class="section">
<section class="content-style">
  <div class="categories"><span class="tag-type">${state}</span></div>
<h1>
  ${title}
</h1>
<p class="teaser">Chapeau &laquo; de &raquo; l’appel.</p>
<section class="section section-timeline-small"><div class="timeline-small load"><div class="timeline-small-header">
  <div class="project in-progress" data-start="${open[0]}" data-end="${open[1]}"> <span class="project-title">Ouvert</span> </div>
  <div class="project" data-start="" data-end=""> <span class="project-title">Clos</span> </div>
</div><div class="timeline-small-content">
${tasks.map(([d, label]) => `<div class="task" data-date="${d}"> <span class="task-line"></span> <span class="task-title">${label}&nbsp;:</span> <span class="task-date"> x </span> </div>`).join('\n')}
</div></div></section>
${body}
<div class="row"><ul class="download-section">${documents.map((d) => `<li><a href="${d}">Document</a></li>`).join('')}</ul></div>
<!-- end of the content
</section>
<section class="content-style block block-primary block-misenavant"><p>Mise en avant</p></section>
<div class="sidebar-summary"><p>Actualités</p></div>
<footer>Cookies</footer>
</body></html>`;

describe('parseAnrListing', () => {
  it('reads the identifier, type, title, link and abstract of every card', () => {
    const cards = parseAnrListing(listing(
      card('2002', '2', 'Appel à projets spécifique', '/fr/detail/call/pre-annonce-futurefoods/', 'Pré-annonce : FutureFoodS'),
      card('1993', '5', 'France 2030', '/fr/france-2030/france2030/call/pepr-gfm/', 'France 2030 - PEPR GFM'),
      card('2002', '2', 'Appel à projets spécifique', '/fr/detail/call/pre-annonce-futurefoods/', 'Pré-annonce : FutureFoodS'),
    ));
    expect(cards).toEqual([
      { uid: '2002', url: 'https://anr.fr/fr/detail/call/pre-annonce-futurefoods/', title: 'Pré-annonce : FutureFoodS', type: 'specific', typeLabel: 'Appel à projets spécifique', abstract: 'Résumé de 2002 & co.' },
      { uid: '1993', url: 'https://anr.fr/fr/france-2030/france2030/call/pepr-gfm/', title: 'France 2030 - PEPR GFM', type: 'france-2030', typeLabel: 'France 2030', abstract: 'Résumé de 1993 & co.' },
    ]);
  });
  it('is empty for a page without cards', () => {
    expect(parseAnrListing('<html><body>Maintenance</body></html>')).toEqual([]);
  });
});

describe('parseAnrCallPage', () => {
  const html = page('France 2030 - PEPR MOBIDEC : &quot;Mobilités&quot;', 'Ouvert – 2026', ['2026-07-01T09:00:00+02:00', '2026-12-15T11:00:00+01:00'],
    [['2026-07-01T09:00:00+02:00', 'Ouverture'], ['2026-09-17T11:00:00+02:00', 'Clôture des lettres d’intention'], ['2026-12-15T11:00:00+01:00', 'Clôture']],
    '<div id="infos"><p>Trois défis :</p><ul><li>usages ;</li><li>données.</li></ul></div><script>var x = 1;</script>',
    ['/fileadmin/aap/2026/france2030-aap-pepr-mobidec-2026.pdf']);
  const p = parseAnrCallPage(html, 'https://anr.fr/fr/france-2030/france2030/call/mobidec/')!;
  it('reads the title, the state and the dates of the timeline', () => {
    expect(p.title).toBe('France 2030 - PEPR MOBIDEC : "Mobilités"');
    expect(p.stateLabel).toBe('Ouvert – 2026');
    expect(p.status).toBe('open');
    expect(p.openingDate).toBe('2026-07-01');
    expect(p.deadlines).toEqual(['2026-09-17', '2026-12-15']);
  });
  it('keeps the lead and the body, without the timeline, documents, scripts, comments and side blocks', () => {
    expect(p.text).toBe('Chapeau « de » l’appel.\n\nTrois défis :\n- usages ;\n- données.');
    expect(p.documents).toEqual(['https://anr.fr/fileadmin/aap/2026/france2030-aap-pepr-mobidec-2026.pdf']);
  });
  it('takes the state of the page over the timeline, and is null without a call', () => {
    expect(anrStatus('Pré-annonce – 2027')).toBe('forthcoming');
    expect(anrStatus('Clos – 2027')).toBe('closed');
    expect(anrStatus('')).toBe('unknown');
    expect(parseAnrCallPage('<html><body>Page introuvable</body></html>')).toBeNull();
  });
  it('finds the text of the generic call among its documents', () => {
    const docs = ['https://anr.fr/fileadmin/aap/2027/anr-aapg-2027-guide-v1.0.pdf', 'https://anr.fr/fileadmin/aap/2027/anr-aapg-2027.pdf'];
    expect(aapgTextUrl(docs, 2027)).toBe('https://anr.fr/fileadmin/aap/2027/anr-aapg-2027.pdf');
    expect(aapgTextUrl(docs, 2028)).toBeNull();
  });
});

// Excerpt of the text of the AAPG 2027 as pdf.js gives it: table of contents, running footers, wrapped headings.
const AAPG_TEXT = `Sommaire
Domaine « Sciences du numérique » ........................................ 65
Axe E.02 : Intelligence artificielle et science des données ..................... 65
Domaine « Physique subatomique ; sciences de l’Univers et sciences de la Terre » .................. 73
Axe H.15 : Interfaces : mathématiques, sciences du numérique – sciences humaines et sociales ou
autres disciplines ........................................ 93
Introduction générale de l’appel, sans contact.
\f
Domaine « Sciences du numérique »
Le domaine regroupe six axes.
Axe E.02 : Intelligence artificielle et science des données
Contact : contact(at)anr.fr

AAPG 2027_V1.0 –15 juillet 2026 66
Cet axe de recherche attend des recherches en intelligence artificielle portant sur l’apprentissage
automatique et la science des données. Les thèmes suivants sont donnés à titre indicatif :
• méthodes et modèles de grands volumes de données ;
• apprentissage automatique : théorie, optimisation, micro-
organismes numériques.
Mots-clés associés : agentification; apprentissage automatique (supervisé, non supervisé);
causalité; web sémantique.
Code.s ERC associé.s : PE01, PE6, PE07_3
ODD associé.s : 9, 14
Domaine « Physique subatomique ; sciences de l’Univers et sciences de
la Terre »
Ce domaine est constitué de deux axes.
Axe G.02. : Physique subatomique et astrophysique
Contacts : a(at)anr.fr ; b(at)anr.fr
Physique des particules.
Mots-clés associés : neutrinos
Code.s ERC associé.s : PE02_02 à PE02_07, PE09_05
ODD associé.s : 9
Axes transversaux
Axe H.15 : Interfaces : mathématiques, sciences du numérique – sciences humaines et
sociales
Contacts : c(at)anr.fr
Recherches interdisciplinaires.
Code.s ERC associé.s : SH1, PE06
ODD associé.s : l’ensemble des 17 ODD
Annexe 1 : liste des IR
Texte de l’annexe.`;

describe('parseAapgAxes', () => {
  const axes = parseAapgAxes(AAPG_TEXT);
  it('reads every axis once, with its domain, skipping the table of contents', () => {
    expect(axes.map((a) => [a.code, a.domain, a.title])).toEqual([
      ['E.02', 'Sciences du numérique', 'Intelligence artificielle et science des données'],
      ['G.02', 'Physique subatomique ; sciences de l’Univers et sciences de la Terre', 'Physique subatomique et astrophysique'],
      ['H.15', 'Axes transversaux', 'Interfaces : mathématiques, sciences du numérique – sciences humaines et sociales'],
    ]);
  });
  it('joins the wrapped lines of the description, keeps the bullets, drops the footers', () => {
    expect(axes[0].description).toBe('Cet axe de recherche attend des recherches en intelligence artificielle portant sur l’apprentissage automatique et la science des données. '
      + 'Les thèmes suivants sont donnés à titre indicatif :\n• méthodes et modèles de grands volumes de données ;\n• apprentissage automatique : théorie, optimisation, micro-organismes numériques.');
    expect(axes[2].description).toBe('Recherches interdisciplinaires.');
  });
  it('splits the keywords on semicolons, normalises the ERC panels and the SDGs', () => {
    expect(axes[0].keywords).toEqual(['agentification', 'apprentissage automatique (supervisé, non supervisé)', 'causalité', 'web sémantique']);
    expect(axes[0].ercPanels).toEqual(['PE01', 'PE06', 'PE07']);
    expect(axes[0].sdgs).toEqual([9, 14]);
    expect(axes[1].ercPanels).toEqual(['PE02', 'PE09']);
    expect(axes[2].keywords).toEqual([]);
    expect(axes[2].sdgs).toHaveLength(17);
  });
  it('helpers', () => {
    expect(ercPanelsOf('LS07_8 à 13 et 16, LS09 (à l’exclusion de LS09_2), majeurs : PE2')).toEqual(['LS07', 'LS09', 'PE02']);
    expect(sdgsOf('3, 9, 21')).toEqual([3, 9]);
  });
});

class MemoryStore implements CollectorStore {
  calls = new Map<string, CollectedCall>();
  closed: string[] = [];
  async storedCalls(programmeIds: string[]): Promise<StoredCallSummary[]> {
    return [...this.calls.values()].filter((c) => programmeIds.includes(c.programmeId)).map((c) => ({
      callId: c.callId, programmeId: c.programmeId, title: c.title, deadlines: c.deadlines, openingDate: c.openingDate, status: c.status,
      hasText: c.objectives !== '' || c.scope !== '', contentHash: c.contentHash,
    }));
  }
  async upsertCall(call: CollectedCall) {
    const existed = this.calls.has(call.callId);
    this.calls.set(call.callId, call);
    return existed ? 'updated' as const : 'new' as const;
  }
  async updateCallDates(callId: string, status: CollectedCall['status'], deadlines: string[], openingDate: string | null) {
    const c = this.calls.get(callId)!;
    this.calls.set(callId, { ...c, status, deadlines, openingDate });
    if (status === 'closed') this.closed.push(callId);
  }
  async removeCalls() { return 0; }
}

/** Text of a generic call with `n` axes. */
const aapgText = (n: number) => ['Domaine « Sciences du numérique »', ...Array.from({ length: n }, (_, i) => [
  `Axe E.${String(i + 1).padStart(2, '0')} : Axe numéro ${i + 1}`, 'Contact : x(at)anr.fr', `Description de l’axe ${i + 1}.`,
  'Mots-clés associés : a; b', 'Code.s ERC associé.s : PE06', 'ODD associé.s : 9',
].join('\n'))].join('\n');

const site = (pages: Record<string, string>) => async (url: string) => pages[url] ?? null;
const LISTING = 'https://anr.fr/fr/appels/';
const SPECIFIC = 'https://anr.fr/fr/detail/call/water4all/';
const PEPR = 'https://anr.fr/fr/france-2030/france2030/call/pepr-gfm/';
const AAPG_2027 = 'https://anr.fr/fr/aapg-2027/';
const AAPG_PDF = 'https://anr.fr/fileadmin/aap/2027/anr-aapg-2027.pdf';

const pages = (): Record<string, string> => ({
  [LISTING]: listing(
    card('1986', '2', 'Appel à projets spécifique', '/fr/detail/call/water4all/', 'Pré-annonce : Water4All'),
    card('1993', '5', 'France 2030', '/fr/france-2030/france2030/call/pepr-gfm/', 'France 2030 - PEPR GFM'),
    card('1700', '1', 'Appel à projets générique', '/fr/aapg-2027/', 'AAPG 2027'),
  ),
  [SPECIFIC]: page('Pré-annonce : Water4All', 'Pré-annonce – 2027', ['2026-09-01T09:00:00+02:00', '2026-11-30T17:00:00+01:00'], []),
  [PEPR]: page('France 2030 - PEPR GFM', 'Ouvert – 2026', ['2026-07-21T09:00:00+02:00', '2026-11-17T11:00:00+01:00'], []),
  [AAPG_2027]: page('AAPG - Appel à projets générique 2027', 'Clos – 2027', ['2026-07-16T09:00:00+02:00', '2026-10-14T17:00:00+02:00'], [], '<p>Principal appel.</p>', [AAPG_PDF]),
});

describe('collectFromAnr', () => {
  const programmes = [...ANR_PROGRAMMES_BUILT_IN];
  const run = (store: MemoryStore, p: Record<string, string>, pdf = aapgText(MIN_AAPG_AXES), today = '2026-10-16') =>
    collectFromAnr({ programmes, fetchPage: site(p), fetchPdfText: async (url) => (url === AAPG_PDF ? pdf : ''), store, today });

  it('writes the listed calls and the axes of the latest generic call, even closed', async () => {
    const store = new MemoryStore();
    const stats = await run(store, pages());
    expect(stats.errors).toEqual([]);
    expect(stats.new).toBe(2 + MIN_AAPG_AXES);
    const water = store.calls.get(anrCallId('1986'))!;
    expect(water).toMatchObject({ programmeId: 'anr-specific', status: 'forthcoming', openingDate: '2026-09-01', deadlines: ['2026-11-30'], url: SPECIFIC, lang: 'fr', objectives: '' });
    expect(water.scope).toContain('Texte de l’appel.');
    expect(store.calls.get(anrCallId('1993'))!.programmeId).toBe('france-2030');
    const axis = store.calls.get(aapgAxisCallId(2027, 'E.01'))!;
    expect(axis).toMatchObject({ programmeId: 'anr-aapg', subset: 'Sciences du numérique', title: 'Axe E.01 : Axe numéro 1', status: 'closed', deadlines: ['2026-10-14'], url: AAPG_2027 });
    expect(axis.scope).toBe('Description de l’axe 1.\n\nMots-clés : a ; b');
    expect(axis.taxonomy).toMatchObject({ call: 'AAPG-2027', axis: 'E.01', ercPanels: 'PE06', sdgs: '9' });
  });

  it('leaves unchanged calls alone and closes the calls no longer listed', async () => {
    const store = new MemoryStore();
    await run(store, pages());
    const again = await run(store, pages());
    expect(again).toMatchObject({ new: 0, updated: 0, unchanged: 2 + MIN_AAPG_AXES });
    const p = pages();
    p[LISTING] = listing(card('1993', '5', 'France 2030', '/fr/france-2030/france2030/call/pepr-gfm/', 'France 2030 - PEPR GFM'));
    const third = await run(store, p);
    expect(third.updated).toBe(1);
    expect(store.closed).toEqual([anrCallId('1986')]);
    expect(store.calls.get(anrCallId('1986'))!.status).toBe('closed');
  });

  it('reports an empty list and a badly read generic call instead of closing or writing anything', async () => {
    const store = new MemoryStore();
    await run(store, pages());
    const p = pages();
    p[LISTING] = '<html><body>Maintenance</body></html>';
    const stats = await run(store, p, aapgText(3));
    expect(stats.errors).toEqual([
      'list of calls: the list of calls has no card (page changed?)',
      `AAPG: AAPG 2027: 3 axes read in ${AAPG_PDF} (at least ${MIN_AAPG_AXES} expected)`,
    ]);
    expect(store.closed).toEqual([]);
  });

  it('prefers the next edition when it is published', async () => {
    const store = new MemoryStore();
    const p = pages();
    const pdf2028 = 'https://anr.fr/fileadmin/aap/2028/anr-aapg-2028.pdf';
    p['https://anr.fr/fr/aapg-2028/'] = page('AAPG 2028', 'Ouvert – 2028', ['2027-07-15T09:00:00+02:00', '2027-10-13T17:00:00+02:00'], [], '', [pdf2028]);
    await collectFromAnr({ programmes, fetchPage: site(p), fetchPdfText: async () => aapgText(MIN_AAPG_AXES), store, today: '2027-07-20' });
    expect(store.calls.get(aapgAxisCallId(2028, 'E.01'))!.status).toBe('open');
    expect(store.calls.has(aapgAxisCallId(2027, 'E.01'))).toBe(false);
  });

  it('skips a closed specific call it never saw', async () => {
    const store = new MemoryStore();
    const p = pages();
    p[SPECIFIC] = page('Water4All', 'Clos – 2026', ['2026-01-01T09:00:00+01:00', '2026-03-01T09:00:00+01:00'], []);
    const stats = await run(store, p);
    expect(stats.skippedClosed).toBe(1);
    expect(store.calls.has(anrCallId('1986'))).toBe(false);
  });
});
