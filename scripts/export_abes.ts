/**
 * export_abes.ts — « enrichissement IdRef » export for ABES from the command line
 * (docs/plan-export-abes-idref.md, lot 4). Same engine as the Druid modal (lib/abesExport.ts),
 * but the records are projected directly from Grist (without the front end's LDAP layer):
 *   status = `validated_status` if the record is validated, otherwise derived from `statut_dyna`;
 *   employer = label from the Etablissements table; lab = LABO column (+ `rattachement`).
 * Reads the `idref_align_cache.json` cache produced by `scripts/sync_idref.cjs --mode=verify`.
 *
 * Usage (from src/, Node 20 via docker, env VITE_GRIST_DOC_ID + GRIST_API_KEY):
 *   docker run --rm --env-file ../.env -v "$PWD":/app -v "$PWD/../cache-data":/cache:ro -w /app node:20 \
 *     npm run export:abes -- --cache=/cache/idref_align_cache.json --out=/app/exports
 * Options:
 *   --employer=NANTES UNIVERSITE   (repeatable; default: NANTES UNIVERSITE)
 *   --labo=LS2N                    (repeatable; default: all)
 *   --status=INTERNE               (repeatable; default: INTERNE)
 *   --all-validation               (default: validated records only)
 *   --keep-doctorants              (default: DOCTORANT and VACATAIRE excluded)
 *   --no-notes                     (default: 340 notes proposed)
 *   `--sans-notice`                (sans_notice sheet)
 *   --include-sent                 (include the rows already marked as sent)
 *   --mark-sent                    (writes ABES_export_hash / ABES_export_date on the exported rows)
 *   --cache=<path>  --out=<directory>  --date=YYYY-MM-DD
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { computeAbesDiff, AbesExportOptions, abesTaskTypes } from '../lib/abesExport';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tasksSchema = require('./lib/tasks_schema.cjs');
import { normalizeFuzzyDate, isFuzzyDatePast } from '../lib/dates';
import type { Researcher, Structure } from '../types';
import type { Institution } from '../lib/gristService';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // FortiGate (see scripts/sync_idref.cjs)
const GRIST_BASE = 'https://grist.numerique.gouv.fr/api';
const DOC = process.env.VITE_GRIST_DOC_ID || process.env.GRIST_DOC_ID;
const KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY;
if (!DOC || !KEY) { console.error('VITE_GRIST_DOC_ID / GRIST_API_KEY manquants'); process.exit(1); }

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const multi = (name: string): string[] => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3)).filter(Boolean);
const single = (name: string, def = ''): string => multi(name).pop() ?? def;
const flag = (name: string): boolean => args.includes(`--${name}`);

const today = single('date', new Date().toISOString().slice(0, 10));
const cachePath = single('cache', 'idref_align_cache.json');
const outDir = single('out', 'exports');
const employers = multi('employer'); const labos = multi('labo'); const statuses = multi('status');
const options: AbesExportOptions = {
  extractionDate: today,
  employers: employers.length ? employers : ['NANTES UNIVERSITE'],
  labos,
  statuses: statuses.length ? statuses : ['INTERNE'],
  validatedOnly: !flag('all-validation'),
  excludeEmploymentTypes: flag('keep-doctorants') ? [] : ['DOCTORANT', 'VACATAIRE'],
  proposeNotes: !flag('no-notes'),
  includeSansNotice: flag('sans-notice'),
  includeAlreadySent: flag('include-sent'),
};

// ── Grist ─────────────────────────────────────────────────────────────────────
const grist = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${GRIST_BASE}/docs/${DOC}/${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`Grist ${r.status} ${path}: ${await r.text()}`);
  return r.json();
};
// Date cells: epoch (Date column) or fuzzy text (`2026`, `2026-06`, employment/membership columns once migrated).
const gristDate = (v: any): string => normalizeFuzzyDate(v) ?? '';
const label = (v: any): string => String(v || '').replace(/\[fr\]/g, '').split('|')[0].trim();

async function main() {
  const etabRecs = (await grist('tables/Etablissements/records')).records as any[];
  const etablissements: Institution[] = etabRecs.map((r) => ({
    id: r.id, name: String(r.fields.Employeur || ''), uai: String(r.fields.UAI || ''), ror: String(r.fields.ROR || ''),
    idref: String(r.fields.idref || ''), label: String(r.fields.Libelle || r.fields.Employeur || ''),
  }));
  const etabById = new Map(etablissements.map((e) => [e.id, e]));

  const structures = ((await grist('tables/Structures/records')).records as any[]).map((r) => ({
    acronym: label(r.fields.short_labels), officialName: label(r.fields.long_labels), type: String(r.fields.type || ''),
    rnsrId: String(r.fields.nns || ''), rorId: String(r.fields.ror || ''),
    identifiers: { halStructIds: [], idrefId: String(r.fields.idref || '') },
  })) as unknown as Structure[];

  const rows = (await grist('tables/Annuaire/records')).records as any[];
  const alreadySent: Record<string, string> = {};
  const rowIdByUid = new Map<string, number>();
  const researchers = rows.map((r): Researcher => {
    const f = r.fields;
    const uid = String(f.uid_dyna || '');
    const id = uid || `g${r.id}`;
    rowIdByUid.set(id, r.id);
    if (f.ABES_export_hash) alreadySent[id] = String(f.ABES_export_hash);
    const validated = f.validated === true;
    const vs = String(f.validated_status || '').toUpperCase();
    // A past Grist employment end counts as a departure even if statut_dyna (LDAP) is still ACTIF (LDAP
    // lagging): same rule as lib/gristService.ts::isEmploymentEnded, otherwise a departed employee is
    // exported to ABES as an active internal (medium review of scripts/, finding export_abes.ts).
    const employmentEnded = isFuzzyDatePast(gristDate(f.employment_end_date), today);
    const derived = f.statut_dyna === 'DEPART' || f.statut_dyna === 'SUPPRIME' || employmentEnded ? 'DEPART' : 'INTERNE';
    return {
      id, uid, gristRowId: r.id, civility: '', lastName: String(f.Nom || ''), firstName: String(f.Prenom || ''), displayName: `${f.Nom || ''} ${f.Prenom || ''}`.trim(),
      email: String(f.Email || ''), birthDate: gristDate(f.DATE_DE_NAISSANCE_JJ_MM_AAAA),
      status: (validated && vs ? vs : derived) as Researcher['status'],
      employment: { employer: etabById.get(f.Employeur)?.name || '', grade: String(f.Corps_grade || ''), contractType: String(f.TYPE_EMPLOI || ''), startDate: gristDate(f.employment_start_date), endDate: gristDate(f.employment_end_date) },
      // Membership dates (affiliation_*_date, since 2026-09-14), employment start as a fallback like the app.
      affiliations: [{ structureName: String(f.LABO || ''), team: String(f.team || ''), startDate: gristDate(f.affiliation_start_date) || gristDate(f.employment_start_date), endDate: gristDate(f.affiliation_end_date), isPrimary: true, role: f.rattachement || undefined }],
      groups: [],
      identifiers: { orcid: String(f.ORCID || ''), idref: String(f.IdRef || ''), halId: String(f.IdHAL || ''), scopusId: f.ID_SCOPUS ? String(f.ID_SCOPUS) : '' },
      validation: { validated, validationSource: String(f.validation_source || ''), validationScope: ['statut', 'rattachement'] },
    };
  });

  if (!existsSync(cachePath)) { console.error(`IdRef cache not found: ${cachePath} (run sync_idref.cjs --mode=verify)`); process.exit(1); }
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const diff = computeAbesDiff(researchers, structures, etablissements, cache, { ...options, alreadySent });

  console.log(JSON.stringify(diff.stats, null, 1));
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `abes-idref-${today}`);
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, data: any[], headers?: string[]) =>
    XLSX.utils.book_append_sheet(wb, data.length ? XLSX.utils.json_to_sheet(data, headers ? { header: headers } : undefined) : XLSX.utils.aoa_to_sheet([headers || []]), name);
  sheet('enrichissements', diff.enrichissements);
  sheet('conflits', diff.conflits, ['ppn', 'nom', 'prenom', 'id_local', 'champ', 'valeur_idref', 'valeur_druid', 'source_druid', 'commentaire']);
  sheet('sans_notice', diff.sansNotice, ['nom', 'prenom', 'id_local', 'orcid', 'idhal', 'scopus', 'etab_ppn', 'etab_nom', 'labo_ppn', 'labo_nom', 'fonction', 'note_340', 'annee_naissance']);
  sheet('structures', diff.structures, ['acronyme', 'nom', 'ppn_idref', 'rnsr', 'ror', 'type', 'action']);
  XLSX.writeFile(wb, `${base}.xlsx`);
  const csvEsc = (v: any) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  if (diff.enrichissements.length) {
    const headers = Object.keys(diff.enrichissements[0]);
    writeFileSync(`${base}-enrichissements.csv`, '﻿' + [headers.join(';'), ...diff.enrichissements.map((r: any) => headers.map((h) => csvEsc(r[h])).join(';'))].join('\n') + '\n');
  }
  writeFileSync(`${base}-stats.json`, JSON.stringify({ date: today, options, stats: diff.stats }, null, 1));
  console.log(`✓ ${diff.enrichissements.length} lignes → ${base}.xlsx`);

  if (flag('mark-sent') && diff.enrichissements.length) {
    const records = diff.enrichissements
      .map((row) => ({ id: rowIdByUid.get(row.id_local) || 0, fields: { ABES_export_hash: diff.hashes[row.id_local], ABES_export_date: today } }))
      .filter((r) => r.id && r.fields.ABES_export_hash);
    for (let i = 0; i < records.length; i += 200) {
      await grist('tables/Annuaire/records', { method: 'PATCH', body: JSON.stringify({ records: records.slice(i, i + 200) }) });
    }
    console.log(`✓ ${records.length} records flagged as sent (${today})`);

    // « À traiter › Tâches » (docs/plan-chantiers-taches.md, lot 6): the open « lot ABES » tasks
    // covered by these rows are done. No Taches table yet ⇒ nothing to close.
    const items = diff.enrichissements
      .map((row) => ({ rowId: rowIdByUid.get(row.id_local) || 0, uid: row.id_local, types: abesTaskTypes(row) }))
      .filter((it) => it.types.length);
    let tasks: any[] = [];
    try { tasks = (await grist(`tables/${tasksSchema.TASKS_TABLE}/records`)).records || []; } catch { tasks = []; }
    const { patches, events } = tasksSchema.abesSentPatches(tasks, items, { author: 'cli:export_abes', date: today });
    for (let i = 0; i < patches.length; i += 100) {
      await grist(`tables/${tasksSchema.TASKS_TABLE}/records`, { method: 'PATCH', body: JSON.stringify({ records: patches.slice(i, i + 100) }) });
    }
    for (let i = 0; i < events.length; i += 100) {
      await grist(`tables/${tasksSchema.EVENTS_TABLE}/records`, { method: 'POST', body: JSON.stringify({ records: events.slice(i, i + 100).map((fields: any) => ({ fields })) }) });
    }
    console.log(`✓ ${patches.length} « lot ABES » task(s) closed`);
  }
}

main().catch((e) => { console.error('✗', e); process.exit(1); });
