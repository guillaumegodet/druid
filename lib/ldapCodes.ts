// LDAP state codes, without dependency: shared by the browser (LDAP review) and the server-side directory
// writes (lib/directory/annuaireWrite.ts).

/** Mapping dynaEtat code (LDAP) -> statut_dyna label (Grist). */
export const STATUT_DYNA_MAP: Record<string, string> = { N: 'NORMAL', D: 'DEPART', A: 'ANTICIPE' };
