/**
 * @file buildInfo.ts
 * @description Version of the running build (druid-internal/docs/plan-separation-test-prod-rssi.md,
 * lot 1): compiled into the bundle from build-info.json (scripts/build-info.cjs → vite.config.ts
 * `define`), shown in the top bar so that anyone can say which release they are using.
 */

export interface BuildInfo {
  version: string;
  /** Full commit hash, `-dirty` suffix for a build from uncommitted changes; '' when unknown. */
  sha: string;
  /** ISO 8601 date of the build. */
  builtAt: string;
}

declare const __DRUID_BUILD__: BuildInfo | undefined;

export const BUILD: BuildInfo =
  typeof __DRUID_BUILD__ !== 'undefined' && __DRUID_BUILD__
    ? __DRUID_BUILD__
    : { version: '0.0.0', sha: '', builtAt: '' };

/** First 7 characters of the commit, `-dirty` suffix kept. */
export const shortSha = (sha: string): string => {
  if (!sha) return '';
  const dirty = sha.endsWith('-dirty');
  const base = dirty ? sha.slice(0, -'-dirty'.length) : sha;
  return `${base.slice(0, 7)}${dirty ? '-dirty' : ''}`;
};

/** « v1.2.0 » — the commit is added for a build that is not a release (no tag: version 0.0.0, or a
 *  dirty tree), where the version number alone does not identify the code. */
export const versionLabel = (info: BuildInfo = BUILD): string => {
  const short = shortSha(info.sha);
  const isRelease = info.version !== '0.0.0' && !info.sha.endsWith('-dirty');
  return isRelease || !short ? `v${info.version}` : `v${info.version} · ${short}`;
};

/** Tooltip: version, commit and build date. */
export const versionDetails = (info: BuildInfo = BUILD): string =>
  [`Druid v${info.version}`, shortSha(info.sha), info.builtAt ? info.builtAt.slice(0, 16).replace('T', ' ') + ' UTC' : '']
    .filter(Boolean)
    .join(' · ');
