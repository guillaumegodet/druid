// Website of the French national research agency (ANR) as a source of calls (druid-internal docs/plan-funding-calls.md,
// lot 4). Two kinds of pages: the list of the calls open or announced (`/fr/appels/`: one card per call, with the
// stable identifier of the call in the ANR database, its type — specific call, France 2030 — and its title), and the
// page of a call (title, state « Pré-annonce / Ouvert / Clos », dates of the timeline, text). The generic call (AAPG)
// is a single call split into some fifty research axes, each one evaluated by its own committee: its axes are read
// from the text of the call (PDF, one section per axis: title, contact, description, keywords, ERC codes, SDGs) and
// become one call each. This module is pure (parsing); the collector is lib/calls/collectAnr.ts.
import { htmlToText } from './ftPortal';
import type { CallStatus } from './programmes';

export const ANR_SITE = 'https://anr.fr';
export const ANR_LISTING_URL = `${ANR_SITE}/fr/appels/`;
/** Page of an edition of the generic call; anr.fr redirects it to the page of the call. */
export const aapgPageUrl = (year: number): string => `${ANR_SITE}/fr/aapg-${year}/`;

export type AnrCallType = 'generic' | 'specific' | 'france-2030' | 'other';

/** A card of the list of calls. */
export interface AnrListedCall {
  /** Identifier of the call in the ANR database (`tx_anrprojects_domain_model_requestforprojects/<uid>`). */
  uid: string;
  url: string;
  title: string;
  type: AnrCallType;
  typeLabel: string;
  abstract: string;
}

const text = (html: string): string => htmlToText(html).replace(/\s+/g, ' ').trim();
const absolute = (href: string): string => (/^https?:/i.test(href) ? href : `${ANR_SITE}${href.startsWith('/') ? '' : '/'}${href}`);

/** Type of a call from the tag of its card (2 = specific, 5 = France 2030), the label as a fallback. */
export const anrCallType = (tag: string, label: string): AnrCallType => {
  if (tag === '5' || /france\s*2030/i.test(label)) return 'france-2030';
  if (/g[ée]n[ée]rique/i.test(label)) return 'generic';
  if (tag === '2' || /sp[ée]cifique/i.test(label)) return 'specific';
  return 'other';
};

/** Cards of the list of calls, in page order; a card without identifier or link is left out. */
export const parseAnrListing = (html: string): AnrListedCall[] => {
  const out: AnrListedCall[] = [];
  const seen = new Set<string>();
  // Every card is preceded by the comment of the search index that names its record.
  const parts = html.split(/<!--\s*Score:/);
  for (const part of parts.slice(1)) {
    const uid = part.match(/Document ID:\s*\S*?tx_anrprojects_domain_model_requestforprojects\/(\d+)/)?.[1];
    const link = part.match(/<h2>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!uid || !link || seen.has(uid)) continue;
    seen.add(uid);
    const tag = part.match(/<span class="tag-type"[^>]*data-tag-type="(\d+)"[^>]*>([\s\S]*?)<\/span>/);
    const typeLabel = tag ? text(tag[2]) : '';
    out.push({
      uid, url: absolute(link[1]), title: text(link[2]), type: anrCallType(tag?.[1] ?? '', typeLabel), typeLabel,
      abstract: text(part.match(/<div class="abstract[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? ''),
    });
  }
  return out;
};

/** The page of a call. */
export interface AnrCallPage {
  title: string;
  /** State shown by the page (« Pré-annonce – 2027 », « Ouvert – 2026 », « Clos – 2027 »). */
  stateLabel: string;
  status: CallStatus;
  openingDate: string | null;
  /** Closing dates of the timeline (submission steps), sorted. */
  deadlines: string[];
  /** Text of the call: lead paragraph and body, without the timeline, the documents and the side blocks. */
  text: string;
  /** Documents linked by the page (absolute URLs). */
  documents: string[];
}

/** Status from the state of the page: the timeline of an announced call is sometimes already « closed ». */
export const anrStatus = (stateLabel: string): CallStatus => {
  if (/^pr[ée]-?annonce/i.test(stateLabel)) return 'forthcoming';
  if (/^ouvert/i.test(stateLabel)) return 'open';
  if (/^clos/i.test(stateLabel)) return 'closed';
  return 'unknown';
};

/** 'YYYY-MM-DD' of an ISO date with offset as the timeline gives it (`2026-10-14T17:00:00+02:00`): the local day. */
const dayOf = (iso: string | undefined): string | null => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

/** Parses the page of a call; null when it is not one (no title). */
export const parseAnrCallPage = (html: string, pageUrl = ANR_SITE): AnrCallPage | null => {
  const start = html.indexOf('<section class="content-style">');
  if (start < 0) return null;
  // The text ends at the first side block of the page (highlight, summary, news) or at its footer.
  const ends = ['block-misenavant', 'sidebar-summary', 'main-subfooter', '<footer']
    .map((marker) => html.indexOf(marker, start)).filter((i) => i > 0).map((i) => html.lastIndexOf('<', i));
  const content = html.slice(start, ends.length ? Math.min(...ends) : html.length);
  const h1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? text(h1[1]) : '';
  if (!title) return null;
  const stateLabel = text(content.match(/<span class="tag-type"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');

  // Timeline: the « Ouvert » step carries the opening and closing dates; its tasks, the dates of each step.
  const timelineStart = content.indexOf('<section class="section section-timeline-small');
  const timelineEnd = timelineStart < 0 ? -1 : content.indexOf('</section>', timelineStart);
  const timeline = timelineStart < 0 ? '' : content.slice(timelineStart, timelineEnd < 0 ? undefined : timelineEnd);
  const open = timeline.match(/<div class="project[^"]*"\s+data-start="([^"]*)"\s+data-end="([^"]*)">\s*<span class="project-title">\s*Ouvert/i);
  let openingDate = dayOf(open?.[1]);
  const deadlines = new Set<string>();
  const end = dayOf(open?.[2]);
  if (end) deadlines.add(end);
  for (const task of timeline.matchAll(/<div class="task"\s+data-date="([^"]*)">[\s\S]*?<span class="task-title">([\s\S]*?)<\/span>/g)) {
    const day = dayOf(task[1]);
    if (!day) continue;
    if (/^ouverture/i.test(text(task[2]))) openingDate = openingDate ?? day;
    else deadlines.add(day);
  }

  const lead = content.slice(h1 ? content.indexOf(h1[0]) + h1[0].length : 0, timelineStart < 0 ? undefined : timelineStart);
  const body = timelineEnd < 0 ? '' : content.slice(timelineEnd + '</section>'.length);
  const strip = (s: string) => s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?(?:-->|$)/gi, '')
    .replace(/<ul class="download-section[\s\S]*?<\/ul>/gi, '');
  const textOf = (s: string) => htmlToText(strip(s)).split('\n').map((l) => l.replace(/[\s\u200b]+/g, ' ').trim()).filter(Boolean).join('\n');
  const documents = [...new Set([...content.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => new URL(m[1], pageUrl).toString()))];
  return {
    title, stateLabel, status: anrStatus(stateLabel), openingDate, deadlines: [...deadlines].sort(),
    text: [textOf(lead), textOf(body)].filter(Boolean).join('\n\n'), documents,
  };
};

/** Text of the generic call among the documents of its page: `…/anr-aapg-<year>.pdf`. */
export const aapgTextUrl = (documents: readonly string[], year: number): string | null =>
  documents.find((d) => new RegExp(`/anr-aapg-${year}\\.pdf$`, 'i').test(d)) ?? null;

/** A research axis of the generic call. */
export interface AapgAxis {
  /** `E.02`. */
  code: string;
  title: string;
  /** Disciplinary domain (« Sciences du numérique »), « Axes transversaux » for the cross-cutting ones. */
  domain: string;
  description: string;
  keywords: string[];
  /** ERC panels associated, normalised (PE06, LS02, SH07); the sub-panels of the text are not kept. */
  ercPanels: string[];
  /** Sustainable development goals associated (1 to 17). */
  sdgs: number[];
}

const AXIS_HEADING = /^\s*Axe\s+([A-H])\.\s?(\d{2})\.?\s*:\s*(.*)$/;
/** Heading of a disciplinary domain (the word Domaine, then its name in French quotes), possibly wrapped over two lines. */
const DOMAIN_HEADING = /^\s*Domaine\s+«\s*(.*)$/;
const TRANSVERSAL_HEADING = /^\s*Axes transversaux\s*$/;
/** Table of contents entry (dot leaders) or running footer of the text (`AAPG 2027_V1.0 –15 juillet 2026 66`). */
const NOISE = /\.{5,}|^\s*AAPG \d{4}_V[\d.]+\b.*\d+\s*$|^\s*\f?\s*$/;

/** Joins the lines of a paragraph wrapped by the PDF; a line cut after a hyphen is glued back, hyphen kept (the text
 * is not hyphenated: a hyphen at the end of a line belongs to a compound, « micro-organismes »). */
const joinLines = (lines: string[]): string => {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/^[•▪◦\-–]\s/.test(line)) out += `\n${line}`;
    else if (/[a-zà-ÿ]-$/i.test(out) && /^[a-zà-ÿ]/.test(line)) out += line;
    else out += ` ${line}`;
  }
  return out;
};
/** Keywords are separated by semicolons (commas occur inside a keyword: « apprentissage (supervisé, non supervisé) »). */
const keywordsOf = (s: string): string[] => s.split(/\s*;\s*/).map((x) => x.replace(/\.$/, '').trim()).filter(Boolean);
/** ERC panels named by the line of an axis (« PE01, PE6, LS07_8 à 13 », « majeurs : PE02 … »), as PE01 / PE06 / LS07. */
export const ercPanelsOf = (s: string): string[] =>
  [...new Set([...s.toUpperCase().matchAll(/\b(PE|LS|SH)\s?(\d{1,2})(?!\d)/g)].map((m) => `${m[1]}${m[2].padStart(2, '0')}`))];
/** SDG numbers of the line of an axis; « l’ensemble des 17 ODD » means all of them. */
export const sdgsOf = (s: string): number[] => {
  if (/ensemble/i.test(s)) return Array.from({ length: 17 }, (_, i) => i + 1);
  return [...new Set([...s.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 17))];
};

/** An axis being read. */
interface AxisDraft {
  code: string;
  titleLines: string[];
  inTitle: boolean;
  /** The « Contact » line was met: an axis heading without it is an entry of the table of contents (whose title
   * wraps before its dot leaders) or a reference to the axis in another text, not the section of the axis. */
  hasContact: boolean;
  description: string[];
  keywords: string[];
  inKeywords: boolean;
  erc: string;
  sdg: string;
  domain: string;
}

/**
 * Research axes of the text of the generic call (as extracted from its PDF, one line per text line). An axis starts at
 * its heading (« Axe E.02 : Intelligence artificielle et science des données », its title possibly wrapped until the
 * « Contact » line); its description runs until « Mots-clés associés », then come the ERC codes and the SDGs. A heading
 * not followed by a contact line (table of contents, reference from another axis) is skipped. Axes found twice keep
 * their first full occurrence.
 */
export const parseAapgAxes = (pdfText: string): AapgAxis[] => {
  const lines = pdfText.split(/\r?\n/).map((l) => l.replace(/\f/g, ''));
  const axes: AapgAxis[] = [];
  const seen = new Set<string>();
  let domain = '';
  /** Start of a domain heading whose name runs over the next line (its closing quote not reached yet). */
  let domainPending: string | null = null;
  let current: AxisDraft | null = null;
  const flush = () => {
    if (current && current.hasContact && !seen.has(current.code) && current.description.length) {
      seen.add(current.code);
      axes.push({
        code: current.code, title: joinLines(current.titleLines), domain: current.domain, description: joinLines(current.description),
        keywords: keywordsOf(joinLines(current.keywords)), ercPanels: ercPanelsOf(current.erc), sdgs: sdgsOf(current.sdg),
      });
    }
    current = null;
  };
  for (const line of lines) {
    if (NOISE.test(line)) continue;
    if (domainPending !== null) {
      domainPending = `${domainPending} ${line.trim()}`;
      if (domainPending.includes('»') || domainPending.length > 200) { domain = domainPending.replace(/\s*».*$/, '').trim(); domainPending = null; }
      continue;
    }
    const axis = line.match(AXIS_HEADING);
    if (axis) {
      flush();
      current = { code: `${axis[1]}.${axis[2]}`, titleLines: [axis[3]], inTitle: true, hasContact: false, description: [], keywords: [], inKeywords: false, erc: '', sdg: '', domain };
      continue;
    }
    const dom = line.match(DOMAIN_HEADING);
    if (dom || TRANSVERSAL_HEADING.test(line)) {
      flush();
      if (!dom) domain = 'Axes transversaux';
      else if (dom[1].includes('»')) domain = dom[1].replace(/\s*».*$/, '').trim();
      else domainPending = dom[1].trim();
      continue;
    }
    if (!current) continue;
    const c: AxisDraft = current;
    if (c.inTitle && /^\s*Contacts?\s*:/i.test(line)) { c.inTitle = false; c.hasContact = true; continue; }
    // A title wraps over three lines at most; no contact line after it: not the section of an axis, skipped.
    if (c.inTitle) {
      if (c.titleLines.length < 3) c.titleLines.push(line);
      else current = null;
      continue;
    }
    const kw = line.match(/^\s*Mots-cl[ée]s associ[ée]s\s*:\s*(.*)$/i);
    if (kw) { c.inKeywords = true; c.keywords.push(kw[1]); continue; }
    const erc = line.match(/^\s*Codes?\.?s?\s+ERC\s+associ[ée]\.?s?\s*:\s*(.*)$/i);
    if (erc) { c.inKeywords = false; c.erc = erc[1]; continue; }
    const sdg = line.match(/^\s*ODD\s+associ[ée]\.?s?\s*:\s*(.*)$/i);
    if (sdg) { c.inKeywords = false; c.sdg = sdg[1]; continue; }
    if (c.inKeywords) c.keywords.push(line);
    else if (!c.erc && !c.sdg) c.description.push(line);
  }
  flush();
  return axes;
};
