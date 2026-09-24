import React, { useEffect, useState } from 'react';
import { ExternalLink, Megaphone, Share2, GraduationCap } from 'lucide-react';
import { Researcher } from '../../types';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

// « Présence médiatique » block of the Personnel record (media monitoring).
// In-place editing of the social media accounts (Grist columns Bluesky/Mastodon/
// YouTube/Podcast_flux/Blog/LinkedIn) and of the academic profiles / CVs
// (CV_institutionnel/CV_site_labo/CV_pdf_docx_/CV_HAL/Academia/Researchgate/
// Profil_GS/Site_web). Changes are propagated via `onUpdateField`
// and persisted by the record's « Enregistrer » button.
// The displayed mentions remain those of the lab as long as the named-person
// part of media monitoring is not enabled (DPO framing — see the monitoring plan).

interface LabMention {
  id: string;
  url: string;
  title: string;
  media_name: string;
  media_type: string;
  published_at: string;
  status: string;
}

type SocialKey = keyof NonNullable<Researcher['socials']>;
type ProfileKey = keyof NonNullable<Researcher['profiles']>;

// Labels declared with `msg` (outside the component) and resolved at display time via `t(...)`.
const SOCIAL_FIELDS: { key: SocialKey; label: MessageDescriptor; placeholder: MessageDescriptor }[] = [
  { key: 'bluesky', label: msg`Bluesky`, placeholder: msg`https://bsky.app/profile/…` },
  { key: 'mastodon', label: msg`Mastodon`, placeholder: msg`https://instance/@account` },
  { key: 'youtube', label: msg`YouTube`, placeholder: msg`https://youtube.com/@channel` },
  { key: 'podcast', label: msg`Podcast (RSS feed)`, placeholder: msg`https://…/feed.xml` },
  { key: 'blog', label: msg`Blog`, placeholder: msg`https://…` },
  { key: 'linkedin', label: msg`LinkedIn`, placeholder: msg`https://linkedin.com/in/…` },
];

const PROFILE_FIELDS: { key: ProfileKey; label: MessageDescriptor; placeholder: MessageDescriptor }[] = [
  { key: 'cvInstitutionnel', label: msg`Institutional CV`, placeholder: msg`URL of the institutional page` },
  { key: 'cvSiteLabo', label: msg`Lab website CV`, placeholder: msg`URL of the page on the lab website` },
  { key: 'cvPdf', label: msg`CV (pdf, docx…)`, placeholder: msg`URL of the CV document` },
  { key: 'cvHal', label: msg`HAL CV`, placeholder: msg`https://cv.hal.science/…` },
  { key: 'academia', label: msg`Academia`, placeholder: msg`https://…academia.edu/…` },
  { key: 'researchgate', label: msg`ResearchGate`, placeholder: msg`https://researchgate.net/profile/…` },
  { key: 'googleScholar', label: msg`Google Scholar`, placeholder: msg`https://scholar.google.com/citations?user=…` },
  { key: 'website', label: msg`Website`, placeholder: msg`https://…` },
];

const toHref = (v: string) => (v.startsWith('http') ? v : `https://${v}`);

const labelCls =
  'text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]';

/** An editable row: title + field + open button when a URL is entered. */
const LinkField: React.FC<{
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, placeholder, value, onChange }) => {
  const { t } = useLingui();
  return (
  <label className="flex flex-col gap-1">
    <span className={labelCls}>{label}</span>
    <div className="flex items-center gap-1.5">
      <input
        type="url"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input-soft flex-1 min-w-0"
      />
      {value.trim() && (
        <a
          href={toHref(value.trim())}
          target="_blank"
          rel="noopener noreferrer"
          title={t`Open: ${label}`}
          className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-ink/5 dark:text-[#8f897c] dark:hover:bg-white/10 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  </label>
  );
};

export const MediaPresenceSection: React.FC<{
  researcher: Researcher;
  /** Propagates a change to the record form (see ResearcherDetail.updateField).
   * Absent ⇒ read-only display (pills). */
  onUpdateField?: (field: string, value: any, subObject?: string) => void;
}> = ({ researcher, onUpdateField }) => {
  const { t } = useLingui();
  const labo = researcher.affiliations?.[0]?.structureName || '';
  const [mentions, setMentions] = useState<LabMention[] | null>(null);
  const editable = !!onUpdateField;

  useEffect(() => {
    if (!labo) return;
    let cancelled = false;
    fetch(`/api/mentions?structure=${encodeURIComponent(labo.toLowerCase())}&days=120&limit=5`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setMentions(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [labo]);

  const socials = researcher.socials || {};
  const profiles = researcher.profiles || {};

  // Read only: gathers every filled link as clickable badges.
  const readonlyLinks = [
    ...SOCIAL_FIELDS.map((f) => ({ label: t(f.label), url: (socials as any)[f.key] || '' })),
    ...PROFILE_FIELDS.map((f) => ({ label: t(f.label), url: (profiles as any)[f.key] || '' })),
  ].filter((a) => a.url);

  return (
    <div className="glass-card p-5 flex flex-col gap-5">
      <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
        <Megaphone className="w-4 h-4" />
        <Trans>Media presence</Trans>
      </h4>

      {editable ? (
        <>
          {/* Public social media — tracked by media monitoring */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
              <Share2 className="w-3.5 h-3.5 opacity-70" />
              <span className="text-[13px] font-semibold"><Trans>Social media accounts</Trans></span>
            </div>
            <p className="text-[11px] text-muted-lighter dark:text-[#8f897c] -mt-1.5">
              <Trans>
                Declared public accounts (Bluesky, Mastodon, YouTube channel, podcast, blog, LinkedIn): once entered here, they become sources tracked by the media watch.
              </Trans>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {SOCIAL_FIELDS.map((f) => (
                <LinkField
                  key={f.key}
                  label={t(f.label)}
                  placeholder={t(f.placeholder)}
                  value={(socials as any)[f.key] || ''}
                  onChange={(v) => onUpdateField!(f.key, v, 'socials')}
                />
              ))}
            </div>
          </div>

          {/* Academic profiles & public CVs */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-ink dark:text-[#f5f2ea]">
              <GraduationCap className="w-3.5 h-3.5 opacity-70" />
              <span className="text-[13px] font-semibold"><Trans>Profiles & CV</Trans></span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {PROFILE_FIELDS.map((f) => (
                <LinkField
                  key={f.key}
                  label={t(f.label)}
                  placeholder={t(f.placeholder)}
                  value={(profiles as any)[f.key] || ''}
                  onChange={(v) => onUpdateField!(f.key, v, 'profiles')}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
              <Trans>These links are saved with the record (“Save” button at the top).</Trans>
            </p>
          </div>
        </>
      ) : (
        <div>
          <div className={`${labelCls} mb-1.5`}><Trans>Declared accounts & profiles</Trans></div>
          {readonlyLinks.length === 0 ? (
            <p className="text-xs text-muted dark:text-[#c3beb0]"><Trans>No link declared.</Trans></p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {readonlyLinks.map((a) => (
                <a
                  key={a.label}
                  href={toHref(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:shadow-soft transition-shadow"
                >
                  {a.label}
                  <ExternalLink className="w-3 h-3 opacity-50" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {labo && (
        <div>
          <div className={`${labelCls} mb-1.5`}>
            <Trans>Latest mentions of the lab ({labo})</Trans>
          </div>
          {!mentions || mentions.length === 0 ? (
            <p className="text-xs text-muted dark:text-[#c3beb0]">
              <Trans>No recent mention collected for this lab.</Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mentions.map((m) => (
                <li key={m.id} className="text-xs truncate">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink dark:text-[#f5f2ea] hover:underline"
                    title={m.title}
                  >
                    <span className="text-muted dark:text-[#c3beb0]">
                      {m.published_at?.slice(0, 10)} · {m.media_name} —{' '}
                    </span>
                    {m.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
        <Trans>
          The researcher's individual mentions will appear here once the personal part of the media watch is enabled (DPO review in progress).
        </Trans>
      </p>
    </div>
  );
};
