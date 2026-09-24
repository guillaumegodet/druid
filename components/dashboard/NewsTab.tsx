import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Megaphone,
  Newspaper,
  Quote,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { copyToClipboard } from '../../lib/clipboard';
import { DashboardDataset } from './types';
import { KpiCard } from './KpiCards';
import { useVizTheme } from './EChartCard';
import { oaLabel } from './labels';
import { NewsletterPanel } from './NewsletterPanel';
import { MediaMentionsPanel } from './MediaMentionsPanel';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { fetchStaticNews } from '../../lib/dashboardSource';

// « Publications » / « Médias » toggle of the « Veille » tab (live OpenAlex monitoring
// on one side, media_watch media mentions on the other).
const NewsModeSwitch: React.FC<{
  mode: 'pubs' | 'medias';
  onChange: (m: 'pubs' | 'medias') => void;
}> = ({ mode, onChange }) => {
  const { t } = useLingui();
  return (
  <div className="flex items-center gap-1 p-1 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft w-fit">
    {(
      [
        ['pubs', t`Publications`],
        ['medias', t`Media`],
      ] as const
    ).map(([k, label]) => (
      <button
        key={k}
        onClick={() => onChange(k)}
        className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
          mode === k
            ? 'bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]'
            : 'text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
  );
};

// Contract of /api/news/:slug (server.cjs) — flattened OpenAlex works, live.
interface NewsItem {
  id: string;
  title: string | null;
  date: string | null;
  link: string | null;
  doi: string | null;
  workType: string | null;
  sourceName: string | null;
  sourceType: string | null;
  issn: string | null;
  isOa: boolean;
  oaStatus: string | null;
  citedByCount: number;
  /** Authors attached to the structure (or to known labs). */
  authors: string[];
  allAuthors: string[];
  authorsTotal: number;
  labs: string[];
  topics: string[];
  subfields: string[];
  keywords: string[];
}

interface NewsPayload {
  slug: string;
  days: number;
  fetchedAt: string;
  total: number;
  truncated: boolean;
  items: NewsItem[];
}

const PAGE_SIZE = 25;
const PERIODS = [7, 14, 30, 60, 90, 180];

const WORK_TYPE_LABELS: Record<string, MessageDescriptor> = {
  article: msg`Article`,
  review: msg`Review article`,
  preprint: msg`Preprint`,
  'book-chapter': msg`Book chapter`,
  book: msg`Book`,
  dataset: msg`Dataset`,
  dissertation: msg`Thesis`,
  editorial: msg`Editorial`,
  erratum: msg`Erratum`,
  letter: msg`Letter`,
  report: msg`Report`,
  'reference-entry': msg`Reference entry`,
  standard: msg`Standard`,
  'peer-review': msg`Peer review`,
  retraction: msg`Retraction`,
  'supplementary-materials': msg`Supplementary materials`,
  paratext: msg`Paratext`,
  other: msg`Other`,
};

/** Displayed/filtered document type: cross of work type × source type
 * (outside the component: `i18n._`, recomputed through the i18n.locale dependency of the memos). */
function docTypeLabel(item: NewsItem): string {
  if (item.sourceType === 'conference') return i18n._(msg`Conference paper`);
  if (item.workType === 'article' && item.sourceType === 'repository') return i18n._(msg`Preprint / repository`);
  if (item.workType === 'article') return i18n._(msg`Journal article`);
  const m = WORK_TYPE_LABELS[item.workType ?? ''];
  return m ? i18n._(m) : item.workType ?? i18n._(msg`Other`);
}

function csvEscape(v: string | number | null | undefined): string {
  const s = (v ?? '').toString();
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(numberLocale());
}

/** Displayed authors: those of the structure, otherwise the first signatories. */
function authorsLabel(item: NewsItem): string {
  if (item.authors.length > 0) return item.authors.join(', ');
  const head = item.allAuthors.slice(0, 3).join(', ');
  return item.authorsTotal > 3 ? `${head} et al.` : head || '—';
}

/** Social media post draft (ported from the research-news prototype). */
function generatePost(item: NewsItem, structName: string): string {
  const authors = authorsLabel(item);
  const labs = item.labs.join(', ');
  const theme = item.topics[0] ?? 'notre domaine';
  let post = '🎉 Félicitations à nos chercheurs pour leur nouvelle publication !\n\n';
  post += `Découvrez les travaux de ${authors} `;
  if (labs) post += `du laboratoire ${labs} `;
  post += `sur le thème : ${theme}.\n\n`;
  post += `Leur article « ${item.title ?? ''} » vient d'être publié dans ${item.sourceName ?? 'une revue'}.\n\n`;
  if (item.link) post += `🔗 Pour le lire, c'est par ici : ${item.link}\n\n`;
  const tags = [`#${structName.replace(/[^\p{L}\p{N}]/gu, '')}`, '#Recherche', '#Innovation'];
  for (const lab of item.labs) tags.push(`#${lab.replace(/[^\p{L}\p{N}]/gu, '')}`);
  return post + tags.join(' ');
}

/** LinkedIn account of an author (resolved server-side from the profile record). */
interface AuthorMention {
  name: string;
  url: string;
  handle: string; // « @vanity »
}

/** Adds a line inviting to tag on LinkedIn the authors who declared
 * an account (LinkedIn column of their record), unless the handle is already
 * there (the LLM may have included it). */
function withLinkedinMentions(text: string, mentions: AuthorMention[]): string {
  const fresh = (mentions || []).filter((m) => m.handle && !text.includes(m.handle));
  if (fresh.length === 0) return text;
  const list = fresh.map((m) => `${m.name} (${m.handle})`).join(', ');
  return `${text.replace(/\s+$/, '')}\n\n👉 Sur LinkedIn, pensez à identifier ${list} pour interagir directement avec l'auteur·rice.`;
}

interface NewsFilters {
  lab?: string;
  subfield?: string;
  q?: string;
  author?: string;
  docType?: string;
  quartile?: string;
  oaOnly?: boolean;
}

const FilterSelect: React.FC<{
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  allLabel?: string;
}> = ({ label, value, options, onChange, allLabel }) => {
  const { t } = useLingui();
  if (options.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
      {label}
      <select
        className="input-soft py-1.5 text-sm font-normal cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allLabel ?? t`All`}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
};

/**
 * « Veille » tab: radar of the structure's recent publications,
 * queried LIVE on OpenAlex (via /api/news/:slug), aimed
 * in particular at communication staff — lab/theme/keyword/author/
 * type/quartile filters, detailed table, CSV export and LinkedIn post draft.
 * SJR quartiles are derived from the structure's ETL corpus (matching
 * by ISSN then by journal name): unseen journals stay « Inconnu ».
 */
export const NewsTab: React.FC<{ dataset: DashboardDataset; slug: string }> = ({
  dataset,
  slug,
}) => {
  const { t: tr, i18n: li } = useLingui();
  const unknownQuartile = tr`Unknown`;
  const [days, setDays] = useState(30);
  const [payload, setPayload] = useState<NewsPayload | null>(null);
  // True when the feed comes from the static export (no /api/news on this instance): no live
  // query, and no newsletter (Grist table + Functions of the Centrale instance only).
  const [staticFeed, setStaticFeed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<NewsFilters>({});
  const [sortBy, setSortBy] = useState<'date' | 'citations'>('date');
  const [page, setPage] = useState(0);
  const [postItem, setPostItem] = useState<NewsItem | null>(null);
  const [postText, setPostText] = useState('');
  const [postCopied, setPostCopied] = useState(false);
  const [postLoading, setPostLoading] = useState(false);
  const postRef = useRef<HTMLDivElement>(null);
  // Monotonic counter, not item.id: « Régénérer » calls openPost() again on the SAME article, so
  // a token based on item.id does not tell two successive calls apart — a slower response
  // to the first click could overwrite the fresher text of the second (review lot 9b).
  const postReqRef = useRef<number>(0);
  // General-public newsletter: ?nlItem=<work_id> = validation link sent to the
  // researcher → the panel opens directly on their news item.
  const nlFocus = useMemo(
    () => new URLSearchParams(window.location.search).get('nlItem'),
    [],
  );
  const [showNewsletter, setShowNewsletter] = useState<boolean>(!!nlFocus);
  const [mode, setMode] = useState<'pubs' | 'medias'>('pubs');
  const t = useVizTheme();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/news/${encodeURIComponent(slug)}?days=${days}`)
      .then(async (res) => {
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        if (res.ok && isJson) return { json: (await res.json()) as NewsPayload, isStatic: false };
        // No live feed for this structure/instance (404, or the SPA page of a static host):
        // fall back to the static export dashboard-data/<slug>/news.json (demo instance).
        if (res.status === 404 || (res.ok && !isJson)) {
          const fallback = await fetchStaticNews<NewsPayload>(slug);
          if (fallback) return { json: fallback, isStatic: true };
        }
        const body = isJson ? await res.json().catch(() => null) : null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      })
      .then(({ json, isStatic }) => {
        if (!cancelled) {
          setPayload(json);
          setStaticFeed(isStatic);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(apiErrorText(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, days]);

  useEffect(() => {
    setFilters({});
    setPostItem(null);
  }, [slug]);
  useEffect(() => {
    setPage(0);
  }, [filters, days, sortBy]);

  // SJR quartile per journal, derived from the already loaded ETL corpus (ISSN first,
  // fallback to the normalized journal name) — OpenAlex does not provide the quartile.
  const quartileLookup = useMemo(() => {
    const byIssn = new Map<string, string>();
    const byJournal = new Map<string, string>();
    for (const p of dataset.publications) {
      if (!p.sjrQuartile) continue;
      if (p.issn && !byIssn.has(p.issn)) byIssn.set(p.issn, p.sjrQuartile);
      const j = p.journal?.trim().toLowerCase();
      if (j && !byJournal.has(j)) byJournal.set(j, p.sjrQuartile);
    }
    return (item: NewsItem): string | null => {
      if (item.issn && byIssn.has(item.issn)) return byIssn.get(item.issn)!;
      const j = item.sourceName?.trim().toLowerCase();
      return (j && byJournal.get(j)) || null;
    };
  }, [dataset.publications]);

  const items = payload?.items ?? [];

  const options = useMemo(() => {
    const labs = new Set<string>();
    const subfields = new Set<string>();
    const authors = new Set<string>();
    const docTypes = new Set<string>();
    const quartiles = new Set<string>();
    for (const it of items) {
      it.labs.forEach((l) => labs.add(l));
      it.subfields.forEach((s) => subfields.add(s));
      it.authors.forEach((a) => authors.add(a));
      docTypes.add(docTypeLabel(it));
      const q = quartileLookup(it);
      if (q) quartiles.add(q);
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, li.locale));
    return {
      labs: sorted(labs),
      subfields: sorted(subfields),
      authors: sorted(authors),
      docTypes: sorted(docTypes),
      quartiles: [...quartiles].sort(),
    };
  }, [items, quartileLookup, li.locale]);

  const rows = useMemo(() => {
    const q = filters.q?.trim().toLowerCase();
    const author = filters.author?.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (filters.lab && !it.labs.includes(filters.lab)) return false;
      if (filters.subfield && !it.subfields.includes(filters.subfield)) return false;
      if (filters.docType && docTypeLabel(it) !== filters.docType) return false;
      if (filters.oaOnly && !it.isOa) return false;
      if (filters.quartile) {
        const quart = quartileLookup(it) ?? unknownQuartile;
        if (quart !== filters.quartile) return false;
      }
      if (author) {
        const inAuthors = [...it.authors, ...it.allAuthors].some((a) =>
          a.toLowerCase().includes(author),
        );
        if (!inAuthors) return false;
      }
      if (q) {
        const haystack = [it.title, it.sourceName, ...it.topics, ...it.keywords]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) =>
      sortBy === 'citations'
        ? b.citedByCount - a.citedByCount || (b.date ?? '').localeCompare(a.date ?? '')
        : (b.date ?? '').localeCompare(a.date ?? '') || b.citedByCount - a.citedByCount,
    );
  }, [items, filters, sortBy, quartileLookup, unknownQuartile, li.locale]);

  const oaCount = rows.filter((r) => r.isOa).length;
  const citations = rows.reduce((s, r) => s + r.citedByCount, 0);
  const activeCount = Object.values(filters).filter((v) => v != null && v !== '' && v !== false).length;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const patch = (p: Partial<NewsFilters>) => setFilters((f) => ({ ...f, ...p }));

  const downloadCsv = () => {
    const header = 'titre,auteurs,labos,journal_ou_conference,type,quartile,thematique,date,citations,open_access,lien';
    const lines = rows.map((it) =>
      [
        csvEscape(it.title),
        csvEscape(authorsLabel(it)),
        csvEscape(it.labs.join(' | ')),
        csvEscape(it.sourceName),
        csvEscape(docTypeLabel(it)),
        quartileLookup(it) ?? '',
        csvEscape(it.topics.slice(0, 3).join(' | ')),
        it.date ?? '',
        it.citedByCount,
        it.isOa ? 'oui' : 'non',
        csvEscape(it.link),
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `veille_${slug}_${days}j.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openPost = (item: NewsItem) => {
    setPostItem(item);
    setPostText('');
    setPostCopied(false);
    setPostLoading(true);
    const reqId = postReqRef.current + 1;
    postReqRef.current = reqId;
    // Post tailored to the article's content via ILAAS (same engine as the news items);
    // fallback to the local template if generation fails.
    fetch('/api/newsletter/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        workId: item.id,
        title: item.title,
        authors: authorsLabel(item),
        authorNames: item.authors, // names of the structure's authors → LinkedIn mentions
        labs: item.labs,
        journal: item.sourceName,
        link: item.link,
        structName: dataset.name || dataset.lab,
        topics: item.topics.slice(0, 3),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (postReqRef.current !== reqId) return; // stale response (another article clicked)
        const base = String(d.post || '').trim() || generatePost(item, dataset.lab);
        setPostText(withLinkedinMentions(base, d.mentions || []));
      })
      .catch(() => {
        if (postReqRef.current === reqId) setPostText(generatePost(item, dataset.lab));
      })
      .finally(() => {
        if (postReqRef.current === reqId) setPostLoading(false);
      });
  };
  const copyPost = () => {
    copyToClipboard(postText).then((ok) => {
      if (!ok) return;
      setPostCopied(true);
      window.setTimeout(() => setPostCopied(false), 1600);
    });
  };
  // Opening the draft → bring the social media assistant into view
  // (it is displayed below the table, often off-screen on long lists).
  useEffect(() => {
    if (postItem) postRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [postItem]);

  if (showNewsletter) {
    return (
      <NewsletterPanel
        slug={slug}
        structName={dataset.name || dataset.lab}
        labo={dataset.lab}
        onClose={() => setShowNewsletter(false)}
        focusWorkId={nlFocus}
      />
    );
  }

  // « Médias » sub-tab: rendered before the loading/error states of the OpenAlex
  // monitoring (the two views load independently).
  if (mode === 'medias') {
    return (
      <div className="flex flex-col gap-4">
        <NewsModeSwitch mode={mode} onChange={setMode} />
        <MediaMentionsPanel slug={slug} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <Trans>Querying OpenAlex…</Trans>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 flex items-start gap-3 text-sm text-muted dark:text-[#c3beb0]">
        <AlertCircle className="w-5 h-5 shrink-0 text-status-external" />
        <div><Trans>The publication watch could not be loaded: {error}</Trans></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <NewsModeSwitch mode={mode} onChange={setMode} />
      {/* Header: period, sort, export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>New publications watch</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Trans>Live OpenAlex data — publications dated within the last {days} days</Trans>
            {payload && <> <Trans>(retrieved on {new Date(payload.fetchedAt).toLocaleString(numberLocale())})</Trans></>}
            {payload?.truncated && <> — <Trans>display limited to the {items.length.toLocaleString(numberLocale())} most recent out of {payload.total.toLocaleString(numberLocale())}</Trans></>}
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            title={tr`Analysis period`}
          >
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {tr`last ${d} days`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-white/60 dark:bg-white/10 border border-white/70 dark:border-white/15">
            {(
              [
                { key: 'date', label: tr`Most recent` },
                { key: 'citations', label: tr`Most cited` },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                className={`pill px-3 py-1 text-xs transition-colors cursor-pointer ${
                  sortBy === key
                    ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                    : 'text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            title={tr`Export as CSV (filtered results)`}
            className="btn-pill px-3 py-1.5 text-[13px]"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          {!staticFeed && (
            <button
              type="button"
              onClick={() => setShowNewsletter(true)}
              title={tr`Compose the public newsletter (generated and validated briefs)`}
              className="btn-pill px-3 py-1.5 text-[13px]"
            >
              <Newspaper className="w-4 h-4" /> <Trans>Newsletter</Trans>
            </button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label={tr`Publications`}
          value={rows.length.toLocaleString(numberLocale())}
          hint={activeCount > 0 ? (activeCount > 1 ? tr`${activeCount} active filters` : tr`1 active filter`) : undefined}
          icon={<FileText className="w-5 h-5" />}
          color={t.series[3]}
        />
        <KpiCard
          label={tr`Open access`}
          value={oaCount.toLocaleString(numberLocale())}
          hint={rows.length > 0 ? tr`${Math.round((oaCount / rows.length) * 100)}% of the result` : undefined}
          icon={<BookOpen className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`Citations (already received)`}
          value={citations.toLocaleString(numberLocale())}
          icon={<Quote className="w-5 h-5" />}
          color={t.series[0]}
        />
      </div>

      {/* Filtres */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <FilterSelect
            label={tr`Lab`}
            value={filters.lab ?? ''}
            options={options.labs}
            onChange={(v) => patch({ lab: v || undefined })}
          />
          <FilterSelect
            label={tr`Topic`}
            value={filters.subfield ?? ''}
            options={options.subfields}
            onChange={(v) => patch({ subfield: v || undefined })}
            allLabel={tr({ message: `All`, context: "feminine" })}
          />
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
            <Trans>Keywords</Trans>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
              <input
                className="input-soft !pl-8 py-1.5 text-sm font-normal w-full"
                placeholder={tr`robot, energy…`}
                value={filters.q ?? ''}
                onChange={(e) => patch({ q: e.target.value || undefined })}
              />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
            <Trans>Author</Trans>
            <input
              className="input-soft py-1.5 text-sm font-normal"
              list="news-authors"
              placeholder={tr`All`}
              value={filters.author ?? ''}
              onChange={(e) => patch({ author: e.target.value || undefined })}
            />
            <datalist id="news-authors">
              {options.authors.slice(0, 400).map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <FilterSelect
            label={tr`Type`}
            value={filters.docType ?? ''}
            options={options.docTypes}
            onChange={(v) => patch({ docType: v || undefined })}
          />
          <FilterSelect
            label={tr`Journal type (quartile)`}
            value={filters.quartile ?? ''}
            options={[...options.quartiles, unknownQuartile]}
            onChange={(v) => patch({ quartile: v || undefined })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
          <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-current w-3.5 h-3.5"
              checked={!!filters.oaOnly}
              onChange={(e) => patch({ oaOnly: e.target.checked || undefined })}
            />
            <Trans>Open access publications only</Trans>
          </label>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="text-xs text-muted-light dark:text-[#8f897c] hover:underline cursor-pointer"
            >
              <Trans>Clear all</Trans>
            </button>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="glass-card flex flex-col">
        <div className="overflow-x-auto px-2 pb-2 pt-2">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                <th className="px-3 py-2"><Trans>Title</Trans></th>
                <th className="px-3 py-2 w-48"><Trans>Authors</Trans></th>
                <th className="px-3 py-2 w-28"><Trans>Lab</Trans></th>
                <th className="px-3 py-2 w-52"><Trans>Journal / conference</Trans></th>
                <th className="px-3 py-2 w-44"><Trans>Topic</Trans></th>
                <th className="px-3 py-2 w-24"><Trans>Date</Trans></th>
                <th className="px-3 py-2 w-16 text-right"><Trans>Cit.</Trans></th>
                <th className="px-3 py-2 w-24">OA</th>
                <th className="px-3 py-2 w-20 text-center"><Trans>Link</Trans></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((it) => {
                const quart = quartileLookup(it);
                return (
                  <tr key={it.id} className="border-t border-ink/5 dark:border-white/5 align-top">
                    <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                      {it.title ?? tr`(untitled)`}
                      <span className="block text-[11px] text-muted-light dark:text-[#8f897c] mt-0.5">
                        {docTypeLabel(it)}
                        {quart && ` · ${quart}`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{authorsLabel(it)}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">
                      {it.labs.length > 0 ? it.labs.join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{it.sourceName ?? '—'}</td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{it.topics[0] ?? '—'}</td>
                    <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea] whitespace-nowrap">
                      {formatDate(it.date)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">
                      {it.citedByCount.toLocaleString(numberLocale())}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-semibold"
                        style={{ color: it.isOa ? t.series[2] : t.series[7] }}
                        title={it.oaStatus ? oaLabel(it.oaStatus) : undefined}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: it.isOa ? t.series[2] : t.series[7] }}
                        />
                        {it.isOa ? tr`Open` : tr`Closed`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {it.link && (
                        <a
                          href={it.link}
                          target="_blank"
                          rel="noreferrer"
                          title={tr`Open the publication`}
                          className="inline-flex p-1.5 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openPost(it)}
                        title={tr`Generate a LinkedIn / X post draft`}
                        className="inline-flex p-1.5 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <Megaphone className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted dark:text-[#c3beb0]">
                    <Trans>No publication over this period with these filters.</Trans>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
            <button
              type="button"
              className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ← <Trans>Previous</Trans>
            </button>
            <span>
              <Trans>Page {currentPage + 1} / {pageCount}</Trans>
            </span>
            <button
              type="button"
              className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <Trans>Next</Trans> →
            </button>
          </div>
        )}
      </div>

      {/* Social media assistant */}
      {postItem && (
        <div ref={postRef} className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
                <Megaphone className="w-4 h-4" /> <Trans>Social media assistant</Trans>
                {postLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-light dark:text-[#8f897c]" />}
              </h4>
              <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
                <Trans>LinkedIn / X post draft for “{postItem.title}”</Trans> —{' '}
                {postLoading ? tr`generating…` : tr`tailored to the article's content, editable before copying.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPostItem(null)}
              title={tr`Close`}
              className="p-1.5 rounded-lg text-muted-light dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] hover:bg-ink/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            className="input-soft w-full font-normal text-sm leading-relaxed min-h-[200px] resize-y"
            value={postText}
            placeholder={postLoading ? tr`Writing the post from the article's abstract…` : ''}
            disabled={postLoading}
            onChange={(e) => setPostText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyPost}
              disabled={postLoading || !postText}
              className="btn-pill px-3 py-1.5 text-[13px] disabled:opacity-50"
            >
              {postCopied ? <Check className="w-4 h-4 text-pixel-teal" /> : <Copy className="w-4 h-4" />}
              {postCopied ? tr`Copied!` : tr`Copy the text`}
            </button>
            <button
              type="button"
              onClick={() => openPost(postItem)}
              disabled={postLoading}
              className="btn-pill px-3 py-1.5 text-[13px] disabled:opacity-50"
              title={tr`Generate another proposal`}
            >
              <RefreshCw className={`w-4 h-4 ${postLoading ? 'animate-spin' : ''}`} /> <Trans>Regenerate</Trans>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
