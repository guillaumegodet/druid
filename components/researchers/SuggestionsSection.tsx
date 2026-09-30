import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lightbulb, ExternalLink, Mail, ClipboardPlus, EyeOff, Copy, Check, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { apiErrorText } from '../../lib/apiErrors';
import { affiliationHistoryKey } from '../../lib/affiliationHistory';
import { SuggestionsApi, suggestionDetail, suggestionLink, type Suggestion, type SuggestionsResponse } from '../../lib/suggestions';
import { buildTaskEmail, mailtoUrl } from '../../lib/taskEmailTemplates';
import { copyToClipboard } from '../../lib/clipboard';
import { getUserInfo } from '../../lib/auth';

// « Suggestions de l'établissement » of the researcher record (docs/plan-parcours-affiliations.md, lot 5):
// at most five concrete actions on the researcher's identifiers, computed server-side from the record, the
// career path and the alignment caches. Decisions S1-S4: the team sees « Prepare the email / Create a
// task / Hide »; the researcher reading their own record sees the same suggestions in the second person,
// without those buttons; never an email sent by Druid.

const labelCls = 'text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]';

/** Title (the action), why (second person for the researcher, third for the team) and how. */
const SuggestionText: React.FC<{ s: Suggestion; self: boolean }> = ({ s, self }) => {
  const { t } = useLingui();
  const d = s.data;
  const orcid = d.orcid || '';
  const scopus = d.scopus || '';
  const institution = d.institution || '';
  const ror = d.ror || '';
  const halDocs = d.halDocs || 0;
  const nIds = (d.ids || []).length;
  const docCount = d.docCount ?? 0;
  let title = ''; let why: React.ReactNode = null; let how: React.ReactNode = null;
  switch (s.id) {
    case 'orcid_creer':
      title = t`Create an ORCID iD`;
      why = self ? <Trans>You have no ORCID iD: most funders and publishers now ask for one, and it attaches your publications to the institution automatically.</Trans> : <Trans>No ORCID iD in the record.</Trans>;
      how = <Trans>Two minutes on orcid.org, with the professional address, and « {institution} » as employment.</Trans>;
      break;
    case 'orcid_rendre_public':
      title = t`Make the ORCID profile public`;
      why = self ? <Trans>Your ORCID profile ({orcid}) shows nothing publicly: it cannot be used to attach your work to the institution.</Trans> : <Trans>The ORCID profile ({orcid}) is empty or private.</Trans>;
      how = <Trans>In the ORCID account settings, set the default visibility to « Everyone », then make the existing items visible.</Trans>;
      break;
    case 'orcid_ajouter_poste':
      title = d.missing === 'all' ? t`Add the position to ORCID` : t`Add the position at the institution to ORCID`;
      why = self
        ? (d.missing === 'all' ? <Trans>Your ORCID profile lists no position at all.</Trans> : <Trans>Your ORCID profile lists other positions, but not the one at {institution}.</Trans>)
        : (d.missing === 'all' ? <Trans>The ORCID profile ({orcid}) lists no position.</Trans> : <Trans>The ORCID profile ({orcid}) does not list the position at {institution}.</Trans>);
      how = ror
        ? <Trans>ORCID › Employment › Add: organisation « {institution} » (ROR {ror}), the lab as department, the start date, visibility « Everyone ».</Trans>
        : <Trans>ORCID › Employment › Add: organisation « {institution} », the lab as department, the start date, visibility « Everyone ».</Trans>;
      break;
    case 'idhal_creer':
      title = t`Create an IdHAL`;
      why = halDocs
        ? (self ? <Trans>{halDocs} HAL deposits bear your name, but you have no IdHAL to gather them.</Trans> : <Trans>{halDocs} HAL deposits, no IdHAL in the record.</Trans>)
        : (self ? <Trans>You have no IdHAL: it gathers your HAL deposits and builds your HAL CV.</Trans> : <Trans>No IdHAL in the record.</Trans>);
      how = <Trans>HAL › My space › My IdHAL; link the ORCID iD there too.</Trans>;
      break;
    case 'idhal_fusionner':
      title = t`Merge two IdHAL`;
      why = self ? <Trans>Two IdHAL seem to be yours: your deposits are split between them.</Trans> : <Trans>Two IdHAL for this person (detection rule of « À traiter »).</Trans>;
      how = <Trans>Keep one IdHAL: ask HAL support to merge them, from the IdHAL page or through the documentation team.</Trans>;
      break;
    case 'scopus_corriger':
      title = t`Correct the Scopus author profile`;
      why = d.reason === 'merged'
        ? (self ? <Trans>Your Scopus profile ({scopus}) holds {docCount} documents, many of which do not seem to be yours.</Trans> : <Trans>Scopus profile {scopus}: {docCount} documents, probably merged with namesakes.</Trans>)
        : (self ? <Trans>Your Scopus profile ({scopus}) never mentions the institution.</Trans> : <Trans>Scopus profile {scopus} never affiliated to the institution: wrong profile or namesake?</Trans>);
      how = <Trans>Elsevier Author Feedback Wizard: select the profile, remove the documents that are not yours, add the missing ones.</Trans>;
      break;
    case 'scopus_fusionner':
      title = t`Merge two Scopus profiles`;
      why = self ? <Trans>Scopus splits your publications between two author profiles.</Trans> : <Trans>Two Scopus author profiles for this person (detection rule of « À traiter »).</Trans>;
      how = <Trans>Elsevier Author Feedback Wizard: select both profiles and ask for the merge.</Trans>;
      break;
    case 'openalex_fusionner':
      title = t`Merge the OpenAlex profiles`;
      why = self ? <Trans>OpenAlex splits your publications between {nIds} author profiles.</Trans> : <Trans>{nIds} OpenAlex author profiles reviewed for this person.</Trans>;
      how = <Trans>OpenAlex is self-service: sign in with the professional address, « Claim » the author page, then move the works of the other profiles to it.</Trans>;
      break;
    case 'orcid_relier_scopus':
      title = t`Link Scopus and ORCID`;
      why = self ? <Trans>Your Scopus profile ({scopus}) is not linked to your ORCID iD: your Scopus publications do not reach it.</Trans> : <Trans>The ORCID profile does not list the Scopus Author ID {scopus}.</Trans>;
      how = <Trans>Elsevier's Scopus-to-ORCID wizard (sign in with ORCID, check the profile, send the publications).</Trans>;
      break;
    case 'orcid_cloturer_poste':
      title = t`Close the position in ORCID`;
      why = self ? <Trans>Your ORCID profile still shows an ongoing position at the institution, while your recent publications are affiliated elsewhere.</Trans> : <Trans>Departure detected, yet the ORCID profile keeps an ongoing position at the institution.</Trans>;
      how = <Trans>ORCID › Employment: add the end date of the position.</Trans>;
      break;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]">{title}</span>
      <span className="text-[12px] text-muted dark:text-[#c3beb0]">{why}</span>
      <span className="text-[12px] text-ink/80 dark:text-[#e8e4d8]">{how}</span>
    </div>
  );
};

const PRIORITY_DOT: Record<number, string> = { 1: 'bg-[#d64545]', 2: 'bg-[#e09e2a]', 3: 'bg-[#3b5bdb] dark:bg-[#5c7cfa]' };

export const SuggestionsSection: React.FC<{ researcher: Researcher }> = ({ researcher }) => {
  const { t } = useLingui();
  const key = affiliationHistoryKey(researcher);
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<Suggestion | null>(null);
  const [dismissFor, setDismissFor] = useState<Suggestion | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!key) return;
    try { setData(await SuggestionsApi.get(key)); setError(''); }
    catch (e) { setError(apiErrorText(e)); }
  }, [key]);
  useEffect(() => { load(); }, [load]);

  const act = async (s: Suggestion, action: 'task' | 'dismiss', extra: { reason?: string } = {}) => {
    if (!key) return;
    setBusy(s.id);
    try { await SuggestionsApi.act(key, s.id, action, { ...extra, description: suggestionDetail(s) }); await load(); setDismissFor(null); setReason(''); }
    catch (e) { setError(apiErrorText(e)); }
    finally { setBusy(null); }
  };

  if (!key || (!data && !error)) return null;
  const list = data?.suggestions || [];
  if (!list.length && !error) return null;   // nothing to suggest: no empty card on the record
  const { self, canAct } = data?.viewer || { self: false, canAct: false };
  const hidden = data?.hidden || 0;

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <Lightbulb className="w-4 h-4" /> {self ? <Trans>Suggestions of the institution for you</Trans> : <Trans>Suggestions of the institution</Trans>}
        </h4>
        <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
          {self
            ? <Trans>A few actions on your researcher identifiers, so that your publications are attached to you and to your lab.</Trans>
            : <Trans>Actions to suggest to the researcher on their identifiers, from the career path and the alignments.</Trans>}
        </p>
      </div>
      {error && <p className="text-[12px] text-[#b23b3b] dark:text-[#e57373]">{error}</p>}
      <ul className="flex flex-col divide-y divide-ink/5 dark:divide-white/10">
        {list.map((s) => {
          const link = suggestionLink(s);
          const email = canAct && s.taskType ? buildTaskEmail(s.taskType, {
            civility: researcher.civility, firstName: researcher.firstName, lastName: researcher.lastName,
            labo: researcher.affiliations[0]?.structureName, orcid: researcher.identifiers.orcid,
            halId: researcher.identifiers.halId, scopusId: researcher.identifiers.scopusId,
            description: suggestionDetail(s), senderName: getUserInfo().name,
          }) : null;
          return (
            <li key={s.id} className="py-3 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[s.priority]}`} aria-hidden />
                <div className="flex-1"><SuggestionText s={s} self={self} /></div>
                {s.task && <span className={`${labelCls} shrink-0 mt-0.5`}><Trans>task in progress</Trans></span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-5">
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="btn-pill h-8 text-[12px]">
                    <ExternalLink className="w-3.5 h-3.5" /> <Trans>Open the page</Trans>
                  </a>
                )}
                {email && (
                  <button type="button" onClick={() => setEmailFor(emailFor?.id === s.id ? null : s)} className="btn-pill h-8 text-[12px]">
                    <Mail className="w-3.5 h-3.5" /> <Trans>Prepare the email</Trans>
                  </button>
                )}
                {canAct && !s.task && s.taskType && (
                  <button type="button" disabled={busy === s.id} onClick={() => act(s, 'task')} className="btn-pill h-8 text-[12px] disabled:opacity-50">
                    <ClipboardPlus className="w-3.5 h-3.5" /> <Trans>Create a task</Trans>
                  </button>
                )}
                {canAct && (
                  <button type="button" disabled={busy === s.id} onClick={() => { setDismissFor(dismissFor?.id === s.id ? null : s); setReason(''); }} className="btn-pill h-8 text-[12px] disabled:opacity-50">
                    <EyeOff className="w-3.5 h-3.5" /> <Trans>Hide</Trans>
                  </button>
                )}
              </div>
              {dismissFor?.id === s.id && (
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t`Why hide it? (already done, not relevant…)`} className="input-soft !h-8 !py-1 text-[12px] flex-1 min-w-[220px]" />
                  <button type="button" disabled={busy === s.id} onClick={() => act(s, 'dismiss', { reason })} className="btn-pill-dark h-8 text-[12px] disabled:opacity-50"><Trans>Hide the suggestion</Trans></button>
                  <button type="button" onClick={() => setDismissFor(null)} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10" title={t`Cancel`}><X className="w-4 h-4" /></button>
                </div>
              )}
              {emailFor?.id === s.id && email && <EmailDraft to={researcher.email} subject={email.subject} body={email.body} />}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]"><Trans>{hidden} more suggestions will show once these are done.</Trans></p>}
    </div>
  );
};

/** Editable draft: copy it or open it in the mail client — Druid never sends it (decision S3). */
const EmailDraft: React.FC<{ to: string; subject: string; body: string }> = ({ to, subject: s0, body: b0 }) => {
  const { t } = useLingui();
  const [subject, setSubject] = useState(s0);
  const [body, setBody] = useState(b0);
  const [copied, setCopied] = useState(false);
  const email = useMemo(() => ({ subject, body }), [subject, body]);
  return (
    <div className="ml-5 rounded-2xl border border-ink/10 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3 flex flex-col gap-2">
      <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="input-soft !h-8 !py-1 text-[12px]" aria-label={t`Subject`} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="input-soft text-[12px] font-mono leading-snug" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={async () => setCopied(await copyToClipboard(`${t`Subject:`} ${subject}\n\n${body}`))} className="btn-pill h-8 text-[12px]">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} <Trans>Copy the email</Trans>
        </button>
        {to
          ? <a href={mailtoUrl(to, email)} className="btn-pill h-8 text-[12px]"><ExternalLink className="w-3.5 h-3.5" /> <Trans>Open in the mail client</Trans></a>
          : <span className="text-[11px] font-bold text-[#9a6a12] dark:text-[#f0c266]"><Trans>no email in the Directory</Trans></span>}
      </div>
    </div>
  );
};
