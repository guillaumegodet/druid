// Funding & Tenders portal of the European Commission as a source of calls (druid-internal docs/plan-funding-calls.md,
// lot 2): the public reference file of every grant topic (`…/data/referenceData/grantsTenders.json`, 130 MB, refreshed
// nightly: identifier, title, call, programme, status, dates, keywords) gives the listing; the public JSON of a topic
// (lib/calls/portal.ts) gives its text. This module is pure: parsing of the listing (streamed, the file is too big to
// hold), mapping of a topic to a Druid programme and subset, HTML to text. The collector is lib/calls/collect.ts.
import type { CallStatus } from './programmes';

export const PORTAL_LISTING_URL = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/grantsTenders.json';

/** A grant topic as the listing describes it. */
export interface PortalListingTopic {
  identifier: string;
  title: string;
  callIdentifier: string;
  callTitle: string;
  /** Framework programme abbreviation (HORIZON, DIGITAL, LIFE2027…). */
  framework: string;
  /** Programme divisions (HORIZON.2.4, HORIZON.1.1…). */
  divisions: string[];
  status: CallStatus;
  deadlines: string[];
  openingDate: string | null;
  keywords: string[];
  typesOfAction: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const abbreviations = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => str((x as { abbreviation?: unknown })?.abbreviation)).filter(Boolean);

/** 'YYYY-MM-DD' (UTC) of a millisecond timestamp, as the portal gives its dates; null when absent or unreadable. */
export const dateOfMs = (ms: unknown): string | null => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : null;
};
export const datesOfMs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(dateOfMs).filter((d): d is string => !!d).sort();

const STATUS: Record<string, CallStatus> = { open: 'open', forthcoming: 'forthcoming', closed: 'closed' };
export const portalStatus = (v: unknown): CallStatus => STATUS[str((v as { abbreviation?: unknown })?.abbreviation ?? v).toLowerCase()] ?? 'unknown';

/** One object of the listing → a topic; null when it is not a grant topic (type 1) or has no identifier. */
export const parsePortalListingTopic = (o: unknown): PortalListingTopic | null => {
  const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  if (!r || Number(r.type) !== 1) return null;
  const identifier = str(r.identifier);
  if (!identifier) return null;
  return {
    identifier,
    title: str(r.title),
    callIdentifier: str(r.callIdentifier),
    callTitle: str(r.callTitle),
    framework: str((r.frameworkProgramme as { abbreviation?: unknown })?.abbreviation),
    divisions: abbreviations(r.programmeDivision),
    status: portalStatus(r.status),
    deadlines: datesOfMs(r.deadlineDatesLong),
    openingDate: dateOfMs(r.plannedOpeningDateLong),
    keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(str).filter(Boolean),
    typesOfAction: abbreviations(r.topicActions),
  };
};

/**
 * Streams the objects of the listing array one by one, as JSON text, so that the 130 MB file is never held whole:
 * `{"fundingData":{"GrantTenderObj":[ {…}, {…} ]}}` — every object opened at depth 3 (inside the array) is yielded
 * when it closes. Strings are skipped verbatim (braces inside them do not count). Chunks may be text or bytes (UTF-8).
 */
export async function* portalListingObjects(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let collecting = false;
  let buf = '';
  for await (const chunk of chunks) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{' || c === '[') {
        if (c === '{' && depth === 3) { collecting = true; start = i; buf = ''; }
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (c === '}' && depth === 3 && collecting) {
          buf += text.slice(start, i + 1);
          collecting = false;
          yield buf;
          buf = '';
        }
      }
    }
    if (collecting) buf += text.slice(start);
  }
}

export interface ProgrammeMatch {
  programmeId: string;
  /** Partition of the programme (cluster, scheme, mission…), '' when the programme has none. */
  subset: string;
  /** Funding scheme when the identifier names one (ERC-StG, MSCA-PF…), '' otherwise. */
  scheme: string;
}

const ERC_SCHEMES: Record<string, string> = { STG: 'StG', COG: 'CoG', ADG: 'AdG', SYG: 'SyG', POC: 'PoC' };
const FRAMEWORKS: Record<string, string> = {
  EURATOM2027: 'euratom', DIGITAL: 'digital-europe', LIFE2027: 'life', EDF: 'edf', EU4H: 'eu4health', CEF2027: 'cef',
  ERASMUS2027: 'erasmus-plus', CREA2027: 'creative-europe', CERV: 'cerv',
};

/**
 * Druid programme (lib/calls/programmes.ts) of a portal topic, from its framework and identifier. Horizon Europe is
 * split the way a research office reads it: ERC, MSCA, EIC, missions, infrastructures, widening, ecosystems, joint
 * undertakings, and the pillar 2 clusters under `horizon-europe`. Null when no programme is declared for the topic
 * (other frameworks, H2020…).
 */
export const programmeOfPortalTopic = (t: { identifier: string; framework: string }): ProgrammeMatch | null => {
  const id = t.identifier.toUpperCase();
  if (t.framework === 'HORIZON') {
    let m: RegExpMatchArray | null;
    if ((m = id.match(/^ERC-\d{4}-([A-Z]+)/))) return { programmeId: 'erc', subset: ERC_SCHEMES[m[1]] ?? m[1], scheme: `ERC-${ERC_SCHEMES[m[1]] ?? m[1]}` };
    if ((m = id.match(/^HORIZON-MSCA-\d{4}-([A-Z]+)/))) return { programmeId: 'msca', subset: m[1], scheme: `MSCA-${m[1]}` };
    if ((m = id.match(/^HORIZON-EIC-\d{4}-(PATHFINDER|TRANSITION|ACCELERATOR)/))) {
      const s = m[1][0] + m[1].slice(1).toLowerCase();
      return { programmeId: 'eic', subset: s, scheme: `EIC-${s}` };
    }
    if (id.startsWith('HORIZON-EIC-')) return { programmeId: 'eic', subset: '', scheme: '' };
    if ((m = id.match(/^HORIZON-MISS-\d{4}-(?:\d+-)?([A-Z]+)/))) return { programmeId: 'horizon-missions', subset: m[1], scheme: '' };
    if ((m = id.match(/^HORIZON-INFRA-\d{4}-(?:\d+-)?([A-Z]+)/))) return { programmeId: 'horizon-infra', subset: m[1], scheme: '' };
    if ((m = id.match(/^HORIZON-WIDERA-\d{4}-(?:\d+-)?([A-Z]+)/))) return { programmeId: 'horizon-widera', subset: m[1], scheme: '' };
    if (id.startsWith('HORIZON-EIE-')) return { programmeId: 'horizon-eie', subset: '', scheme: '' };
    if ((m = id.match(/^HORIZON-JU-([A-Z0-9]+)/))) return { programmeId: 'horizon-ju', subset: m[1], scheme: '' };
    if ((m = id.match(/^HORIZON-(CL\d)-/))) return { programmeId: 'horizon-europe', subset: m[1], scheme: '' };
    return null;
  }
  const programmeId = FRAMEWORKS[t.framework];
  return programmeId ? { programmeId, subset: '', scheme: '' } : null;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
const decodeEntities = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });

/** Readable text of an HTML fragment: block ends become line breaks, list items get a dash, tags and entities go. */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/div|\/h\d|\/li|\/tr|\/ul|\/ol|\/table)\b[^>]*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\s*\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/**
 * Objectives and scope of a topic from its description: the portal marks its sections with
 * `<p class="topicdescriptionkind">Expected Outcome:</p>` / `Scope:` (Horizon Europe); other programmes have a single
 * text, kept whole as objectives.
 */
export const splitDescription = (html: string): { objectives: string; scope: string } => {
  const text = htmlToText(html.replace(/<p[^>]*class="topicdescriptionkind"[^>]*>\s*([^<]+?)\s*<\/p>/gi, '\n@@$1@@\n'));
  const parts = text.split(/\n?@@([^@]+)@@\n?/);
  if (parts.length < 3) return { objectives: text.replace(/@@/g, '').trim(), scope: '' };
  let objectives = parts[0].trim();
  let scope = '';
  for (let i = 1; i < parts.length; i += 2) {
    const kind = parts[i].toLowerCase();
    const body = (parts[i + 1] ?? '').trim();
    if (kind.startsWith('scope')) scope = scope ? `${scope}\n\n${body}` : body;
    else objectives = objectives ? `${objectives}\n\n${body}` : body;
  }
  return { objectives, scope };
};
