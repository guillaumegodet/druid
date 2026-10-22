// The 17 United Nations Sustainable Development Goals (SDGs, « ODD » in French) as OpenAlex tags them on each
// work (`sustainable_development_goals`, Aurora classifier; DashboardPublication.sdgs, exports since
// 2026-10-22 — druid-internal docs/plan-odd-sdg.md). Static reference table: title of each goal
// (translated by Lingui), color of the United Nations wheel, URL of the United Nations description. The United Nations icons are not
// embedded (usage rules, public repository): a colored square with the number stands for the goal.
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { DashboardPublication } from './types';

export interface SdgDef {
  id: number;
  /** UN title of the goal. */
  title: MessageDescriptor;
  /** UN wheel color of the goal. */
  color: string;
}

export const SDGS: SdgDef[] = [
  { id: 1, title: msg`No poverty`, color: '#E5243B' },
  { id: 2, title: msg`Zero hunger`, color: '#DDA63A' },
  { id: 3, title: msg`Good health and well-being`, color: '#4C9F38' },
  { id: 4, title: msg`Quality education`, color: '#C5192D' },
  { id: 5, title: msg`Gender equality`, color: '#FF3A21' },
  { id: 6, title: msg`Clean water and sanitation`, color: '#26BDE2' },
  { id: 7, title: msg`Affordable and clean energy`, color: '#FCC30B' },
  { id: 8, title: msg`Decent work and economic growth`, color: '#A21942' },
  { id: 9, title: msg`Industry, innovation and infrastructure`, color: '#FD6925' },
  { id: 10, title: msg`Reduced inequalities`, color: '#DD1367' },
  { id: 11, title: msg`Sustainable cities and communities`, color: '#FD9D24' },
  { id: 12, title: msg`Responsible consumption and production`, color: '#BF8B2E' },
  { id: 13, title: msg`Climate action`, color: '#3F7E44' },
  { id: 14, title: msg`Life below water`, color: '#0A97D9' },
  { id: 15, title: msg`Life on land`, color: '#56C02B' },
  { id: 16, title: msg`Peace, justice and strong institutions`, color: '#00689D' },
  { id: 17, title: msg`Partnerships for the goals`, color: '#19486A' },
];

const BY_ID = new Map(SDGS.map((g) => [g.id, g]));

/** Colour of the series that gathers the goals beyond the top N (same gray as « Autre » elsewhere). */
export const SDG_OTHER_COLOR = '#8c8677';

export const sdgDef = (id: number): SdgDef | undefined => BY_ID.get(id);
export const sdgColor = (id: number): string => BY_ID.get(id)?.color ?? SDG_OTHER_COLOR;
export const sdgTitle = (id: number): string => {
  const g = BY_ID.get(id);
  return g ? i18n._(g.title) : String(id);
};
/** « SDG 14 » — series and legend label (the full title would not fit a legend). */
export const sdgShortLabel = (id: number): string => i18n._(msg`SDG ${id}`);
/** « SDG 14 · Life below water » — axis labels, tooltips, filter chips. */
export const sdgLabel = (id: number): string => `${sdgShortLabel(id)} · ${sdgTitle(id)}`;
/** Goal number of a label built by sdgShortLabel / sdgLabel (null for any other series name). */
export const sdgOfLabel = (label: string): number | null => {
  const m = /(\d{1,2})/.exec(label);
  const id = m ? Number(m[1]) : NaN;
  return BY_ID.has(id) ? id : null;
};
export const sdgUrl = (id: number): string => `https://sdgs.un.org/goals/goal${id}`;

/** Goal numbers of a publication (empty when OpenAlex tagged none, or the export predates the field). */
export const sdgsOf = (p: DashboardPublication): number[] => (p.sdgs ?? []).map((s) => s.id);
