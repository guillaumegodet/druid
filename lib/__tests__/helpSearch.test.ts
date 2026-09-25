import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

// « Aide Druid » assistant retrieval (scripts/lib/help_search.cjs, plan-documentation-utilisateur.md lot 8),
// run against the real help centre pages: a question from the reference set must bring its page first.
const { loadHelpIndex, searchHelp, buildHelpSystemPrompt, tokenize } = createRequire(import.meta.url)(
  '../../scripts/lib/help_search.cjs',
);
const index = loadHelpIndex(path.resolve(__dirname, '../../help/src/content/docs'));

const REFERENCE: [string, string][] = [
  ['Comment valider une fiche ?', '/guides/personnes/fiabiliser-statut-rattachement/'],
  ['Que veut dire le statut Parti ?', '/donnees/statuts-des-personnes/'],
  ['Comment fusionner deux fiches en doublon ?', '/guides/personnes/traiter-un-doublon/'],
  ['Qui peut donner des droits à un collègue ?', '/guides/administration/donner-des-droits/'],
  ["C'est quoi le FWCI ?", '/donnees/indicateurs/'],
  ["Pourquoi une publication n'apparaît pas dans le tableau de bord ?", '/guides/corriger/publication-manquante/'],
  ['Comment créer un groupe de chercheurs ?', '/guides/structures-groupes/creer-un-groupe/'],
  ['Intégrer un graphique sur le site du labo', '/guides/tableau-de-bord/integrer-une-dataviz/'],
];

describe('help_search', () => {
  it('indexes every published help page by section', () => {
    expect(index.pageCount).toBeGreaterThan(40);
    expect(index.docs.length).toBeGreaterThan(200);
    expect(index.docs.some((d: { heading: string }) => /^voir aussi$/i.test(d.heading))).toBe(false);
  });

  it('folds accents, drops stop words and plurals', () => {
    expect(tokenize('Comment créer les Équipes ?')).toEqual(['creer', 'equipe']);
  });

  it.each(REFERENCE)('« %s » → %s first', (question, page) => {
    const [best] = searchHelp(index, question, 3);
    expect(best.url.split('#')[0]).toBe(page);
  });

  it('puts the retrieved excerpts, with absolute links, in the system prompt', () => {
    const hits = searchHelp(index, 'Comment valider une fiche ?', 2);
    const prompt = buildHelpSystemPrompt(hits, 'https://aide.example');
    expect(prompt).toContain(`(https://aide.example${hits[0].url})`);
    expect(prompt).toContain('UNIQUEMENT');
  });

  it('returns nothing for an off-topic question', () => {
    expect(searchHelp(index, 'recette du far breton', 3)).toEqual([]);
  });
});

// English help centre (`help/src/content/docs/en`): the same pages, served under `/en/`.
const indexEn = loadHelpIndex(path.resolve(__dirname, '../../help/src/content/docs'), 'en');

const REFERENCE_EN: [string, string][] = [
  ['How do I validate a record?', '/en/guides/personnes/fiabiliser-statut-rattachement/'],
  ['What does the status Left mean?', '/en/donnees/statuts-des-personnes/'],
  ['How do I merge two duplicate records?', '/en/guides/personnes/traiter-un-doublon/'],
  ['Who can give rights to a colleague?', '/en/guides/administration/donner-des-droits/'],
  ['What is the FWCI?', '/en/donnees/indicateurs/'],
  ['Why is a publication missing from the dashboard?', '/en/guides/corriger/publication-manquante/'],
  ['How do I create a group of researchers?', '/en/guides/structures-groupes/creer-un-groupe/'],
  ['Embed a chart in the lab website', '/en/guides/tableau-de-bord/integrer-une-dataviz/'],
];

describe('help_search (English)', () => {
  it('indexes the English pages only, under /en/', () => {
    expect(indexEn.pageCount).toBeGreaterThan(40);
    expect(indexEn.docs.every((d: { url: string }) => d.url.startsWith('/en/'))).toBe(true);
    expect(index.docs.some((d: { url: string }) => d.url.startsWith('/en/'))).toBe(false);
    expect(indexEn.docs.some((d: { heading: string }) => /^see also$/i.test(d.heading))).toBe(false);
  });

  it.each(REFERENCE_EN)('« %s » → %s first', (question, page) => {
    const [best] = searchHelp(indexEn, question, 3);
    expect(best.url.split('#')[0]).toBe(page);
  });

  it('asks for an English answer', () => {
    const hits = searchHelp(indexEn, 'How do I validate a record?', 2);
    const prompt = buildHelpSystemPrompt(hits, 'https://help.example', undefined, 'en');
    expect(prompt).toContain(`(https://help.example${hits[0].url})`);
    expect(prompt).toContain('Answer in English');
  });
});
