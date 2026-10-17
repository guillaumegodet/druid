// Calls of a ResearchConnect export (the funding database of Idox the institution subscribes to, druid-internal
// docs/plan-funding-calls.md § 2.5 and lot 6): the RTF of a saved search lists one fund per section — title, « Fund ID »,
// status, one-line summary, « Fund Information » (funding body, maximum value, deadline), then « Extended Description »,
// « Eligibility Criteria », « Value Notes », « Application Procedure », « Useful links », « Funder contact » and
// « Calls and deadlines » (the coming calls of the fund with their dates). Read in the browser (lib/calls/rtfText.ts),
// turned into rows of the catalogue import (lib/calls/manual.ts), so the server sees the same rows as for a CSV.
// Decision D7: these calls stay in the instance that holds the subscription (source `researchconnect`).
import { categoryOf, dayOf } from './manual';

export const RESEARCHCONNECT_SOURCE = 'researchconnect';

export interface ResearchConnectFund {
  fundId: string;
  title: string;
  status: string;
  summary: string;
  funder: string;
  maximumValue: string;
  /** Days of the deadlines of the fund and of its coming calls, sorted. */
  deadlines: string[];
  /** Earliest start of the applications given by its calls, when the fund is not open yet. */
  openingDate: string | null;
  description: string;
  eligibility: string;
  valueNotes: string;
  procedure: string;
  url: string;
}

const SECTIONS = ['Fund Information', 'Extended Description', 'Eligibility Criteria', 'Value Notes', 'Application Procedure', 'Useful links', 'Funder contact', 'Calls and deadlines'] as const;
type Section = (typeof SECTIONS)[number];
const FIELD = /^([A-Z][A-Za-z ]+):\t?(.*)$/;
const NO_VALUE = /^(none specified|not specified|-|n\/a)$/i;

/** Whether a text is a ResearchConnect export (its banner and at least one fund). */
export const isResearchConnectText = (text: string): boolean => /^ResearchConnect\b/m.test(text.slice(0, 2000)) && /^Fund ID:/m.test(text);

export const parseResearchConnect = (text: string): ResearchConnectFund[] => {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const starts: number[] = [];
  lines.forEach((l, i) => { if (/^Fund ID:/.test(l)) starts.push(i); });
  // Title of a fund: the last non-empty line before its « Fund ID ».
  const titleIndex = (i: number) => { let k = i - 1; while (k >= 0 && !lines[k].trim()) k--; return k; };
  const funds: ResearchConnectFund[] = [];
  starts.forEach((start, n) => {
    const titleAt = titleIndex(start);
    const end = n + 1 < starts.length ? titleIndex(starts[n + 1]) : lines.length;
    const fields: Record<string, string> = {};
    const sections: Partial<Record<Section, string[]>> = {};
    let section: Section | null = null;
    let summary = '';
    for (let i = start; i < end; i++) {
      const line = lines[i];
      if ((SECTIONS as readonly string[]).includes(line.trim())) { section = line.trim() as Section; sections[section] = []; continue; }
      if (section === null || section === 'Fund Information') {
        const f = line.match(FIELD);
        if (f) { fields[f[1]] = fields[f[1]] ?? f[2].trim(); continue; }
        if (section === null && line.trim() && !summary) summary = line.trim();
        continue;
      }
      sections[section]!.push(line);
    }
    const block = (s: Section) => (sections[s] ?? []).join('\n').replace(/\n{2,}/g, '\n').trim();
    const calls = sections['Calls and deadlines'] ?? [];
    const dateOf = (v: string | undefined) => (v && !NO_VALUE.test(v.trim()) ? dayOf(v.trim()) : null);
    const ends = [fields['Application deadline'], ...calls.map((l) => l.match(/^Application (?:end date|deadline):\t?(.*)$/)?.[1])].map(dateOf);
    const startsOf = calls.map((l) => dateOf(l.match(/^Application start date:\t?(.*)$/)?.[1])).filter((d): d is string => !!d).sort();
    const status = fields.Status ?? '';
    funds.push({
      fundId: fields['Fund ID'] ?? '',
      title: (lines[titleAt] ?? '').trim().replace(/\s+(UPDATED|NEW)$/, ''),
      status,
      summary,
      funder: fields['Funding body'] ?? '',
      maximumValue: NO_VALUE.test(fields['Maximum value'] ?? '') ? '' : fields['Maximum value'] ?? '',
      deadlines: [...new Set(ends.filter((d): d is string => !!d))].sort(),
      openingDate: /^future/i.test(status) ? startsOf[0] ?? null : null,
      description: block('Extended Description'),
      eligibility: block('Eligibility Criteria'),
      valueNotes: block('Value Notes'),
      procedure: block('Application Procedure'),
      url: (sections['Useful links'] ?? []).map((l) => l.trim()).find((l) => /^https?:\/\//.test(l)) ?? '',
    });
  });
  return funds.filter((f) => f.fundId && f.title);
};

/** Headers of the rows below, as the catalogue import reads them (lib/calls/manual.ts catalogueColumns). */
export const RESEARCHCONNECT_HEADERS = ['Reference', 'Title', 'Funder', 'Category', 'Programme', 'URL', 'Language', 'Opening', 'Deadline', 'Deadline 2', 'Summary', 'Scope', 'Eligibility', 'Budget', 'Source'];

/** A fund as a row of the catalogue: the funder is also its programme; the next two deadlines (else the last one). */
export const researchConnectRow = (f: ResearchConnectFund, today: string): Record<string, string> => {
  const coming = f.deadlines.filter((d) => d >= today);
  const deadlines = coming.length ? coming.slice(0, 2) : f.deadlines.slice(-1);
  const guessed = categoryOf(f.funder);
  return {
    Reference: `RC-${f.fundId}`, Title: f.title, Funder: f.funder, Category: guessed === 'Autre' ? 'International' : guessed, Programme: f.funder,
    URL: f.url, Language: 'en', Opening: f.openingDate ?? '', Deadline: deadlines[0] ?? '', 'Deadline 2': deadlines[1] ?? '',
    Summary: f.summary, Scope: f.description, Eligibility: f.eligibility,
    Budget: [f.maximumValue, f.valueNotes.split('\n')[0]].filter(Boolean).join(' — ').slice(0, 500),
    Source: RESEARCHCONNECT_SOURCE,
  };
};
