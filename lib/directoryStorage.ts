/**
 * @file directoryStorage.ts
 * @description Removal of the former on-disk copy of the directory (plan-separation-test-prod-rssi.md, lot 7):
 * the researcher and structure lists used to be cached in localStorage, i.e. on the disk of every browser that
 * ever opened Druid, after the logout and for the other users of the same computer. The cache is now in memory
 * (lib/gristService.ts); these keys are removed when Druid loads and at logout.
 */

const LEGACY_DIRECTORY_KEYS = [
  'druid_researchers_cache_v2', 'druid_researchers_updated_at', 'druid_structures_cache', 'druid_structures_updated_at',
  'druid_researchers_cache', 'druid_grist_updated_at',
];

export const purgeStoredDirectory = (): void => {
  try {
    for (const key of LEGACY_DIRECTORY_KEYS) localStorage.removeItem(key);
  } catch {
    // storage unavailable (private window, blocked site data): nothing stored either
  }
};
