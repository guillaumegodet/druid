export const GRADE_TYPOLOGY = [
  {
    categorie: "Enseignants-chercheurs et assimilés",
    sous_categories: [
      {
        nom: "Professeurs des universités et assimilés",
        items: [
          { code: "PR", libelle: "Professeur" },
          { code: "DIR", libelle: "Directeur d'études" },
          { code: "Phys", libelle: "Physicien" },
          { code: "Astro", libelle: "Astronome" },
          { code: "PUPH", libelle: "Professeurs des universités-Praticiens hospitaliers" },
          { code: "PR_AutMin", libelle: "Professeur des établissements dépendant d'autres ministères" },
        ],
      },
      {
        nom: "Maîtres de conférences et assimilés",
        items: [
          { code: "MCF", libelle: "Maître de conférences" },
          { code: "Phys_adj", libelle: "Physicien adjoint" },
          { code: "Astro_adj", libelle: "Astronome adjoint" },
          { code: "MCUPH", libelle: "Maître de conférences des universités-Praticiens hospitaliers" },
          { code: "MC_AutMin", libelle: "Maître de conférences ou Maître assistant d'autres ministères" },
        ],
      },
      {
        nom: "Enseignants-chercheurs non titulaires, émérites et autres",
        items: [
          { code: "PREM", libelle: "Professeur émérite" },
          { code: "MCFEM", libelle: "Maître de conférences émérite" },
          { code: "CCA", libelle: "Chef de clinique assistant" },
          { code: "AHU", libelle: "Attaché hospitalier universitaire" },
          { code: "PHU", libelle: "Praticien hospitalier universitaire" },
          { code: "ECC", libelle: "Enseignant-chercheur contractuel (dont contrats LRU)" },
          { code: "PAST", libelle: "Enseignant-chercheur associé (MC, PR à temps partiel ou plein)" },
          { code: "Autre_EC", libelle: "Autre statut" },
          { code: "ChPJ", libelle: "Chaire de professeur junior" },
        ],
      },
    ],
  },
  {
    categorie: "Chercheurs et assimilés",
    sous_categories: [
      {
        nom: "Chercheurs des EPST (Organismes de recherche)",
        items: [
          { code: "DR", libelle: "Directeur de recherche" },
          { code: "CR", libelle: "Chargé de recherche" },
        ],
      },
      {
        nom: "Chercheurs non titulaires, émérites et autres",
        items: [
          { code: "DREM", libelle: "Directeur de recherche émérite" },
          { code: "CREM", libelle: "Chargé de recherche émérite" },
          { code: "Post-doc", libelle: "Chercheur post-doctoral" },
          { code: "Doctorant", libelle: "Doctorant avec mission de recherche" },
          { code: "Chercheur_inv", libelle: "Chercheur invité" },
          { code: "ChC", libelle: "Chercheur contractuel" },
          { code: "Chercheur_Asso", libelle: "Chercheur associé" },
          { code: "Benevole", libelle: "Chercheur bénévole" },
          { code: "Autre_Ch", libelle: "Autre statut" },
        ],
      },
    ],
  },
  {
    categorie: "Autres personnels",
    sous_categories: [
      {
        nom: "Enseignants du secondaire détachés dans le supérieur",
        items: [
          { code: "PRAG", libelle: "Professeur agrégé" },
          { code: "PCAP", libelle: "Professeur certifié" },
        ],
      },
      {
        nom: "Personnels d'appui à la recherche",
        items: [
          { code: "IR", libelle: "Ingénieur de recherche ou assimilé" },
          { code: "IE", libelle: "Ingénieur d'études ou assimilé" },
          { code: "AI", libelle: "Assistant ingénieur ou assimilé" },
          { code: "TECH", libelle: "Technicien de recherche ou assimilé" },
          { code: "AJT", libelle: "Adjoints et agents techniques, administratifs" },
          { code: "ADJAENES", libelle: "Adjoint administratif des administrations de l'État" },
        ],
      },
      {
        nom: "Bibliothécaires",
        items: [
          { code: "BIB", libelle: "Bibliothécaire d'état" },
          { code: "BIBAS", libelle: "Bibliothécaire assistant spécialisé" },
          { code: "ASBIB", libelle: "Assistant des bibliothèques" },
          { code: "MABIB", libelle: "Magasinier des bibliothèques" },
        ],
      },
      {
        nom: "Personnels hospitaliers",
        items: [
          { code: "PH", libelle: "Praticien hospitalier" },
          { code: "AJH", libelle: "Adjoint administratif / technique hospitalier" },
          { code: "ASPM", libelle: "Aide-soignant, auxiliaire de puériculture, AMP" },
          { code: "SEC", libelle: "Secrétaire hospitalier" },
          { code: "TEC", libelle: "Technicien hospitalier" },
          { code: "INF", libelle: "Infirmier" },
          { code: "SF", libelle: "Sage-femme" },
          { code: "ARC", libelle: "Attaché de recherche clinique" },
          { code: "CS", libelle: "Cadre de santé" },
          { code: "Igh", libelle: "Ingénieur hospitalier" },
          { code: "CP", libelle: "Chef de projet" },
        ],
      },
    ],
  },
] as const;

export type GradeCode = typeof GRADE_TYPOLOGY[number]['sous_categories'][number]['items'][number]['code'];

export const findGradeByCode = (code: string) => {
  for (const cat of GRADE_TYPOLOGY) {
    for (const scat of cat.sous_categories) {
      for (const item of scat.items) {
        if (item.code === code) return item;
      }
    }
  }
  return null;
};

export const getCategoryByCode = (code: string): string | null => {
  for (const cat of GRADE_TYPOLOGY) {
    for (const scat of cat.sous_categories) {
      if (scat.items.some(item => item.code === code)) return cat.categorie;
    }
  }
  return null;
};

// Mapping BCN N_CORPS code (value after stripping the {NCORPS} prefix) → Druid grade code.
// null = known code that cannot be mapped in the typology (e.g. VN, VF, CDI).
export const NCORPS_TO_GRADE: Record<string, string | null> = {
  // University professors (PU)
  '300': 'PR',
  '311': 'PAST',  // associate PU, full time
  '312': 'PAST',  // associate PU, part time

  // Associate professors (MCF)
  '301': 'MCF',
  '314': 'PAST',  // associate MCF, full time
  '315': 'PAST',  // associate MCF, part time

  // PU-PH / MCU-PH
  '324': 'PUPH',
  '325': 'MCUPH',

  // Secondary-school teachers in higher education
  '551': 'PRAG',
  '553': 'PCAP',

  // University hospital practitioners
  '741': 'PHU',
  '742': 'AHU',
  '743': 'CCA',

  // ITRF (research and training engineers and technicians)
  '836': 'IR',
  '835': 'IE',
  '833': 'IE',
  '834': 'AI',
  '831': 'AI',
  '832': 'AI',
  '830': 'TECH',
  '838': 'TECH',
  '839': 'AJT',
  '941': 'AJT',
  '057': 'ADJAENES', // « Adjoint administratif des administrations de l'État »

  // Librarians
  '800': 'BIB',
  '801': 'BIB',
  '806': 'BIB',
  '810': 'BIBAS',
  '818': 'ASBIB',
  '820': 'MABIB',
  '942': 'MABIB',

  // CNRS and national research bodies
  '223': 'DR',
  '224': 'CR',
  '275': 'AI',
  '276': 'IE',
  '277': 'IR',
  '279': 'TECH',

  // Local / non-BCN codes present in the Nantes LDAP
  'CN322': 'Doctorant',
  'DR':    'DR',
  'H04':   'IR',
  'H05':   'IR',
  'ATER':  'ECC',

  // Not mappable in the typology
  'VN':    null,
  'VF':    null,
  'CDI01': null,
  'CDI02': null,
  'NU4161': null,
  'NU4175': null,
  'C4161':  null,
};

export const getGradeFromNcorps = (ncorpsCode: string): string | null => {
  if (!ncorpsCode) return null;
  return NCORPS_TO_GRADE[ncorpsCode] ?? null;
};

