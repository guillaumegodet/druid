import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { YearRange } from './overviewAggregates';
import { LARGE_COLLAB_MAX_AUTHORS } from './interLabNetwork';
import { AuthorCell } from './PairsSection';
import {
  PairRelation,
  PairSuggestion,
  SuggestionSignal,
  SuggestionsParams,
  SuggestionsResponse,
  fetchSuggestions,
} from './pairsApi';
import { numberLocale } from '../../lib/i18n';
import { toCsv } from '../../lib/chartExport';
import { downloadBlob } from './chartFileExport';
import { helpUrl } from '../../lib/helpLinks';

const PAGE = 50;

/** Why a pair is suggested: its common co-authors, then its shared subfields. */
const ReasonCell: React.FC<{ s: PairSuggestion }> = ({ s }) => {
  const { i18n } = useLingui();
  const others = s.common - s.via.length;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted dark:text-[#c3beb0]">
      {s.common > 0 && (
        <span>
          <span className="font-semibold text-ink dark:text-[#f5f2ea]">
            <Plural value={s.common} one="# common co-author:" other="# common co-authors:" />
          </span>
          {' '}
          {s.via.map((v) => `${v.label}${v.labs.length ? ` (${v.labs.join(', ')})` : ''}`).join(', ')}
          {others > 0 && <> <Trans>and {others} more</Trans></>}
        </span>
      )}
      {s.subfields.length > 0 && (
        <span>
          <span className="font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Shared subfields:</Trans></span>
          {' '}
          {s.subfields.join(', ')}
          {' · '}
          <Trans>closeness {s.similarity.toLocaleString(i18n.locale, { minimumFractionDigits: 2 })}</Trans>
        </span>
      )}
    </div>
  );
};

/**
 * « Suggested connections » of the Researcher pairs sub-tab (druid-internal `docs/plan-binomes-chercheurs.md`,
 * lot 3): researchers of different labs who never co-signed, ranked by their common co-authors and their OpenAlex
 * subfields over the period, each row saying why.
 */
export const PairSuggestionsSection: React.FC<{ slug: string; range: YearRange }> = ({ slug, range }) => {
  const { t, i18n } = useLingui();
  const [relation, setRelation] = useState<PairRelation>('lab');
  const [scope, setScope] = useState<SuggestionsParams['scope']>('all');
  const [membership, setMembership] = useState<SuggestionsParams['membership']>('all');
  const [includePhd, setIncludePhd] = useState(false);
  const [excludeLarge, setExcludeLarge] = useState(true);
  const [signal, setSignal] = useState<SuggestionSignal>('combined');
  const [quota, setQuota] = useState(5);
  const [shown, setShown] = useState(PAGE);

  const [data, setData] = useState<SuggestionsResponse | 'none' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const params = useMemo<SuggestionsParams>(
    () => ({ range, relation, scope, membership, includePhd, excludeLarge, signal, quota }),
    [range, relation, scope, membership, includePhd, excludeLarge, signal, quota],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchSuggestions(slug, params, ctrl.signal)
      .then((r) => { setData(r ?? 'none'); setLoading(false); })
      .catch(() => { if (!ctrl.signal.aborted) { setData('error'); setLoading(false); } });
    return () => ctrl.abort();
  }, [slug, params]);
  useEffect(() => { setShown(PAGE); }, [data]);

  const loaded = data && typeof data === 'object' ? data : null;
  const poleCouples = useMemo(() => {
    const poles = loaded?.poles ?? [];
    const out: { value: PairRelation; label: string }[] = [];
    poles.forEach((p, i) => poles.slice(i).forEach((q) => {
      out.push({ value: `${p.acronym}|${q.acronym}`, label: `${p.acronym} × ${q.acronym}` });
    }));
    return out;
  }, [loaded?.poles]);

  if (data === 'none') {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>This structure is not part of the university co-authorship network.</Trans>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString(numberLocale());
  const select = 'input-soft !w-auto py-1 pr-7 text-xs cursor-pointer';
  const check = 'inline-flex items-center gap-1.5 cursor-pointer';
  const rows = loaded?.suggestions ?? [];

  const downloadCsv = () => {
    const csv = toCsv({
      name: 'rapprochements',
      columns: [
        'researcher_1', 'labs_1', 'poles_1', 'researcher_2', 'labs_2', 'poles_2',
        'score', 'common_coauthors', 'named_coauthors', 'closeness', 'shared_subfields',
      ],
      rows: rows.map((s) => [
        s.a.label, s.a.labs.join('|'), s.a.poles.join('|'), s.b.label, s.b.labs.join('|'), s.b.poles.join('|'),
        s.score, s.common, s.via.map((v) => v.label).join('|'), s.similarity, s.subfields.join('|'),
      ]),
    });
    downloadBlob(new Blob([`﻿${csv}\r\n`], { type: 'text/csv;charset=utf-8' }),
      `rapprochements-${slug}-${range.start}-${range.end}.csv`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 flex flex-col gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={relation} onChange={(e) => setRelation(e.target.value as PairRelation)} title={t`Which pairs`}>
            <option value="lab">{t`Researchers of different labs`}</option>
            {poleCouples.length > 0 && <option value="pole">{t`Researchers of different poles`}</option>}
            {poleCouples.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {loaded?.structureLabs && (
            <select className={select} value={scope} onChange={(e) => setScope(e.target.value as SuggestionsParams['scope'])} title={t`Scope`}>
              <option value="all">{t`At least one researcher of the structure`}</option>
              <option value="structure">{t`Both researchers in the structure`}</option>
            </select>
          )}
          <select className={select} value={membership} onChange={(e) => setMembership(e.target.value as SuggestionsParams['membership'])} title={t`Lab membership of the researchers`}>
            <option value="all">{t`Every lab attribution`}</option>
            <option value="associates">{t`Labs of the directory (members and associates)`}</option>
            <option value="members">{t`Labs of the directory (members only)`}</option>
          </select>
          <select className={select} value={signal} onChange={(e) => setSignal(e.target.value as SuggestionSignal)} title={t`Ranking`}>
            <option value="combined">{t`Common co-authors and subfields`}</option>
            <option value="triadic">{t`Common co-authors only`}</option>
            <option value="topics">{t`Shared subfields only`}</option>
          </select>
          <select className={select} value={quota} onChange={(e) => setQuota(Number(e.target.value))} title={t`Suggestions per researcher at most`}>
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>{t`≤ ${n} per researcher`}</option>
            ))}
          </select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" aria-label={t`Loading`} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted dark:text-[#c3beb0]">
          <label className={check}>
            <input type="checkbox" checked={includePhd} onChange={(e) => setIncludePhd(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Suggest PhD students</Trans>
          </label>
          <label className={check}>
            <input type="checkbox" checked={excludeLarge} onChange={(e) => setExcludeLarge(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Exclude large collaborations (more than {LARGE_COLLAB_MAX_AUTHORS} authors)</Trans>
          </label>
        </div>
      </div>

      {data === 'error' && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>The suggested connections could not be loaded.</Trans>
        </div>
      )}
      {data === null && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>Loading the university network…</Trans>
        </div>
      )}

      {loaded && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <Plural value={loaded.total} one="# suggested connection" other="# suggested connections" />
            </p>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={downloadCsv}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> <Trans>Suggestions (CSV)</Trans>
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>No suggested connection matches these filters over the period.</Trans>
            </div>
          ) : (
            <div className="glass-card overflow-x-auto px-2 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2"><Trans>Why</Trans></th>
                    <th className="px-3 py-2 text-right" title={t`2 × common co-authors (Adamic-Adar) + closeness of the subfields`}><Trans>Score</Trans></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((s) => (
                    <tr key={`${s.a.id}-${s.b.id}`} className="border-t border-ink/5 dark:border-white/5 align-top">
                      <td className="px-3 py-2"><AuthorCell author={s.a} /></td>
                      <td className="px-3 py-2"><AuthorCell author={s.b} /></td>
                      <td className="px-3 py-2"><ReasonCell s={s} /></td>
                      <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">{s.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && (
                <div className="flex justify-center py-2">
                  <button type="button" onClick={() => setShown(shown + PAGE)} className="text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer">
                    <Trans>Show more ({fmt(rows.length - shown)} remaining)</Trans>
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-light dark:text-[#8f897c] leading-relaxed px-1">
            <Trans>
              Researchers of different labs who have not co-signed any publication, ranked by their common co-authors
              and the closeness of their OpenAlex subfields over the period. These are leads, not predictions: tested
              on 2020-2022, about one in six of the 100 first suggestions led to a joint publication in 2023-2026
              (one in fifteen between poles). A researcher who left is still suggested until the network is
              regenerated.
            </Trans>
            {loaded.restricted && (
              <> <Trans>Only the suggestions involving a researcher of your lab are shown.</Trans></>
            )}{' '}
            <a href={helpUrl('/guides/tableau-de-bord/binomes/', i18n.locale)} target="_blank" rel="noreferrer" className="underline hover:text-ink dark:hover:text-[#f5f2ea]">
              <Trans>How to read this view</Trans>
            </a>
          </p>
        </>
      )}
    </div>
  );
};
