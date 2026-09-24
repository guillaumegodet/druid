#!/usr/bin/env node
/**
 * Inventory of French identifiers declared in the TypeScript sources (docs/plan-langue-source-en.md,
 * chantier B, lot B0). For every declared name (variables, functions, parameters, properties,
 * interface members, types, enums, JSX props) whose camelCase/snake_case words contain a French
 * word, the report says where it is declared and whether the same name crosses the client
 * boundary — which makes it a *contract key* that must not be renamed on its own (decision D12):
 *
 *   cjs     found in scripts/*.cjs|.js|.mjs, server.cjs or functions/ (Node side, untyped)
 *   cache   found as a JSON key in ../cache-data/*.json or public/*.json (persisted caches)
 *   py      found in /opt/druid-biblio Python sources (druid-etl-api contract)
 *   quoted  used as a string literal in the TS sources ('name' / "name": Grist column, URL param…)
 *
 * Usage: node scripts/tests/french_identifiers.mjs [--json] [--min=N] [--internal]
 *   --internal  only names that cross no boundary (candidates for renaming)
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const ONLY_INTERNAL = argv.includes('--internal');
const MIN = Number((argv.find((a) => a.startsWith('--min=')) || '--min=1').slice(6));

// French words likely to appear inside identifiers. Words that are also English or are
// established data/domain names (labo, annuaire, uid, statut…) are deliberately left out:
// the goal is a reviewable list, not an exhaustive one.
const FRENCH = new Set(`
renseigner enrichir ambigu ambigus conflit conflits trouve trouves arbitrer mettre orphelin orphelins
doublon doublons creer sans fiche fiches candidat candidats libelle libelles categorie categories charte
conforme conformes bilan effectif effectifs sous etablissement etablissements equipe equipes chercheur
chercheurs valider rejeter hors lignes ligne colonne colonnes nom prenom civilite sigle sigles revue
recherche resultat resultats rattachement rattachements fusion fusions partenaire partenaires pays
financeur financeurs journaux ouvrage ouvrages these theses emploi emplois tutelle tutelles appartenance
appartenances valide validee valides perime perimee externe externes interne internes parti retraite
emerite emerites doctorant doctorants vacataire vacataires nouveau nouvelle ancien ancienne derniere
dernier maj modifies modifie champs champ cible cibles requete fichier fichiers dossier chargement
enregistrement ecriture lecture suppression mise mises apres avant depuis entre selon tous toutes aucun
aucune plusieurs autre autres meme seul seule nb compteur taux moyenne mediane poids rang tri filtre
filtres onglet onglets bouton lien liens texte titre resume commentaire commentaires annee annees mois
semaine jour jours heure heures debut periode duree courant courante precedent precedente suivant
suivante premier premiere actif actifs inactif masque affiche afficher choix valeur valeurs cle cles etat
etape etapes niveau niveaux pole poles axe axes thematique thematiques sujet sujets mot mots liste listes
tableau tableaux graphique graphiques courbe courbes carte cartes reseau reseaux repartition ventilation
synthese apercu erreur erreurs avertissement echec succes attente cours termine demarre lancer relancer
executer appliquer annuler confirmer supprimer ajouter modifier enregistrer sauvegarder charger recharger
telecharger exporter importer envoyer recevoir rechercher trouver verifier fusionner qualifier detacher
rattacher calculer compter trier filtrer masquer ouvrir fermer lire ecrire obtenir recuperer generer
produire construire ouvert ouverte ferme fermee vide vides plein grand grande petit petite court courte
haut haute bas basse bon bonne mauvais vrai faux fausse necessaire obligatoire facultatif optionnel
principal principale principaux secondaire secondaires propre different differente differents egal
superieur inferieur moyen moyenne nombre quantite montant prix cout depense depenses paiement paiements
payeur facture factures retour retours depart departs arrivee entree entrees sortie sorties acces droit
droits groupe groupes membre membres utilisateur utilisateurs compte comptes profil profils identifiant
identifiants identite personne personnes personnel salarie employe employeur employeurs  
  metier unite unites departement departements composante composantes faculte ecole ecoles
universite universites organisme organismes    federation federations
partenariat partenariats echange echanges chapitre chapitres colloque colloques   
brevet brevets logiciel logiciels donnee donnees jeu jeux entrepot  reponse reponses adresse
adresses courriel courriels telephone ville villes    europeen francais francaise
etranger   anglais traduction traductions intitule naissance  affectation affectations
  disponibilite indisponible fiabilise fiabilisee fiabiliser signalement  
   veille      reglement regle regles seuil seuils
existant existants manquant manquants absent absente absents presents present presente inconnu inconnue
indetermine       libre libres autorise autorisee refuse refusee
`.split(/\s+/).filter(Boolean));

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (id) => id.split(/[_$]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map(strip).filter(Boolean);
const isFrench = (id) => words(id).some((w) => FRENCH.has(w));

// ---------------------------------------------------------------------------------------
// Declarations in TS/TSX
// ---------------------------------------------------------------------------------------
const SKIP = new Set(['node_modules', 'dist', '.git', '.build', 'locales', 'public', 'cache-data', 'data', '.venv', 'venv', '__pycache__']);
function walk(dir, test, out = [], base = dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, test, out, base);
    else if (test(p)) out.push(path.relative(base, p));
  }
  return out;
}
const tsFiles = walk(ROOT, (p) => /\.tsx?$/.test(p)).sort();
const decl = new Map(); // name -> { kinds:Set, files:Set, count }
const add = (name, kind, file) => {
  if (!name || name.length < 3 || !isFrench(name)) return;
  const e = decl.get(name) || { kinds: new Set(), files: new Set(), count: 0 };
  e.kinds.add(kind); e.files.add(file); e.count++;
  decl.set(name, e);
};
const patternNames = (p, out = []) => {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'ArrayPattern': p.elements.forEach((e) => patternNames(e, out)); break;
    case 'ObjectPattern': p.properties.forEach((pr) => patternNames(pr.type === 'RestElement' ? pr.argument : pr.value, out)); break;
    case 'TSParameterProperty': patternNames(p.parameter, out); break;
  }
  return out;
};
const keyName = (k) => (k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null);
const sources = new Map();
for (const f of tsFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  sources.set(f, src);
  let ast;
  try { ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); } catch (e) { console.error(`parse error ${f}: ${e.message}`); continue; }
  traverse(ast, {
    VariableDeclarator(p) { patternNames(p.node.id).forEach((n) => add(n, 'var', f)); },
    FunctionDeclaration(p) { if (p.node.id) add(p.node.id.name, 'function', f); p.node.params.forEach((pr) => patternNames(pr).forEach((n) => add(n, 'param', f))); },
    ArrowFunctionExpression(p) { p.node.params.forEach((pr) => patternNames(pr).forEach((n) => add(n, 'param', f))); },
    FunctionExpression(p) { p.node.params.forEach((pr) => patternNames(pr).forEach((n) => add(n, 'param', f))); },
    ClassMethod(p) { const n = keyName(p.node.key); if (n) add(n, 'method', f); p.node.params.forEach((pr) => patternNames(pr).forEach((n2) => add(n2, 'param', f))); },
    ClassProperty(p) { const n = keyName(p.node.key); if (n) add(n, 'field', f); },
    ObjectProperty(p) { if (!p.node.computed) { const n = keyName(p.node.key); if (n) add(n, 'key', f); } },
    ObjectMethod(p) { const n = keyName(p.node.key); if (n) add(n, 'key', f); },
    TSPropertySignature(p) { const n = keyName(p.node.key); if (n) add(n, 'member', f); },
    TSMethodSignature(p) { const n = keyName(p.node.key); if (n) add(n, 'member', f); },
    TSInterfaceDeclaration(p) { add(p.node.id.name, 'type', f); },
    TSTypeAliasDeclaration(p) { add(p.node.id.name, 'type', f); },
    TSEnumDeclaration(p) { add(p.node.id.name, 'type', f); },
    TSEnumMember(p) { const n = keyName(p.node.id); if (n) add(n, 'enum', f); },
    JSXAttribute(p) { if (p.node.name.type === 'JSXIdentifier') add(p.node.name.name, 'prop', f); },
  });
}

// ---------------------------------------------------------------------------------------
// Boundary flags
// ---------------------------------------------------------------------------------------
const readAll = (files) => files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
const nodeSide = readAll([
  path.join(ROOT, 'server.cjs'),
  ...walk(path.join(ROOT, 'scripts'), (p) => /\.(c?js|mjs)$/.test(p)).map((f) => path.join(ROOT, 'scripts', f)),
  ...walk(path.join(ROOT, 'functions'), (p) => /\.js$/.test(p)).map((f) => path.join(ROOT, 'functions', f)),
]);
const jsonDirs = [path.join(ROOT, '..', 'cache-data'), path.join(ROOT, 'public')];
const cacheJson = readAll(jsonDirs.flatMap((d) => { try { return fs.readdirSync(d).filter((n) => n.endsWith('.json')).map((n) => path.join(d, n)); } catch { return []; } }));
const pyWords = new Set();
try {
  for (const f of walk('/opt/druid-biblio', (p) => p.endsWith('.py'))) {
    for (const m of fs.readFileSync(path.join('/opt/druid-biblio', f), 'utf8').matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) pyWords.add(m[0]);
  }
} catch { /* druid-biblio not mounted on this host */ }
const tsAll = [...sources.values()].join('\n');

const rows = [];
for (const [name, e] of decl) {
  if (e.count < MIN) continue;
  const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
  const flags = [];
  if (re.test(nodeSide)) flags.push('cjs');
  if (new RegExp(`"${name}"\\s*:`).test(cacheJson)) flags.push('cache');
  if (pyWords.has(name)) flags.push('py');
  if (new RegExp(`['"]${name}['"]`).test(tsAll)) flags.push('quoted');
  if (ONLY_INTERNAL && flags.length) continue;
  rows.push({ name, count: e.count, files: e.files.size, kinds: [...e.kinds].sort().join(','), flags: flags.join(','), example: [...e.files][0] });
}
rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
console.log(`${rows.length} French identifiers declared in ${tsFiles.length} TS files${ONLY_INTERNAL ? ' (internal only)' : ''}\n`);
console.log('count files kinds                 boundary        name                          example');
for (const r of rows) console.log(`${String(r.count).padStart(5)} ${String(r.files).padStart(5)} ${r.kinds.padEnd(21)} ${(r.flags || '—').padEnd(15)} ${r.name.padEnd(29)} ${r.example}`);
