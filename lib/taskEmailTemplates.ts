/**
 * Ready-to-copy researcher emails for the « À traiter › Tâches » tab
 * (docs/plan-chantiers-taches.md, lot 3). One French template per task type flagged
 * `email: true` in lib/tasks.ts (the email goes to a Nantes Université researcher, like the
 * newsletter review request of NewsletterPanel.validationMailto — the text is content, not
 * UI, hence French strings outside Lingui). Nothing is sent by Druid: the text is copied or
 * opened in the mail client (decision of 2026-09-23 — no automatic sending), and the user
 * then marks the task as waiting for the researcher.
 */
import { TASK_TYPES, isTaskType, type TaskType } from './tasks';

export interface TaskEmailContext {
  civility?: string;
  firstName: string;
  lastName: string;
  labo?: string;
  orcid?: string;
  halId?: string;
  scopusId?: string;
  /** Task description (often carries the second identifier or the observed detail). */
  description?: string;
  /** Sender display name (Keycloak session) for the signature. */
  senderName?: string;
}

export interface TaskEmail {
  subject: string;
  body: string;
}

const greet = (c: TaskEmailContext): string => {
  const civ = (c.civility || '').trim();
  const name = `${c.firstName} ${c.lastName}`.trim();
  if (civ === 'Mme') return `Bonjour Madame ${c.lastName},`;
  if (civ === 'M.') return `Bonjour Monsieur ${c.lastName},`;
  return `Bonjour ${name || ''},`.replace(/\s+,/, ',');
};

const intro = (c: TaskEmailContext): string =>
  `Dans le cadre du suivi des identifiants chercheurs de Nantes Université${c.labo ? ` (${c.labo})` : ''}, nous avons constaté un point à régulariser sur vos identifiants.`;

const closing = (c: TaskEmailContext): string =>
  ['Merci d’avance pour votre retour, et n’hésitez pas à nous solliciter en cas de question.', '', 'Bien cordialement,', c.senderName || '', 'Service commun de la documentation — Nantes Université'].join('\n');

const detail = (c: TaskEmailContext): string => (c.description ? `\nPrécision : ${c.description.trim()}\n` : '');

const TEMPLATES: Partial<Record<TaskType, (c: TaskEmailContext) => TaskEmail>> = {
  orcid_deux_ids: (c) => ({
    subject: 'Vos identifiants ORCID — deux profils à fusionner',
    body: [
      greet(c), '', intro(c),
      `Vous disposez de deux identifiants ORCID${c.orcid ? ` (dont ${c.orcid})` : ''}. Un seul identifiant doit être conservé pour que vos publications soient correctement rattachées à votre profil et à votre laboratoire.`,
      detail(c),
      'ORCID permet de fusionner les profils en quelques clics : connectez-vous au profil à conserver, puis « Paramètres du compte » → « Supprimer un compte en double ». La procédure est décrite ici :',
      'https://support.orcid.org/hc/fr/articles/360006896634',
      '',
      'Pouvez-vous nous indiquer l’identifiant conservé une fois la fusion faite ?',
      '', closing(c),
    ].join('\n'),
  }),
  orcid_absent: (c) => ({
    subject: 'Création de votre identifiant ORCID',
    body: [
      greet(c), '', intro(c),
      'Nous n’avons pas trouvé d’identifiant ORCID à votre nom. Cet identifiant gratuit et pérenne est désormais demandé par la plupart des financeurs et des éditeurs, et il permet de rattacher automatiquement vos publications à Nantes Université.',
      detail(c),
      'La création prend deux minutes : https://orcid.org/register',
      'Merci d’utiliser votre adresse professionnelle et d’indiquer « Nantes Université » comme affiliation.',
      '',
      'Pouvez-vous nous communiquer votre identifiant une fois créé ?',
      '', closing(c),
    ].join('\n'),
  }),
  orcid_profil_vide: (c) => ({
    subject: 'Votre profil ORCID est vide',
    body: [
      greet(c), '', intro(c),
      `Votre profil ORCID${c.orcid ? ` (${c.orcid})` : ''} ne contient ni affiliation ni publication : il ne peut donc pas servir à rattacher vos travaux à Nantes Université.`,
      detail(c),
      'Vous pouvez le compléter en quelques minutes : ajoutez « Nantes Université » dans la rubrique Emploi, puis importez vos publications (rubrique Travaux → « Rechercher et lier », par exemple depuis Crossref ou HAL).',
      'Pensez aussi à rendre ces informations visibles (« Tout le monde ») pour qu’elles soient prises en compte.',
      '', closing(c),
    ].join('\n'),
  }),
  hal_deux_idhal: (c) => ({
    subject: 'Vos identifiants HAL (IdHAL) — deux identifiants à fusionner',
    body: [
      greet(c), '', intro(c),
      `Vous disposez de deux IdHAL${c.halId ? ` (dont ${c.halId})` : ''}. Un seul identifiant doit rester actif pour que votre page HAL et votre CV HAL regroupent l’ensemble de vos dépôts.`,
      detail(c),
      'La fusion est réalisée par le support HAL : indiquez-nous l’identifiant à conserver, nous pouvons faire la demande pour vous, ou vous pouvez la faire directement depuis https://hal.science/ (Mon espace → IdHAL) ou via https://support.archives-ouvertes.fr/.',
      '', closing(c),
    ].join('\n'),
  }),
  hal_idhal_absent: (c) => ({
    subject: 'Création de votre identifiant HAL (IdHAL)',
    body: [
      greet(c), '', intro(c),
      'Nous n’avons pas trouvé d’IdHAL à votre nom. Cet identifiant regroupe toutes les formes auteur de vos dépôts HAL et permet de générer votre page personnelle et votre CV HAL.',
      detail(c),
      'La création se fait depuis votre espace HAL : https://hal.science/ → Mon espace → Mon IdHAL. Si vous disposez déjà d’un ORCID, pensez à l’associer à cette occasion.',
      '',
      'Pouvez-vous nous communiquer votre IdHAL une fois créé ?',
      '', closing(c),
    ].join('\n'),
  }),
  hal_affiliation_obsolete: (c) => ({
    subject: 'Affiliation de vos dépôts HAL',
    body: [
      greet(c), '', intro(c),
      `Vos dépôts HAL récents ne sont pas rattachés à votre structure actuelle${c.labo ? ` (${c.labo})` : ''}, ce qui les rend invisibles dans les collections et les bilans du laboratoire.`,
      detail(c),
      'Vous pouvez corriger l’affiliation depuis votre espace HAL (Mon espace → Mes dépôts → Modifier les métadonnées), ou nous indiquer les dépôts concernés : nous pouvons demander la correction.',
      '', closing(c),
    ].join('\n'),
  }),
  scopus_deux_ids: (c) => ({
    subject: 'Vos identifiants Scopus — deux profils auteur à fusionner',
    body: [
      greet(c), '', intro(c),
      `Scopus vous attribue deux profils auteur${c.scopusId ? ` (dont ${c.scopusId})` : ''}, ce qui disperse vos publications et fausse les indicateurs de citation.`,
      detail(c),
      'La fusion se demande auprès d’Elsevier, en quelques clics, via l’Author Feedback Wizard : https://www.scopus.com/feedback/author/home.uri (sélectionnez les deux profils, puis « Demander la fusion »).',
      'Nous pouvons également faire cette demande pour vous : indiquez-nous simplement le profil à conserver.',
      '', closing(c),
    ].join('\n'),
  }),
  // « Suggestions de l'établissement » of the record (docs/plan-parcours-affiliations.md, lot 5).
  orcid_ajouter_poste: (c) => ({
    subject: 'Votre profil ORCID — ajouter votre poste à Nantes Université',
    body: [
      greet(c), '', intro(c),
      `Votre profil ORCID${c.orcid ? ` (${c.orcid})` : ''} ne mentionne pas votre poste à Nantes Université. C’est cette information qui permet aux éditeurs, aux financeurs et aux bases bibliographiques de rattacher vos travaux à l’établissement.`,
      detail(c),
      'L’ajout prend une minute : https://orcid.org/my-orcid → rubrique « Emploi » → « Ajouter ». Choisissez l’organisation « Nantes Université » proposée par la liste (identifiant ROR 03gnr7b55), indiquez votre laboratoire comme département et la date de début, puis rendez l’entrée visible par « Tout le monde ».',
      '', closing(c),
    ].join('\n'),
  }),
  orcid_relier_scopus: (c) => ({
    subject: 'Relier votre profil Scopus à votre ORCID',
    body: [
      greet(c), '', intro(c),
      `Votre profil auteur Scopus${c.scopusId ? ` (${c.scopusId})` : ''} n’est pas relié à votre ORCID${c.orcid ? ` (${c.orcid})` : ''}. Une fois reliés, vos publications Scopus alimentent votre ORCID automatiquement et les deux profils restent cohérents.`,
      detail(c),
      'Elsevier propose un assistant en quelques étapes : https://orcid.scopusfeedback.com/ (connexion avec votre ORCID, vérification du profil Scopus, envoi des publications). Le lien peut aussi se faire depuis ORCID : https://orcid.org/my-orcid → Travaux → « Ajouter » → « Rechercher et lier » → Scopus.',
      '', closing(c),
    ].join('\n'),
  }),
  scopus_profil_errone: (c) => ({
    subject: 'Votre profil auteur Scopus — correction à demander',
    body: [
      greet(c), '', intro(c),
      `Votre profil auteur Scopus${c.scopusId ? ` (${c.scopusId})` : ''} semble erroné : il ne mentionne jamais Nantes Université ou mélange vos publications avec celles d’homonymes. Vos indicateurs (publications, citations, h-index) en sont faussés.`,
      detail(c),
      'La correction se demande à Elsevier via l’Author Feedback Wizard : https://www.scopus.com/feedback/author/home.uri (recherchez votre nom, sélectionnez le profil, puis retirez les documents qui ne sont pas les vôtres ou ajoutez ceux qui manquent).',
      'Nous pouvons aussi faire la demande pour vous : indiquez-nous simplement les documents concernés.',
      '', closing(c),
    ].join('\n'),
  }),
  openalex_deux_auteurs: (c) => ({
    subject: 'Vos profils auteur OpenAlex — à regrouper',
    body: [
      greet(c), '', intro(c),
      'OpenAlex, la base ouverte utilisée pour les bilans bibliométriques de l’établissement, répartit vos publications entre plusieurs profils auteur. Ils sont regroupés dans nos outils, mais pas dans OpenAlex ni dans les services qui s’en servent.',
      detail(c),
      'OpenAlex permet désormais aux chercheurs de corriger eux-mêmes leur profil : connectez-vous sur https://openalex.org avec votre adresse professionnelle, ouvrez votre page auteur, cliquez sur « Claim », puis déplacez vers ce profil les travaux des autres profils. Mode d’emploi : https://help.openalex.org/how-to/fixing-authors/',
      '', closing(c),
    ].join('\n'),
  }),
};

/** True when a ready-to-copy email exists for this task type. */
export const hasTaskEmail = (type: string): type is TaskType => isTaskType(type) && TASK_TYPES[type].email && !!TEMPLATES[type];

/** Builds the email draft for a task type, or null when the type has no template. */
export function buildTaskEmail(type: string, ctx: TaskEmailContext): TaskEmail | null {
  if (!hasTaskEmail(type)) return null;
  const email = TEMPLATES[type]!(ctx);
  // Collapses the blank line left by an empty detail() so the draft reads cleanly.
  return { subject: email.subject, body: email.body.replace(/\n{3,}/g, '\n\n') };
}

/** mailto: URL (same encoding as NewsletterPanel.validationMailto). */
export const mailtoUrl = (to: string, email: TaskEmail): string =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
