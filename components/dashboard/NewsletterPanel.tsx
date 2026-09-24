import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Download, Eye, Mail, RefreshCw, RotateCcw,
  Save, Sparkles, Users, XCircle,
} from 'lucide-react';
import { renderNewsletter } from './newsletterTemplate';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { apiErrorText } from '../../lib/apiErrors';

// Editorial workflow of the general-public newsletter: news items are generated
// by /api/newsletter/generate (ILAAS LLM, OpenAlex articles ≤ 30 days) and
// stored in the Grist `Newsletter` table. Each item is proofread by the
// associated researcher (request by email with a direct link, validation on
// this page behind the Keycloak SSO), then the editor composes and exports the
// newsletter (phase 1: HTML export + recipients to paste into the mailing
// mail institutionnel).

const GRIST = '/api/grist';
const DOC = import.meta.env.VITE_GRIST_DOC_ID;

type Statut = 'genere' | 'envoye' | 'valide' | 'rejete' | 'publie';

interface NlItem {
  id: number;
  work_id: string;
  numero: string;
  titre: string;
  doi: string;
  date_publication: string;
  journal: string;
  auteurs: string;
  labs: string;
  accroche: string;
  resume: string;
  statut: Statut;
  chercheur_nom: string;
  chercheur_email: string;
  chercheur_photo: string;
  chercheur_url: string;
  valide_par: string;
}

const STATUT_META: Record<Statut, { label: MessageDescriptor; cls: string }> = {
  genere: { label: msg`Generated`, cls: 'bg-white/70 dark:bg-white/10 text-muted dark:text-[#c3beb0]' },
  envoye: { label: msg`Under review`, cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300' },
  valide: { label: msg`Validated`, cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300' },
  rejete: { label: msg`Discarded`, cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300' },
  publie: { label: msg`Published`, cls: 'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300' },
};

async function gristFetch(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${GRIST}/docs/${DOC}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`Grist ${r.status}`);
  return r.json();
}

export const NewsletterPanel: React.FC<{
  slug: string;
  structName: string;
  /** Lab acronym (LABO column of the Annuaire) — scope of the
   * recipients. Empty for an aggregate (institution/pole). */
  labo?: string;
  onClose: () => void;
  /** work_id to highlight (validation link sent to the researcher). */
  focusWorkId?: string | null;
}> = ({ slug, structName, labo, onClose, focusWorkId }) => {
  const { t } = useLingui();
  const [items, setItems] = useState<NlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [numero, setNumero] = useState<string>('');
  const [generating, setGenerating] = useState<{ done: number; remaining: number } | null>(null);
  const [chars, setChars] = useState(300);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [me, setMe] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const focusRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await gristFetch(
        `tables/Newsletter/records?filter=${encodeURIComponent(JSON.stringify({ slug: [slug] }))}`,
      );
      const rows: NlItem[] = (data.records || []).map((r: any) => ({
        id: r.id,
        work_id: String(r.fields.work_id || ''),
        numero: String(r.fields.numero || ''),
        titre: String(r.fields.titre || ''),
        doi: String(r.fields.doi || ''),
        date_publication: String(r.fields.date_publication || ''),
        journal: String(r.fields.journal || ''),
        auteurs: String(r.fields.auteurs || ''),
        labs: String(r.fields.labs || ''),
        accroche: String(r.fields.accroche || ''),
        resume: String(r.fields.resume || ''),
        statut: (String(r.fields.statut || 'genere') as Statut),
        chercheur_nom: String(r.fields.chercheur_nom || ''),
        chercheur_email: String(r.fields.chercheur_email || ''),
        chercheur_photo: String(r.fields.chercheur_photo || ''),
        chercheur_url: String(r.fields.chercheur_url || ''),
        valide_par: String(r.fields.valide_par || ''),
      }));
      rows.sort((a, b) => (b.date_publication || '').localeCompare(a.date_publication || ''));
      setItems(rows);
      setError('');
      setNumero((cur) => {
        if (cur) return cur;
        const focus = focusWorkId && rows.find((r) => r.work_id === focusWorkId);
        if (focus) return focus.numero;
        const numeros = [...new Set(rows.map((r) => r.numero).filter(Boolean))].sort();
        return numeros[numeros.length - 1] || new Date().toISOString().slice(0, 7);
      });
    } catch (e: any) {
      setError(apiErrorText(e) || t`Could not load`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [slug]);
  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((u) => setMe(u?.email || u?.preferred_username || u?.name || ''));
  }, []);
  useEffect(() => {
    if (!loading && focusWorkId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [loading, focusWorkId]);

  const numeros = useMemo(() => {
    const s = new Set(items.map((i) => i.numero).filter(Boolean));
    s.add(new Date().toISOString().slice(0, 7));
    return [...s].sort().reverse();
  }, [items]);
  const visible = useMemo(() => items.filter((i) => i.numero === numero), [items, numero]);
  const valides = useMemo(
    () => visible.filter((i) => i.statut === 'valide' || i.statut === 'publie'),
    [visible],
  );

  const patchItem = async (id: number, fields: Record<string, string>) => {
    setSavingId(id);
    try {
      await gristFetch('tables/Newsletter/records', {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ id, fields }] }),
      });
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } as NlItem : i)));
      setError('');
    } catch (e: any) {
      setError(t`Could not write to Grist: ${apiErrorText(e)}`);
    } finally {
      setSavingId(null);
    }
  };

  const generate = async () => {
    setGenerating({ done: 0, remaining: 1 });
    setError('');
    try {
      let done = 0;
      for (;;) {
        const r = await fetch('/api/newsletter/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, days: 30, limit: 4, chars }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        done += (data.created || []).length;
        setGenerating({ done, remaining: data.remaining ?? 0 });
        if (data.error) throw new Error(data.error);
        if (!data.remaining) break;
      }
      await load();
    } catch (e: any) {
      setError(t`Generation: ${apiErrorText(e)}`);
    } finally {
      setGenerating(null);
    }
  };

  const validationMailto = (item: NlItem) => {
    const link = `${window.location.origin}${window.location.pathname}?tab=veille&nlItem=${encodeURIComponent(item.work_id)}`;
    const subject = `[${structName}] Votre publication dans la newsletter — relecture demandée`;
    const bodyLines = [
      `Bonjour ${item.chercheur_nom || ''},`.trim(),
      '',
      `Votre publication « ${item.titre} » a été retenue pour la newsletter grand public de ${structName}.`,
      'Une brève de vulgarisation a été générée automatiquement — merci de la relire, la corriger si besoin et la valider ici :',
      '',
      link,
      '',
      'Proposition actuelle :',
      item.accroche,
      item.resume,
      '',
      'Merci !',
    ];
    return `mailto:${encodeURIComponent(item.chercheur_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
  };

  const newsletterHtml = () =>
    renderNewsletter({
      articles: valides.map((i) => ({
        accroche: i.accroche,
        resume: i.resume,
        titre: i.titre,
        doi: i.doi,
        chercheur: i.chercheur_nom
          ? { nom: i.chercheur_nom, photo: i.chercheur_photo, url: i.chercheur_url, labo: i.labs }
          : null,
      })),
      structName,
      footerLine: `Laboratoires : ${[...new Set(valides.flatMap((i) => i.labs.split(', ').filter(Boolean)))].join(', ') || structName}. ${structName} © ${new Date().getFullYear()}.`,
    });

  const download = () => {
    const blob = new Blob([newsletterHtml()], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `newsletter-${slug}-${numero}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyRecipients = async () => {
    try {
      const wanted = String(labo || '').toUpperCase();
      const data = await gristFetch('tables/Annuaire/records');
      const emails = [...new Set(
        (data.records || [])
          .filter((r: any) => !wanted || String(r.fields.LABO || '').toUpperCase() === wanted)
          .map((r: any) => String(r.fields.Email || '').trim())
          .filter((e: string) => e.includes('@')),
      )];
      await navigator.clipboard.writeText(emails.join('; '));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setError(t`Recipients: ${apiErrorText(e)}`);
    }
  };

  const markPublished = () => {
    valides.filter((i) => i.statut !== 'publie').forEach((i) => patchItem(i.id, { statut: 'publie' }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onClose} className="btn-pill px-3 py-1.5 text-[13px]" title={t`Back to the watch`}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
              <Trans>Public newsletter — {structName}</Trans>
            </h3>
            <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
              <Trans>Briefs generated from the last 30 days' articles, validated by the researchers, then distributed.</Trans>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            title={t`Newsletter issue (month)`}
          >
            {numeros.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label
            className="flex items-center gap-2 text-[12px] text-muted-light dark:text-[#8f897c]"
            title={t`Target length of the generated brief (only affects new briefs)`}
          >
            <span className="whitespace-nowrap"><Trans>Length: {chars} chars</Trans></span>
            <input
              type="range"
              min={300}
              max={1000}
              step={50}
              value={chars}
              onChange={(e) => setChars(Number(e.target.value))}
              disabled={!!generating}
              className="w-24 accent-amber-500 cursor-pointer"
            />
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={!!generating}
            className="btn-pill px-3 py-1.5 text-[13px] disabled:opacity-60"
            title={t`Generates a public brief (LLM) for each new OpenAlex article ≤ 30 days old`}
          >
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> <Trans>{generating.done} brief(s)… ({generating.remaining} remaining)</Trans></>
              : <><Sparkles className="w-4 h-4" /> <Trans>Generate briefs</Trans></>}
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            disabled={valides.length === 0}
            className="btn-pill px-3 py-1.5 text-[13px] disabled:opacity-60"
            title={valides.length ? t`Newsletter preview (validated briefs)` : t`No validated brief for this issue`}
          >
            <Eye className="w-4 h-4" /> <Trans>Preview ({valides.length})</Trans>
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-card p-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]"><Trans>Loading…</Trans></div>
      ) : visible.length === 0 ? (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>No brief for issue {numero}. Click “Generate briefs” to popularise the articles published in the last 30 days.</Trans>
        </div>
      ) : (
        visible.map((item) => {
          const focused = focusWorkId === item.work_id;
          return (
            <div
              key={item.id}
              ref={focused ? focusRef : undefined}
              className={`glass-card p-4 flex flex-col gap-2 ${focused ? 'ring-2 ring-amber-400' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUT_META[item.statut]?.cls || ''}`}>
                  {STATUT_META[item.statut] ? t(STATUT_META[item.statut].label) : item.statut}
                  {item.statut === 'valide' && item.valide_par ? ` · ${item.valide_par}` : ''}
                </span>
                <span className="text-[11px] text-muted-light dark:text-[#8f897c]">
                  {item.date_publication}{item.journal ? ` · ${item.journal}` : ''}{item.labs ? ` · ${item.labs}` : ''}
                </span>
              </div>
              {item.chercheur_nom && (
                <div className="flex items-center gap-2">
                  {item.chercheur_photo ? (
                    <img
                      src={item.chercheur_photo}
                      alt={item.chercheur_nom}
                      className="w-9 h-9 rounded-full object-cover border border-white/70 dark:border-white/15"
                    />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-black text-white font-bold text-sm flex items-center justify-center">
                      {item.chercheur_nom.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-ink dark:text-[#f5f2ea]">
                    {item.chercheur_url ? (
                      <a href={item.chercheur_url} target="_blank" rel="noreferrer" className="hover:underline">
                        {item.chercheur_nom}
                      </a>
                    ) : item.chercheur_nom}
                    {item.labs && (
                      <span className="ml-1 text-xs font-normal text-muted-light dark:text-[#8f897c]">· {item.labs}</span>
                    )}
                  </span>
                </div>
              )}
              <input
                className="input-soft w-full py-1.5 text-sm font-semibold"
                value={item.accroche}
                placeholder={t`Hook (emoji + question or concrete sentence)`}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, accroche: e.target.value } : i)))}
              />
              <textarea
                className="input-soft w-full py-2 text-sm leading-relaxed"
                rows={3}
                value={item.resume}
                placeholder={t`Public brief (2-3 sentences)`}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, resume: e.target.value } : i)))}
              />
              <p className="text-[11px] italic text-muted-light dark:text-[#8f897c]">
                <Trans>Original title: {item.titre}</Trans>
                {item.doi && (
                  <> · <a className="underline" href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">DOI</a></>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => patchItem(item.id, { accroche: item.accroche, resume: item.resume })}
                  disabled={savingId === item.id}
                  className="btn-pill px-3 py-1 text-xs disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" /> <Trans>Save</Trans>
                </button>
                {item.chercheur_email ? (
                  <a
                    href={validationMailto(item)}
                    onClick={() => {
                      // mailto: has no JS success signal (missing/misconfigured mail client =
                      // silent no-op): « envoyé » is only set if the user confirms
                      // they actually composed/sent the message, rather than presuming it from
                      // the click alone (review lot 9b — no other action allowed fixing a
                      // wrongly set « envoyé » status).
                      if (window.confirm(t`Open the mail client and mark this item as “sent”?`)) {
                        patchItem(item.id, { statut: 'envoye' });
                      }
                    }}
                    className="btn-pill px-3 py-1 text-xs"
                    title={t`Request validation from ${item.chercheur_nom || item.chercheur_email}`}
                  >
                    <Mail className="w-3.5 h-3.5" /> <Trans>Request validation ({item.chercheur_nom || item.chercheur_email})</Trans>
                  </a>
                ) : (
                  <span className="text-[11px] text-muted-light dark:text-[#8f897c]">
                    <Trans>No researcher matched in the directory</Trans>
                  </span>
                )}
                {item.statut !== 'valide' && item.statut !== 'publie' && (
                  <button
                    type="button"
                    onClick={() => patchItem(item.id, {
                      statut: 'valide',
                      accroche: item.accroche,
                      resume: item.resume,
                      valide_le: new Date().toISOString(),
                      valide_par: me,
                    })}
                    className="btn-pill px-3 py-1 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> <Trans>Validate</Trans>
                  </button>
                )}
                {item.statut !== 'rejete' ? (
                  <button
                    type="button"
                    onClick={() => patchItem(item.id, { statut: 'rejete' })}
                    className="btn-pill px-3 py-1 text-xs"
                  >
                    <XCircle className="w-3.5 h-3.5" /> <Trans>Discard</Trans>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => patchItem(item.id, { statut: 'genere' })}
                    className="btn-pill px-3 py-1 text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> <Trans>Reopen</Trans>
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div
            className="bg-white dark:bg-[#22201b] rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-black/10 dark:border-white/10">
              <span className="font-disp font-semibold text-sm text-ink dark:text-[#f5f2ea]">
                <Trans>Preview</Trans> — <Plural value={valides.length} one="# validated brief" other="# validated briefs" /> · {numero}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={download} className="btn-pill px-3 py-1 text-xs">
                  <Download className="w-3.5 h-3.5" /> <Trans>Download the HTML</Trans>
                </button>
                <button type="button" onClick={copyRecipients} className="btn-pill px-3 py-1 text-xs">
                  <Users className="w-3.5 h-3.5" /> {copied ? t`Recipients copied ✓` : t`Copy recipients`}
                </button>
                <button type="button" onClick={markPublished} className="btn-pill px-3 py-1 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" /> <Trans>Mark as published</Trans>
                </button>
                <button type="button" onClick={() => setPreview(false)} className="btn-pill px-3 py-1 text-xs">
                  <Trans>Close</Trans>
                </button>
              </div>
            </div>
            <iframe title={t`Newsletter preview`} className="w-full flex-1 min-h-[60vh] bg-white" srcDoc={newsletterHtml()} />
          </div>
        </div>
      )}
    </div>
  );
};
