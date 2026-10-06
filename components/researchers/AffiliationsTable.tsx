import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, ExternalLink, X, Briefcase, Check } from 'lucide-react';
import { Affiliation, MEMBERSHIP_TYPES, MembershipType } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { FuzzyDateInput } from './FuzzyDateInput';
import { formatFuzzyDate } from '../../lib/dates';
import { MEMBERSHIP_LABELS } from '../../lib/researcherLabels';

/** Team option: name + parent lab (to filter by chosen structure). */
export interface TeamOption {
  name: string;
  parent?: string;
}

interface AffiliationsTableProps {
  affiliations: Affiliation[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: keyof Affiliation, value: any) => void;
  onNavigateToStructure?: (structureId: string) => void;
  /** Research structures existing in Grist (acronyms) — Structure dropdown. */
  labOptions?: string[];
  /** Teams existing in Grist (Structures table, Team level) — Team dropdown. */
  teamOptions?: TeamOption[];
  /** « Ajouter une équipe… » entry of the Team menu: opens the creation page of a team of the lab. */
  onCreateTeam?: (structureName: string) => void;
  /** Current employment end date (Emploi card) — drives the "copy as employment end" button state. */
  employmentEndDate?: string;
  /** One-click copy of a membership end date into the employment end date (Emploi card). */
  onCopyEndDateToEmployment?: (date: string) => void;
}

/**
 * Fallback <option> when the record's current value does not (or no longer) exist
 * in Grist: kept selectable so as not to lose the data on screen,
 * flagged « hors liste ».
 */
const OutOfListOption: React.FC<{ value: string; options: string[] }> = ({ value, options }) => {
  const { t } = useLingui();
  return value && !options.includes(value) ? <option value={value}>{t`${value} (not in list)`}</option> : null;
};

/** Sentinel value of the « Ajouter une équipe… » entry of the Team menu. */
const NEW_TEAM_VALUE = '__new_team__';

/** Champ sombre (carte « Appartenances » fond ink, accents jaunes). */
const darkInput =
  'box-border rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 text-[13px] font-semibold text-white placeholder:text-white/35 outline-none focus:border-accent/70 transition-colors';

export const AffiliationsTable: React.FC<AffiliationsTableProps> = ({
  affiliations,
  onAdd,
  onRemove,
  onChange,
  onNavigateToStructure,
  labOptions = [],
  teamOptions = [],
  onCreateTeam,
  employmentEndDate = '',
  onCopyEndDateToEmployment,
}) => {
  // Teams proposed for a structure: those attached to this lab if known
  // (parentStructure), otherwise all (unknown parent or empty lab).
  const { t } = useLingui();
  // Teams proposed for a structure: ONLY those attached to this lab (parent_structure
  // of the Structures table, compared case-insensitively). Empty lab or no known team → empty list, the
  // current value staying selectable via OutOfListOption.
  const norm = (s: string) => String(s || '').trim().toUpperCase();
  const teamsFor = (structureName: string): string[] => {
    if (!norm(structureName)) return [];
    return teamOptions.filter((o) => norm(o.parent || '') === norm(structureName)).map((o) => o.name);
  };
  // Several teams per membership: stored « A|B » in the Grist `team` column, displayed
  // one row per team. Empty rows being entered (« Ajouter une équipe ») are not
  // in the value: pending slots are counted per membership.
  const splitTeams = (team: string): string[] => String(team || '').split('|').map((x) => x.trim()).filter(Boolean);
  const [pendingSlots, setPendingSlots] = useState<Record<number, number>>({});
  // `onRemove` (ResearcherDetail::handleRemoveAffiliation) does a splice: the indices of the
  // following memberships shift, but pendingSlots stays keyed on the old index — a
  // pending « Ajouter une équipe » slot ended up orphaned or reappeared on
  // the wrong row after a removal (review lot 6b). An empty slot not yet filled
  // has no value to preserve: simply reset as soon as a row disappears.
  const prevLenRef = useRef(affiliations.length);
  useEffect(() => {
    if (affiliations.length < prevLenRef.current) setPendingSlots({});
    prevLenRef.current = affiliations.length;
  }, [affiliations.length]);
  const setTeamAt = (idx: number, teams: string[], pos: number, value: string) => {
    const next = [...teams];
    next[pos] = value.trim();
    onChange(idx, 'team', Array.from(new Set(next.filter(Boolean))).join('|'));
  };

  return (
    <div className="bg-ink dark:bg-white/5 dark:border dark:border-white/10 rounded-panel shadow-soft-lg p-5 md:p-6 text-white h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-bold uppercase tracking-[.09em] text-accent"><Trans>Affiliations & history</Trans></div>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold text-white/70 bg-white/10 hover:bg-white/20 hover:text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> <Trans>Add</Trans>
        </button>
      </div>

      <div className="flex-1 space-y-2.5">
        {affiliations.map((aff, idx) => (
          <div
            key={idx}
            className={`rounded-2xl p-3 ${
              aff.isPrimary
                ? 'bg-white/10 border border-accent/30'
                : 'bg-white/[.06] border border-white/10'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                title={aff.isPrimary ? t`Primary affiliation` : undefined}
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${aff.isPrimary ? 'bg-[#9a7bff]' : 'bg-white/30'}`}
              ></span>
              {aff.role && aff.role !== 'PRINCIPAL' && (
                <span title={aff.role === 'HISTORIQUE' ? t`Former affiliation (directory row qualified HISTORIQUE)` : t`Concurrent affiliation (directory row qualified SECONDAIRE)`}
                  className={`text-[10px] font-bold uppercase tracking-[.06em] px-1.5 py-0.5 rounded-full ${aff.role === 'HISTORIQUE' ? 'bg-white/10 text-white/50' : 'bg-accent/25 text-accent'}`}>
                  {aff.role === 'HISTORIQUE' ? t`former` : t`secondary`}
                </span>
              )}
              <select
                value={aff.structureName}
                onChange={(e) => onChange(idx, 'structureName', e.target.value)}
                className={`flex-1 min-w-[140px] ${darkInput} text-[14px] [color-scheme:dark]`}
              >
                <option value="">{t`— Structure —`}</option>
                <OutOfListOption value={aff.structureName} options={labOptions} />
                {labOptions.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              {aff.structureId && onNavigateToStructure && (
                <button
                  onClick={() => onNavigateToStructure(aff.structureId!)}
                  title={t`Show this structure's detailed record`}
                  className="p-1.5 rounded-full text-white/50 hover:text-accent hover:bg-white/10 transition-colors shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => onRemove(idx)}
                title={t`Remove this affiliation`}
                className="p-1.5 rounded-full text-white/40 hover:text-[#f08c8c] hover:bg-white/10 transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {/* Row 2 — membership IN THE LAB: type + period (Grist columns membership_type,
                affiliation_start/end_date). Distinct from the employment dates (Employment card). */}
            <div className="mt-2.5 pl-5 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
              <span className="text-[10px] font-bold uppercase tracking-[.06em] text-accent"><Trans>Lab membership</Trans></span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={aff.membershipType || ''}
                  onChange={(e) => onChange(idx, 'membershipType', (e.target.value || undefined) as MembershipType | undefined)}
                  title={t`Membership type in the structure (CRISalid vocabulary, membership_type column of people.csv)`}
                  className={`w-52 max-w-full ${darkInput} [color-scheme:dark]`}
                >
                  <option value="">{t`— Membership type —`}</option>
                  {MEMBERSHIP_TYPES.map((m) => (
                    <option key={m} value={m}>{t(MEMBERSHIP_LABELS[m])}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                  <Trans>from</Trans>
                  <FuzzyDateInput
                    value={aff.startDate || ''}
                    onChange={(d) => onChange(idx, 'startDate', d)}
                    title={t`Date of entry into the structure (not the hiring date) — YYYY, YYYY-MM or YYYY-MM-DD`}
                    className={`${darkInput} [color-scheme:dark]`}
                    wrapperClassName="w-40"
                    dark
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                  <Trans context="date range">to</Trans>
                  <FuzzyDateInput
                    value={aff.endDate || ''}
                    onChange={(d) => onChange(idx, 'endDate', d)}
                    title={t`Date of leaving the structure — empty while the membership is ongoing — YYYY, YYYY-MM or YYYY-MM-DD`}
                    className={`${darkInput} [color-scheme:dark]`}
                    wrapperClassName="w-40"
                    dark
                  />
                </label>
                {/* One click copies the membership end into the employment end (Emploi card): both
                    past ⇒ status « Parti » whatever the validation (rule of 2026-09-22). */}
                {onCopyEndDateToEmployment && aff.endDate && (
                  employmentEndDate === aff.endDate ? (
                    <span
                      title={t`The employment end (Employment card) is already set to this date`}
                      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.06em] text-[#5fd39a]"
                    >
                      <Check className="w-3.5 h-3.5" /><Trans>= employment end</Trans>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onCopyEndDateToEmployment(aff.endDate || '')}
                      title={employmentEndDate
                        ? t`Replace the employment end (${formatFuzzyDate(employmentEndDate)}) with this date`
                        : t`Copy this date as the employment end (Employment card)`}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-accent hover:bg-accent/25 transition-colors"
                    >
                      <Briefcase className="w-3.5 h-3.5" /><Trans>→ employment end</Trans>
                    </button>
                  )
                )}
              </div>
              {/* Rows 3+ — one row per team (Grist `team` column, « | » separator), without date:
                  Druid does not handle a period per team. Menu limited to the teams of the chosen lab. */}
              {(() => {
                const teams = splitTeams(aff.team);
                const slots = [...teams, ...Array.from({ length: teams.length === 0 ? 1 : (pendingSlots[idx] || 0) }, () => '')];
                const options = teamsFor(aff.structureName);
                return slots.map((team, pos) => (
                  <React.Fragment key={`${idx}-${pos}`}>
                    <span className="text-[10px] font-bold uppercase tracking-[.06em] text-[#5fd39a]">
                      {pos === 0 ? t`Team` : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={team}
                        onChange={(e) => {
                          if (e.target.value === NEW_TEAM_VALUE) { onCreateTeam?.(aff.structureName); return; }
                          setTeamAt(idx, teams, pos, e.target.value);
                          if (pos >= teams.length && e.target.value) setPendingSlots((p) => ({ ...p, [idx]: Math.max(0, (p[idx] || 0) - 1) }));
                        }}
                        title={options.length === 0 && aff.structureName ? t`No known team for ${aff.structureName} in the Structures table` : undefined}
                        className={`w-52 max-w-full ${darkInput} [color-scheme:dark]`}
                      >
                        <option value="">{t`— Team —`}</option>
                        <OutOfListOption value={team} options={options} />
                        {options.filter((o) => o === team || !teams.includes(o)).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                        {onCreateTeam && aff.structureName && (
                          <option value={NEW_TEAM_VALUE}>{t`+ Add a team to ${aff.structureName}…`}</option>
                        )}
                      </select>
                      {(team || pos >= teams.length) && slots.length > 1 && (
                        <button
                          onClick={() => {
                            if (pos < teams.length) onChange(idx, 'team', teams.filter((_, i) => i !== pos).join('|'));
                            else setPendingSlots((p) => ({ ...p, [idx]: Math.max(0, (p[idx] || 0) - 1) }));
                          }}
                          title={t`Remove this team`}
                          className="p-1 rounded-full text-white/40 hover:text-[#f08c8c] hover:bg-white/10 transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {pos === slots.length - 1 && team && (
                        <button
                          onClick={() => setPendingSlots((p) => ({ ...p, [idx]: (p[idx] || 0) + 1 }))}
                          title={t`Add a team (several teams allowed within the same lab)`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                        >
                          <Plus className="w-3 h-3" /> <Trans>Team</Trans>
                        </button>
                      )}
                    </div>
                  </React.Fragment>
                ));
              })()}
            </div>
          </div>
        ))}
        {affiliations.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/20 p-4 text-[13px] text-white/45 italic">
            <Trans>No affiliation recorded.</Trans>
          </div>
        )}
      </div>
    </div>
  );
};
