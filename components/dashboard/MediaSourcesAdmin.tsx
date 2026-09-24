import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Rss,
  Send,
  Trash2,
} from 'lucide-react';
import { TYPE_LABELS, mediaTypeLabel } from './mediaTypes';
import { Trans, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { apiErrorText } from '../../lib/apiErrors';

// « Sources » admin page (« Veille > Médias > Sources », media_admin or admin
// role — cf. lib/auth.canAdminMediaSources). Relayed by server.cjs to
// druid-etl-api /api/media-sources and /api/media-mentions/manual
// (group_api.py, lot 2 of the plan). No feed editing: delete and
// recreate (scoping decision).

interface SourceHealth {
  collector: string;
  last_run: string;
  last_status: string;
  last_count: number;
  consecutive_empty: number;
}
interface MediaSource {
  id: string;
  name: string;
  url: string;
  media_type: string;
  structure?: string | null;
  institution?: boolean;
  require_match?: boolean;
  readonly?: boolean;
  added_by?: string;
  added_at?: string;
  health?: SourceHealth | null;
}
interface SourcesPayload {
  sources: MediaSource[];
  collectors: SourceHealth[];
}

const MEDIA_TYPE_OPTIONS = Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[];

// Outside the component: i18n._ (the calling component re-renders on language change).
function healthDot(health?: SourceHealth | null) {
  if (!health || !health.last_run) {
    return { color: 'bg-muted-lighter dark:bg-[#8f897c]', title: i18n._(msg`Never collected`) };
  }
  const status = health.last_status;
  const empty = health.consecutive_empty;
  if (health.last_status === 'erreur' || health.consecutive_empty >= 3) {
    return { color: 'bg-[#d64545]', title: i18n._(msg`Down — ${status}, ${empty} empty run(s)`) };
  }
  if (health.consecutive_empty >= 1) {
    return { color: 'bg-pixel-amber', title: i18n._(msg`Watch — ${empty} empty run(s) in a row`) };
  }
  const last = health.last_run.slice(0, 16).replace('T', ' ');
  return { color: 'bg-emerald-500', title: i18n._(msg`OK — last collection ${last}`) };
}

function scopeLabel(s: MediaSource) {
  if (s.institution) return i18n._(msg`Institution`);
  if (s.structure) return s.structure;
  return s.require_match ? i18n._(msg`Generic (keyword-filtered)`) : i18n._(msg`Generic`);
}

const emptyFeedForm = {
  name: '', url: '', media_type: 'presse', structure: '', institution: false, require_match: true,
};

const emptyMentionForm = {
  url: '', title: '', media_name: '', media_type: 'presse', published_at: '',
  excerpt: '', structures: '', institution: false,
};

export const MediaSourcesAdmin: React.FC = () => {
  const { t } = useLingui();
  const [data, setData] = useState<SourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [feedForm, setFeedForm] = useState(emptyFeedForm);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedOk, setFeedOk] = useState<string | null>(null);

  const [mentionForm, setMentionForm] = useState(emptyMentionForm);
  const [mentionBusy, setMentionBusy] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionOk, setMentionOk] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/media-sources')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SourcesPayload) => setData(d))
      .catch((e: Error) => setError(apiErrorText(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const submitFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedBusy(true);
    setFeedError(null);
    setFeedOk(null);
    try {
      const r = await fetch('/api/media-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...feedForm,
          structure: feedForm.structure.trim().toUpperCase() || undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setFeedForm(emptyFeedForm);
      setFeedOk(t`Feed “${body.name}” added and checked.`);
      load();
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedBusy(false);
    }
  };

  const deleteSource = async (id: string) => {
    try {
      const r = await fetch(`/api/media-sources/${id}`, { method: 'DELETE' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitMention = async (e: React.FormEvent) => {
    e.preventDefault();
    setMentionBusy(true);
    setMentionError(null);
    setMentionOk(null);
    const structures = mentionForm.structures
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!structures.length && !mentionForm.institution) {
      setMentionError(t`Enter at least one lab (comma-separated acronyms) or tick Institution.`);
      setMentionBusy(false);
      return;
    }
    try {
      const r = await fetch('/api/media-mentions/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mentionForm, structures }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setMentionForm(emptyMentionForm);
      setMentionOk(t`Mention published — visible in the “Mentions” tab.`);
    } catch (e) {
      setMentionError((e as Error).message);
    } finally {
      setMentionBusy(false);
    }
  };

  const inputCls = 'input-soft py-1.5 text-sm font-normal w-full';
  const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]';

  return (
    <div className="flex flex-col gap-6">
      {/* ── Source list ───────────────────────────────────────────────── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Rss className="w-4 h-4" /> <Trans>Harvested sources ({data?.sources.length ?? '…'})</Trans>
          </h4>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> <Trans>Refresh</Trans>
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-[#b23b3b] dark:text-[#f08c8c]">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0] py-6 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading sources…</Trans>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-muted dark:text-[#c3beb0] border-b border-white/60 dark:border-white/10">
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Health</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Name</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Type</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Scope</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.sources ?? []).map((s) => {
                  const dot = healthDot(s.health);
                  return (
                    <tr key={s.id} className="border-b border-white/40 dark:border-white/5 last:border-0">
                      <td className="py-1.5 pr-3">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-full ${dot.color}`}
                          title={dot.title}
                        />
                      </td>
                      <td className="py-1.5 pr-3 font-medium text-ink dark:text-[#f5f2ea] max-w-[220px] truncate" title={s.url}>
                        {s.name}
                      </td>
                      <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">
                        {mediaTypeLabel(s.media_type)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">{scopeLabel(s)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {s.readonly ? (
                          <span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[10px] font-semibold text-muted dark:text-[#c3beb0]">
                            <Trans>built-in</Trans>
                          </span>
                        ) : confirmDelete === s.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => deleteSource(s.id)}
                              className="text-[11px] font-semibold text-[#b23b3b] dark:text-[#f08c8c] hover:underline"
                            >
                              <Trans>Confirm</Trans>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="text-[11px] text-muted dark:text-[#c3beb0] hover:underline"
                            >
                              <Trans>undo</Trans>
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(s.id)}
                            className="text-muted dark:text-[#c3beb0] hover:text-[#b23b3b] dark:hover:text-[#f08c8c]"
                            title={t`Delete this feed`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Add an RSS feed ──────────────────────────────────────────── */}
        <form onSubmit={submitFeed} className="glass-card p-4 flex flex-col gap-3">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
            <Trans>Add an RSS feed</Trans>
          </h4>
          <label className={labelCls}>
            <Trans>Name</Trans>
            <input
              className={inputCls}
              required
              value={feedForm.name}
              onChange={(e) => setFeedForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            <Trans>Feed URL (RSS/Atom)</Trans>
            <input
              type="url"
              className={inputCls}
              required
              placeholder="https://…/feed"
              value={feedForm.url}
              onChange={(e) => setFeedForm((f) => ({ ...f, url: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            <Trans>Media type</Trans>
            <select
              className={inputCls}
              value={feedForm.media_type}
              onChange={(e) => setFeedForm((f) => ({ ...f, media_type: e.target.value }))}
            >
              {MEDIA_TYPE_OPTIONS.map((k) => (
                <option key={k} value={k}>{`${k} — ${mediaTypeLabel(k)}`}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            <Trans>Lab acronym (leave empty if generic or institution)</Trans>
            <input
              className={inputCls}
              placeholder={t`e.g. CAPHI`}
              value={feedForm.structure}
              onChange={(e) => setFeedForm((f) => ({ ...f, structure: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink dark:text-[#f5f2ea]">
            <input
              type="checkbox"
              checked={feedForm.institution}
              onChange={(e) => setFeedForm((f) => ({ ...f, institution: e.target.checked }))}
            />
            <Trans>Institution's own feed (auto-validated, no filtering)</Trans>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink dark:text-[#f5f2ea]">
            <input
              type="checkbox"
              checked={feedForm.require_match}
              onChange={(e) => setFeedForm((f) => ({ ...f, require_match: e.target.checked }))}
            />
            <Trans>General media — only keep articles mentioning a lab/the university</Trans>
          </label>
          {feedError && (
            <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {feedError}
            </div>
          )}
          {feedOk && (
            <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {feedOk}
            </div>
          )}
          <button
            type="submit"
            disabled={feedBusy}
            className="self-start inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50"
          >
            {feedBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <Trans>Test and add</Trans>
          </button>
        </form>

        {/* ── Add a news item from a URL ───────────────────────────────── */}
        <form onSubmit={submitMention} className="glass-card p-4 flex flex-col gap-3">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
            <Trans>Add a news item from a URL</Trans>
          </h4>
          <p className="text-[11px] text-muted dark:text-[#c3beb0] -mt-1">
            <Trans>100% manual entry (no automatic detection) — published immediately.</Trans>
          </p>
          <label className={labelCls}>
            <Trans>Article URL</Trans>
            <input
              type="url"
              className={inputCls}
              required
              placeholder="https://…"
              value={mentionForm.url}
              onChange={(e) => setMentionForm((f) => ({ ...f, url: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            <Trans>Title</Trans>
            <input
              className={inputCls}
              required
              value={mentionForm.title}
              onChange={(e) => setMentionForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              <Trans>Media outlet</Trans>
              <input
                className={inputCls}
                required
                value={mentionForm.media_name}
                onChange={(e) => setMentionForm((f) => ({ ...f, media_name: e.target.value }))}
              />
            </label>
            <label className={labelCls}>
              <Trans>Media type</Trans>
              <select
                className={inputCls}
                value={mentionForm.media_type}
                onChange={(e) => setMentionForm((f) => ({ ...f, media_type: e.target.value }))}
              >
                {MEDIA_TYPE_OPTIONS.map((k) => (
                  <option key={k} value={k}>{`${k} — ${mediaTypeLabel(k)}`}</option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelCls}>
            <Trans>Publication date</Trans>
            <input
              type="date"
              className={inputCls}
              value={mentionForm.published_at}
              onChange={(e) => setMentionForm((f) => ({ ...f, published_at: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            <Trans>Excerpt (optional, 500 characters max)</Trans>
            <textarea
              className={`${inputCls} h-16 resize-none`}
              maxLength={500}
              value={mentionForm.excerpt}
              onChange={(e) => setMentionForm((f) => ({ ...f, excerpt: e.target.value }))}
            />
          </label>
          <label className={labelCls}>
            <Trans>Labs concerned (comma-separated acronyms)</Trans>
            <input
              className={inputCls}
              placeholder={t`e.g. CAPHI, LS2N`}
              value={mentionForm.structures}
              onChange={(e) => setMentionForm((f) => ({ ...f, structures: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink dark:text-[#f5f2ea]">
            <input
              type="checkbox"
              checked={mentionForm.institution}
              onChange={(e) => setMentionForm((f) => ({ ...f, institution: e.target.checked }))}
            />
            <Trans>Concerns the institution (Nantes Université)</Trans>
          </label>
          {mentionError && (
            <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {mentionError}
            </div>
          )}
          {mentionOk && (
            <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {mentionOk}
            </div>
          )}
          <button
            type="submit"
            disabled={mentionBusy}
            className="self-start inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50"
          >
            {mentionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <Trans>Publish</Trans>
          </button>
        </form>
      </div>
    </div>
  );
};
