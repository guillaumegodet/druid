import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, HelpCircle, PenLine, Upload, UserPlus, Users, X } from 'lucide-react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { DirectoryApi } from '../../lib/directoryApi';
import { apiErrorText } from '../../lib/apiErrors';
import {
  parseCsv, readSheet, teamKey,
  type PeopleImportField, type PeopleImportInput, type PeopleImportPlan, type PeopleImportResult, type PeopleImportUpdateField, type SheetReading,
} from '../../lib/directory/peopleImport';

const FIELD_LABELS: Record<PeopleImportField, MessageDescriptor> = {
  lastName: msg`Last name`, firstName: msg`First name`, lab: msg`Lab`, email: msg`Email`, team: msg`Team`, employer: msg`Employer`,
  position: msg`Position`, grade: msg`Corps / grade`, orcid: msg`ORCID`, idref: msg`IdRef`, halId: msg`IdHAL`, uid: msg`Local identifier`,
};
const REJECT_LABELS: Record<PeopleImportPlan['rejected'][number]['reason'], MessageDescriptor> = {
  lastName: msg`no last name`, lab: msg`no lab`, unknownLab: msg`lab not in the directory`, duplicate: msg`same person twice in this lab`,
};
/** Headers of the template, in the order of the columns (French: the establishments' files are). */
const TEMPLATE_HEADERS = ['Nom', 'Prénom', 'Laboratoire', 'E-mail', 'Équipe', 'Employeur', 'Fonction', 'Corps-grade', 'ORCID', 'IdRef', 'IdHAL'];

const panel = 'rounded-card bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft overflow-hidden';
const panelHead = 'px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 border-b border-ink/5 dark:border-white/5 cursor-pointer select-none';
const rowCls = 'px-4 py-1.5 flex items-start gap-2.5 text-[13px] text-ink dark:text-[#f5f2ea]';
const box = 'mt-0.5 accent-[#1c1b19] dark:accent-[#f4d24a]';
const pill = 'inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/80 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer hover:bg-white dark:hover:bg-white/15';

interface PeopleFileImportProps {
  onClose: () => void;
  /** Called after an application, to read the directory again. */
  onApplied: () => void;
}

const fieldKey = (index: number, field: PeopleImportUpdateField) => `${index}:${field}`;

/** A collapsible group of the review (defined outside the component: a remount would close it at every tick). */
const Section: React.FC<{ icon: React.ReactNode; title: React.ReactNode; count: number; open?: boolean; children: React.ReactNode }> = ({ icon, title, count, open = false, children }) =>
  count ? (
    <details className={panel} open={open}>
      <summary className={panelHead}>{icon} {title} <span className="ml-auto text-muted dark:text-[#a8a293]">{count}</span></summary>
      <div className="py-1 max-h-72 overflow-auto">{children}</div>
    </details>
  ) : null;

/**
 * Import of a spreadsheet of researchers (druid-internal docs/plan-druid-saas.md, lot 5 a): CSV or XLSX, one row per
 * person and lab, read here; the server computes the plan (lib/directory/peopleImport.ts) and applies what the user
 * keeps — creations, new memberships, teams and complements ticked, differences not.
 */
export const PeopleFileImport: React.FC<PeopleFileImportProps> = ({ onClose, onApplied }) => {
  const { t } = useLingui();
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState<SheetReading | null>(null);
  const [plan, setPlan] = useState<PeopleImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PeopleImportResult | null>(null);
  const [teams, setTeams] = useState<Set<string>>(new Set());
  const [creations, setCreations] = useState<Set<number>>(new Set());
  const [joins, setJoins] = useState<Set<number>>(new Set());
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [validateNew, setValidateNew] = useState(false);

  /** Source written on the created records (« Fichier chercheurs.xlsx »). */
  const sourceOf = (name: string) => t`File ${name}`;
  const input: PeopleImportInput | null = useMemo(() => (reading?.rows.length ? { source: sourceOf(fileName), rows: reading.rows } : null), [reading, fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadTemplate = async (kind: 'xlsx' | 'csv') => {
    if (kind === 'csv') {
      const blob = new Blob(['﻿' + TEMPLATE_HEADERS.join(';') + '\r\n'], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'druid-chercheurs.csv'; a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]), 'Chercheurs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Colonne', 'Obligatoire', 'Contenu'],
      ['Nom', 'oui', 'Nom de famille'],
      ['Prénom', 'recommandé', ''],
      ['Laboratoire', 'oui', 'Sigle du laboratoire tel que Druid le connaît (page Structures). Une personne dans deux laboratoires = deux lignes.'],
      ['E-mail', 'recommandé', 'Adresse professionnelle : elle évite les doublons et sert aux alignements'],
      ['Équipe', 'non', 'Sigle de l’équipe ; plusieurs équipes séparées par « | »'],
      ['Employeur', 'non', 'Établissement employeur (Université…, CNRS, Inserm…)'],
      ['Fonction', 'non', 'Doctorant, post-doctorant… : sert à typer la fiche'],
      ['Corps-grade', 'non', 'PR, MCF, DR, CR, IR…'],
      ['ORCID / IdRef / IdHAL', 'non', 'Identifiants connus (identifiant seul ou adresse complète)'],
    ]), 'Aide');
    XLSX.writeFile(wb, 'druid-chercheurs.xlsx');
  };

  const loadFile = async (file: File) => {
    setError(''); setPlan(null); setResult(null); setReading(null); setFileName(file.name);
    let matrix: unknown[][];
    try {
      if (/\.(csv|txt)$/i.test(file.name)) matrix = parseCsv(await file.text());
      else {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }) as unknown[][];
      }
    } catch {
      setError(t`This file could not be read: save it as .xlsx or .csv.`);
      return;
    }
    const r = readSheet(matrix);
    setReading(r);
    if (r.missing.length) return;
    if (!r.rows.length) { setError(t`The file has no rows under its headers.`); return; }
    setBusy(true);
    try {
      const p = await DirectoryApi.peopleImportPreview({ source: sourceOf(file.name), rows: r.rows });
      setPlan(p);
      setTeams(new Set(p.teams.map((tm) => teamKey(tm.lab, tm.acronym))));
      setCreations(new Set(p.creations.map((c) => c.index)));
      setJoins(new Set(p.joins.map((j) => j.index)));
      setFields(new Set(p.updates.flatMap((u) => u.complements.map((c) => fieldKey(u.index, c.field)))));
    } catch (err) {
      setError(apiErrorText(err) || t`The file could not be read.`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    apply(next);
  };
  const allOrNone = <T,>(set: Set<T>, all: T[], apply: (s: Set<T>) => void) => apply(all.every((v) => set.has(v)) ? new Set() : new Set(all));

  const selectedFields = [...fields].map((k) => { const [i, f] = k.split(':'); return { index: Number(i), field: f as PeopleImportUpdateField }; });
  const total = teams.size + creations.size + joins.size + new Set(selectedFields.map((f) => f.index)).size;
  const withDifferences = plan?.updates.filter((u) => u.differences.length) ?? [];
  const withComplements = plan?.updates.filter((u) => u.complements.length) ?? [];

  const apply = async () => {
    if (!plan || !input) return;
    setBusy(true); setError('');
    try {
      setResult(await DirectoryApi.peopleImportApply(input, { teams: [...teams], creations: [...creations], joins: [...joins], fields: selectedFields, validateNew }));
      onApplied();
    } catch (err) {
      setError(apiErrorText(err) || t`The import could not be applied.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <h3 className="flex items-center gap-2 font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
            <FileSpreadsheet className="w-5 h-5" /> <Trans>Import researchers from a file</Trans>
          </h3>
          <button onClick={onClose} aria-label={t`Close`} className="w-9 h-9 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-5">
          <div className="space-y-3">
            <p className="text-[13px] text-muted dark:text-[#a8a293]">
              <Trans>One row per person and lab: last name, first name, lab acronym, and if you have them the email, team, employer, position, corps-grade and identifiers. Druid recognizes the usual headers, matches the people it already has and shows what it will do: nothing is written before you apply.</Trans>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pill} onClick={() => void downloadTemplate('xlsx')}><Download className="w-4 h-4" /> <Trans>Template (.xlsx)</Trans></button>
              <button type="button" className={pill} onClick={() => void downloadTemplate('csv')}><Download className="w-4 h-4" /> <Trans>Template (.csv)</Trans></button>
              <label className={pill}>
                <Upload className="w-4 h-4" /> {fileName || <Trans>Choose the file (.xlsx, .csv)</Trans>}
                <input type="file" accept=".xlsx,.xls,.ods,.csv,.txt" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
              </label>
            </div>
            {busy && <p className="text-[12.5px] text-muted"><Trans>Working…</Trans></p>}
            {error && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]"><AlertTriangle className="w-4 h-4" /> {error}</p>}
          </div>

          {reading && (
            <div className="space-y-1.5">
              <p className="text-[12px] font-semibold text-muted dark:text-[#a8a293]"><Trans>Columns read</Trans></p>
              <div className="flex flex-wrap gap-1.5">
                {reading.columns.map((c, i) => (
                  <span key={i} className={`px-2.5 py-1 rounded-full text-[12px] border ${c.field ? 'bg-[#e3f0e8] dark:bg-[#1f7a4d]/20 border-[#bfe3cc] dark:border-[#1f7a4d]/40 text-ink dark:text-[#f5f2ea]' : 'bg-white/50 dark:bg-white/5 border-ink/10 dark:border-white/10 text-muted line-through'}`}
                    title={c.field ? undefined : t`Column ignored`}>
                    {c.header || '—'}{c.field ? ` → ${t(FIELD_LABELS[c.field])}` : ''}
                  </span>
                ))}
              </div>
              {reading.missing.length > 0 && (
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">
                  <AlertTriangle className="w-4 h-4" /> <Trans>Required column not found: {reading.missing.map((f) => t(FIELD_LABELS[f])).join(', ')}. Use the headers of the template.</Trans>
                </p>
              )}
            </div>
          )}

          {result && (
            <div className={`${panel} p-4 space-y-1 text-[13px] text-ink dark:text-[#f5f2ea]`}>
              <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-4 h-4 text-[#1f7a4d] dark:text-[#5fd39a]" /> <Trans>Import applied</Trans></p>
              <p>
                <Plural value={result.created} one="# record created" other="# records created" /> · <Plural value={result.joined} one="# membership added" other="# memberships added" /> · <Plural value={result.updated} one="# record completed" other="# records completed" /> · <Plural value={result.teamsCreated} one="# team created" other="# teams created" />
              </p>
              {result.stale > 0 && <p className="text-muted"><Plural value={result.stale} one="# item no longer applied (the directory changed since the preview)" other="# items no longer applied (the directory changed since the preview)" /></p>}
              {result.errors.map((e, i) => <p key={i} className="text-[#b23b3b] dark:text-[#f08c8c]">{e.name} : {e.error}</p>)}
            </div>
          )}

          {plan && !result && (
            <div className="space-y-3">
              <p className="text-[13px] text-ink dark:text-[#f5f2ea]">
                <Plural value={plan.rowCount} one="# row read" other="# rows read" /> · <Plural value={plan.creations.length} one="# new person" other="# new people" /> · <Plural value={plan.joins.length} one="# new membership" other="# new memberships" /> · <Plural value={plan.updates.length} one="# person to complete" other="# people to complete" /> · <Plural value={plan.unchanged} one="# already up to date" other="# already up to date" />
              </p>

              <Section icon={<Users className="w-4 h-4" />} title={<Trans>Teams to create</Trans>} count={plan.teams.length}>
                <div className="px-4 py-1"><button type="button" className="text-[12px] font-semibold underline" onClick={() => allOrNone(teams, plan.teams.map((tm) => teamKey(tm.lab, tm.acronym)), setTeams)}><Trans>All / none</Trans></button></div>
                {plan.teams.map((tm) => {
                  const k = teamKey(tm.lab, tm.acronym);
                  return <label key={k} className={rowCls}><input type="checkbox" className={box} checked={teams.has(k)} onChange={() => toggle(teams, k, setTeams)} /> <span><strong>{tm.acronym}</strong> <span className="text-muted">— {tm.lab}</span></span></label>;
                })}
              </Section>

              <Section icon={<UserPlus className="w-4 h-4" />} title={<Trans>People to create</Trans>} count={plan.creations.length} open>
                <div className="px-4 py-1"><button type="button" className="text-[12px] font-semibold underline" onClick={() => allOrNone(creations, plan.creations.map((c) => c.index), setCreations)}><Trans>All / none</Trans></button></div>
                {plan.creations.map((c) => (
                  <label key={c.index} className={rowCls}>
                    <input type="checkbox" className={box} checked={creations.has(c.index)} onChange={() => toggle(creations, c.index, setCreations)} />
                    <span><strong>{c.lastName.toUpperCase()} {c.firstName}</strong> <span className="text-muted">— {c.labs.map((l) => l.team ? `${l.lab} (${l.team})` : l.lab).join(', ')}{c.grade ? ` · ${c.grade}` : ''}{c.email ? ` · ${c.email}` : ''}</span></span>
                  </label>
                ))}
              </Section>

              <Section icon={<UserPlus className="w-4 h-4" />} title={<Trans>Memberships to add to existing records</Trans>} count={plan.joins.length}>
                {plan.joins.map((j) => (
                  <label key={j.index} className={rowCls}>
                    <input type="checkbox" className={box} checked={joins.has(j.index)} onChange={() => toggle(joins, j.index, setJoins)} />
                    <span><strong>{j.name}</strong> <span className="text-muted">+ {j.lab}{j.team ? ` (${j.team})` : ''}</span></span>
                  </label>
                ))}
              </Section>

              <Section icon={<PenLine className="w-4 h-4" />} title={<Trans>Values to add (Druid has none)</Trans>} count={withComplements.length}>
                {withComplements.map((u) => (
                  <div key={u.index} className={rowCls}>
                    <span className="min-w-[10rem] font-semibold">{u.name}</span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {u.complements.map((c) => (
                        <label key={c.field} className="inline-flex items-center gap-1">
                          <input type="checkbox" className={box} checked={fields.has(fieldKey(u.index, c.field))} onChange={() => toggle(fields, fieldKey(u.index, c.field), setFields)} />
                          <span className="text-muted">{t(FIELD_LABELS[c.field])} :</span> {c.value}
                        </label>
                      ))}
                    </span>
                  </div>
                ))}
              </Section>

              <Section icon={<PenLine className="w-4 h-4" />} title={<Trans>Differences (tick when the file is right)</Trans>} count={withDifferences.length}>
                {withDifferences.map((u) => (
                  <div key={u.index} className={rowCls}>
                    <span className="min-w-[10rem] font-semibold">{u.name}</span>
                    <span className="flex flex-col gap-1">
                      {u.differences.map((d) => (
                        <label key={d.field} className="inline-flex items-center gap-1">
                          <input type="checkbox" className={box} checked={fields.has(fieldKey(u.index, d.field))} onChange={() => toggle(fields, fieldKey(u.index, d.field), setFields)} />
                          <span className="text-muted">{t(FIELD_LABELS[d.field])} :</span> {d.current} → <strong>{d.file}</strong>
                        </label>
                      ))}
                    </span>
                  </div>
                ))}
              </Section>

              <Section icon={<HelpCircle className="w-4 h-4" />} title={<Trans>Ambiguous (homonyms in the lab: left out)</Trans>} count={plan.ambiguous.length}>
                {plan.ambiguous.map((a) => <div key={a.index} className={rowCls}><span><strong>{a.name}</strong> <span className="text-muted">— {a.lab} : {a.candidates.map((c) => c.name).join(', ')}</span></span></div>)}
              </Section>

              <Section icon={<AlertTriangle className="w-4 h-4" />} title={<Trans>Rows left out</Trans>} count={plan.rejected.length}>
                {plan.rejected.map((r) => <div key={r.index} className={rowCls}><span><Trans>Row {r.index + 2}</Trans> · <strong>{r.name || '—'}</strong> {r.lab ? `(${r.lab})` : ''} <span className="text-muted">— {t(REJECT_LABELS[r.reason])}</span></span></div>)}
              </Section>

              <Section icon={<AlertTriangle className="w-4 h-4" />} title={<Trans>Values not recognized (ignored)</Trans>} count={plan.warnings.length}>
                {plan.warnings.map((w, i) => <div key={i} className={rowCls}><span><Trans>Row {w.index + 2}</Trans> · {t(FIELD_LABELS[w.field as PeopleImportField] ?? msg`Value`)} : <code>{w.value}</code></span></div>)}
              </Section>

              <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea]">
                <input type="checkbox" className={box} checked={validateNew} onChange={(e) => setValidateNew(e.target.checked)} />
                <Trans>Mark the created records as validated (this list is the establishment's reference)</Trans>
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ink/5 dark:border-white/5">
          <button onClick={onClose} className="h-10 px-5 rounded-full text-[13px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-white/60 dark:hover:bg-white/10">{result ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}</button>
          {plan && !result && (
            <button onClick={() => void apply()} disabled={busy || total === 0}
              className="h-10 px-5 rounded-full bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1b19] text-[13px] font-semibold disabled:opacity-50">
              <Plural value={total} one="Apply # change" other="Apply # changes" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
