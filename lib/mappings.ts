
/** 
 * Mapping of labs by research pole.
 * Used to derive the pole from the primary membership (Labo).
 */
export const POLE_LAB_MAPPING: Record<string, string[]> = {
  "Pôle Humanités": [
    "CAPHI", "CFV", "CReAAH", "CREN", "CRHIA", "CRINI", 
    "ESO", "LAMO", "LETG", "LLING", "LPPL"
  ],
  "Pôle S&T": [
    "CEISAM", "GeM", "GEPEA", "IETR", "IMN", "IREENA", 
    "LMJL", "LPG", "LS2N", "LTeN", "SUBATECH", "US2B"
  ],
  "Pôle Santé": [
    "CR2TI", "CRCI2NA", "IICiMed", "INCIT", "ISOMER", "MIP", 
    "PHAN", "RMeS", "SPHERE", "TaRGeT", "TENS", "ITX"
  ],
  "Pôle Sociétés": [
    "CDMO", "CENS", "DCS", "IRDP", "LEMNA"
  ]
};

/** 
 * Utility function finding the pole of a lab.
 * Matches by exact equality or inclusion (case-insensitive).
 */
export const getPoleFromLab = (labName: any): string | null => {
  if (!labName) return null;

  // Grist RefList encoded as ['L', value1, value2, ...]: skip the 'L' marker, it is not a value.
  const rawValue = Array.isArray(labName)
    ? labName[0] === 'L' ? labName[1] : labName[0]
    : labName;
  if (!rawValue) return null;
  const upperLab = String(rawValue).toUpperCase().trim();

  const entry = Object.entries(POLE_LAB_MAPPING).find(([_, labs]) =>
    labs.some(acronym => {
      const upperAcronym = acronym.toUpperCase();
      return (
        upperLab === upperAcronym ||
        upperLab.startsWith(upperAcronym + " ") ||
        upperLab.includes(" " + upperAcronym) ||
        upperLab.includes("(" + upperAcronym + ")")
      );
    })
  );
  return entry ? entry[0] : null;
};
