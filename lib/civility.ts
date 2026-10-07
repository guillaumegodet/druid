// Civility normalization, without dependency: shared by the browser (LDAP review, record form) and by the
// directory mapping that runs on the server (lib/directory/gristMapping.ts).

/** LDAP/Grist civility (« Mme », « M. », « Madame »…) → F / M. */
export const normalizeCivility = (val: string): string => {
  if (!val) return '';
  const v = val.toUpperCase().trim();
  if (v === 'F' || v === 'FEMME' || v.startsWith('MME') || v.startsWith('MLLE') || v.startsWith('MADAME')) return 'F';
  if (v === 'M' || v === 'HOMME' || v.startsWith('M.') || v.startsWith('MONSIEUR') || v.startsWith('MR')) return 'M';
  return v.charAt(0);
};
