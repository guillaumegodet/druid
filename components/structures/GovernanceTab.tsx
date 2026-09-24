import React from 'react';
import { Layers, Network, X, Plus, Star } from 'lucide-react';
import { Structure, Membership, SupervisionCode } from '../../types';
import { getTutelleName } from '../../lib/uaiMapping';
import { Trans, useLingui } from '@lingui/react/macro';
import { LEVEL_LABELS, SUPERVISION_LABELS } from '../../lib/structureLabels';

interface GovernanceTabProps {
  structure: Structure;
  /** All structures, for the selector of memberships « de la base » (local- refs) */
  allStructures?: Structure[];
  onUpdateField: (field: keyof Structure, value: any) => void;
}

type Kind = 'inclusion' | 'participation';

const SUPERVISION_CODES: SupervisionCode[] = ['main_supervision', 'associated_supervision', 'participating_supervision'];

const selectCls = 'input-soft';
const dateCls = 'input-soft text-[13px]';
const textCls = 'input-soft font-mono';
const addBtnCls =
  'w-10 h-10 shrink-0 rounded-full bg-accent border border-accent-strong text-ink hover:bg-accent-strong transition-colors flex items-center justify-center';
const labelCls = 'block text-[11px] font-semibold text-muted-light dark:text-[#8f897c] mb-1';

/** Input of an external institution by UAI or ROR code. */
const AddExternal: React.FC<{ onAdd: (m: Membership) => void }> = ({ onAdd }) => {
  const { t } = useLingui();
  const [uai, setUai] = React.useState('');
  const [ror, setRor] = React.useState('');
  const pushUai = () => { const v = uai.trim(); if (v) { onAdd({ refType: 'uai', ref: v, supervision: '', startDate: '', endDate: '' }); setUai(''); } };
  const pushRor = () => { const v = ror.trim(); if (v) { onAdd({ refType: 'ror', ref: v, supervision: '', startDate: '', endDate: '' }); setRor(''); } };
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className={labelCls}><Trans>Add by UAI code (external institution)</Trans></label>
        <div className="flex items-center gap-2">
          <input value={uai} onChange={(e) => setUai(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pushUai()} placeholder={t`e.g. 0753639Y`} className={textCls} />
          <button type="button" onClick={pushUai} title={t`Add this UAI institution`} className={addBtnCls}><Plus className="w-4 h-4" /></button>
        </div>
      </div>
      <div>
        <label className={labelCls}><Trans>Add by ROR identifier (external institution)</Trans></label>
        <div className="flex items-center gap-2">
          <input value={ror} onChange={(e) => setRor(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pushRor()} placeholder={t`e.g. 05hz99a17`} className={textCls} />
          <button type="button" onClick={pushRor} title={t`Add this ROR institution`} className={addBtnCls}><Plus className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
};

export const GovernanceTab: React.FC<GovernanceTabProps> = ({ structure, allStructures = [], onUpdateField }) => {
  const { t } = useLingui();
  const levelLabel = (lvl: unknown): string => { const m = LEVEL_LABELS[String(lvl)]; return m ? t(m) : ''; };
  const inclusions = structure.inclusions || [];
  const participations = structure.participations || [];
  const level = String(structure.level);

  const byLid = new Map(allStructures.filter((s) => s.localId).map((s) => [String(s.localId), s]));

  /**
   * Allowed target structure levels depending on the current structure's level
   * and the membership type (see CRISalid model):
   *  - institutions (4)            : included in / participate in institutions
   *  - intermediate (3) / units (2) : in institutions or intermediate structures
   *  - teams (1)                   : included in units (no participation)
   */
  const allowedLevels = (kind: Kind): string[] => {
    if (level === '4') return ['4'];
    if (level === '3' || level === '2') return ['4', '3'];
    if (level === '1') return kind === 'inclusion' ? ['2'] : [];
    return ['4', '3'];
  };
  // External institutions (UAI/ROR) are only offered if level 4 is a valid target.
  const externalAllowed = (kind: Kind) => allowedLevels(kind).includes('4');

  const labelFor = (m: Membership): string => {
    if (m.refType === 'uai') return getTutelleName(m.ref);
    if (m.refType === 'ror') return `ROR ${m.ref}`;
    const s = byLid.get(String(m.ref));
    return s ? (s.acronym || s.officialName || `local-${m.ref}`) : `local-${m.ref}`;
  };
  const subLabelFor = (m: Membership): string => {
    if (m.refType === 'uai') return `UAI ${m.ref}`;
    if (m.refType === 'ror') return `ror-${m.ref}`;
    const s = byLid.get(String(m.ref));
    if (!s) return `local-${m.ref}`;
    const lvl = levelLabel(s.level);
    return `${lvl}${s.type ? ` · ${s.type}` : ''} · local-${m.ref}`;
  };

  const fieldOf = (kind: Kind): keyof Structure => (kind === 'inclusion' ? 'inclusions' : 'participations');
  const listOf = (kind: Kind): Membership[] => (kind === 'inclusion' ? inclusions : participations);
  const commit = (kind: Kind, list: Membership[]) => onUpdateField(fieldOf(kind), list);
  const patchEntry = (kind: Kind, idx: number, patch: Partial<Membership>) => {
    const l = [...listOf(kind)];
    l[idx] = { ...l[idx], ...patch };
    commit(kind, l);
  };
  const removeEntry = (kind: Kind, idx: number) => {
    const l = [...listOf(kind)];
    l.splice(idx, 1);
    commit(kind, l);
  };
  const keyOf = (m: Membership) => `${m.refType}:${String(m.ref).toLowerCase()}`;
  const addEntry = (kind: Kind, m: Membership) => {
    if (!m.ref) return;
    const l = listOf(kind);
    if (l.some((x) => keyOf(x) === keyOf(m))) return;
    commit(kind, [...l, m]);
  };

  const localOptions = (kind: Kind): Structure[] => {
    const levels = new Set(allowedLevels(kind));
    const existing = new Set(listOf(kind).filter((m) => m.refType === 'local').map((m) => String(m.ref)));
    return allStructures
      .filter((s) => s.localId && String(s.localId) !== String(structure.localId)
        && levels.has(String(s.level)) && !existing.has(String(s.localId)))
      .sort((a, b) => (a.acronym || '').localeCompare(b.acronym || ''));
  };

  const renderEntry = (kind: Kind, m: Membership, idx: number) => {
    const isMain = m.supervision === 'main_supervision';
    return (
      <div key={`${keyOf(m)}-${idx}`} className="rounded-card bg-white/80 dark:bg-white/5 border border-ink/5 dark:border-white/10 shadow-soft overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-ink/5 dark:border-white/5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-muted dark:text-[#8f897c] uppercase">{m.refType}</span>
              <span className="font-disp text-[14px] font-semibold text-ink dark:text-[#f5f2ea] truncate">{labelFor(m)}</span>
              {isMain && (
                <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-accent/30 dark:bg-accent/20 text-ink dark:text-accent text-[11px] font-bold">
                  <Star className="w-3 h-3" /> {t(SUPERVISION_LABELS.main_supervision)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-light dark:text-[#8f897c] mt-0.5 truncate">{subLabelFor(m)}</div>
          </div>
          <button onClick={() => removeEntry(kind, idx)} className="text-muted-faint hover:text-[#d64545] transition-colors shrink-0" title={t`Remove this affiliation`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          {kind === 'participation' && (
            <div>
              <label className={labelCls}><Trans>Participation type</Trans></label>
              <select value={m.supervision || ''} onChange={(e) => patchEntry(kind, idx, { supervision: e.target.value as SupervisionCode | '' })} className="input-soft text-[13px]">
                <option value="">—</option>
                {SUPERVISION_CODES.map((c) => <option key={c} value={c}>{t(SUPERVISION_LABELS[c])}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}><Trans>Start date</Trans></label>
            <input type="date" value={m.startDate || ''} onChange={(e) => patchEntry(kind, idx, { startDate: e.target.value })} className={dateCls} />
          </div>
          <div>
            <label className={labelCls}><Trans>End date</Trans></label>
            <input type="date" value={m.endDate || ''} onChange={(e) => patchEntry(kind, idx, { endDate: e.target.value })} className={dateCls} />
          </div>
        </div>
      </div>
    );
  };

  const renderSection = (kind: Kind, title: string, Icon: typeof Layers, desc: string) => {
    const list = listOf(kind);
    const opts = localOptions(kind);
    const canExternal = externalAllowed(kind);
    const noTargets = opts.length === 0 && !canExternal;
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-ink/10 dark:border-white/10">
          <Icon className="w-5 h-5 text-muted-lighter dark:text-[#8f897c]" />
          <h3 className="section-label">{title}</h3>
          <span className="count-badge h-6 px-2.5 text-xs">{list.length}</span>
        </div>
        <p className="text-[13px] text-muted dark:text-[#8f897c] -mt-2">{desc}</p>

        {list.length === 0 ? (
          <p className="text-[13px] text-muted-light dark:text-[#8f897c] italic">{kind === 'inclusion' ? t`No inclusion.` : t`No participation.`}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{list.map((m, i) => renderEntry(kind, m, i))}</div>
        )}

        <div className="space-y-3 pt-3 border-t border-ink/10 dark:border-white/10">
          {opts.length > 0 && (
            <div className="max-w-md">
              <label className={labelCls}><Trans>Add a structure from the database</Trans></label>
              <select
                value=""
                onChange={(e) => { if (e.target.value) addEntry(kind, { refType: 'local', ref: e.target.value, supervision: '', startDate: '', endDate: '' }); }}
                className={selectCls}
              >
                <option value="">{t`+ Choose a structure…`}</option>
                {opts.map((s) => (
                  <option key={s.localId} value={String(s.localId)}>
                    {(s.acronym || s.localId)}{s.type ? ` — ${s.type}` : ''}{levelLabel(s.level) ? ` (${levelLabel(s.level)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {canExternal && <AddExternal onAdd={(m) => addEntry(kind, m)} />}
          {noTargets && <p className="text-[13px] text-muted-light dark:text-[#8f897c] italic"><Trans>This type of structure does not allow additions here.</Trans></p>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-300">
      {renderSection(
        'inclusion',
        t`Inclusions`,
        Layers,
        t`Strong membership: the structure is included in a parent structure (e.g. team → unit).`,
      )}
      {renderSection(
        'participation',
        t`Participations`,
        Network,
        t`Supervising bodies and broader memberships (e.g. unit → institution / intermediate structure). The “Main supervision” code designates the reference supervising body.`,
      )}
    </div>
  );
};
