import React from 'react';
import { ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';
import { ValidationInfo, isValidationStale } from '../../lib/validation';
import { Presence, hasPresenceConflict, type LdapAccountState } from '../../lib/presence';
import { useLingui } from '@lingui/react/macro';
import { LDAP_ACCOUNT_LABELS, PRESENCE_LABELS, VALIDATION_SCOPE_LABELS } from '../../lib/researcherLabels';
import { hasCapability } from '../../lib/auth';

interface PresenceBadgeProps {
  presence?: Presence;
  /** Institution LDAP account — small marker, on the instances that read an LDAP. */
  ldapAccount?: LdapAccountState;
  /** Manual validation layer — adds a « validé / périmé / conflit » decorator. */
  validation?: ValidationInfo;
  /** Presence derived from the sources (LDAP / dates): if it contradicts the validated one, « conflit » decorator. */
  derivedPresence?: Presence;
}

const PresenceChip: React.FC<{ presence?: Presence }> = ({ presence }) => {
  const { t } = useLingui();
  switch (presence) {
    case Presence.PRESENT:
      return <span className="status-pill-internal">● {t(PRESENCE_LABELS[presence])}</span>;
    case Presence.DEPART:
      return <span className="status-pill-leaving">● {t(PRESENCE_LABELS[presence])}</span>;
    case Presence.PARTI:
      return (
        <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold bg-ink/10 text-muted dark:bg-white/10 dark:text-[#8f897c]">
          ● {t(PRESENCE_LABELS[presence])}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold bg-ink/5 text-muted-faint dark:bg-white/5 dark:text-[#8f897c]">
          {t`No status`}
        </span>
      );
  }
};

/** LDAP account marker: key icon, struck through tone when closing; nothing without an account. */
export const LdapAccountMark: React.FC<{ state?: LdapAccountState; onDark?: boolean }> = ({ state, onDark = false }) => {
  const { t } = useLingui();
  if (!state || state === 'none' || !hasCapability('HAS_LDAP')) return null;
  const tone = onDark
    ? 'bg-white/20 text-white border border-white/30'
    : state === 'closing'
      ? 'bg-[rgba(214,69,69,.12)] text-[#b23b3b] dark:text-[#f08c8c]'
      : 'bg-white border border-ink/10 text-muted dark:bg-white/5 dark:border-white/10 dark:text-[#c9c3b5]';
  return (
    <span title={t(LDAP_ACCOUNT_LABELS[state])} className={`inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] font-semibold ${tone}`}>
      <KeyRound className="w-3 h-3" />{state === 'closing' ? t`closing` : 'LDAP'}
    </span>
  );
};

/**
 * « validé » decorator: axis orthogonal to the status. Indicates that the row was
 * made reliable by hand (✓ + source/date in tooltip), or « périmé » if the
 * validation is too old (to re-check).
 */
export const ValidationMark: React.FC<{ validation?: ValidationInfo; derivedPresence?: Presence; now?: Date }> = ({
  validation,
  derivedPresence,
  now = new Date(),
}) => {
  const { t } = useLingui();
  if (!validation?.validated) return null;
  const stale = isValidationStale(validation, now);
  // Conflict: the source (LDAP / dates) says something else than the validated presence — the displayed
  // presence is the validated one, so we flag that the derived one diverges (to arbitrate via the LDAP sync).
  const conflict = hasPresenceConflict(validation, derivedPresence);
  const derivedLabel = derivedPresence !== undefined ? t(PRESENCE_LABELS[derivedPresence]) : '';
  const source = validation.validationSource;
  const date = validation.validationDate;
  const scope = validation.validationScope.map((s) => t(VALIDATION_SCOPE_LABELS[s])).join(' + ');
  const by = validation.validatedBy;
  const tooltip = [
    source ? t`Source: ${source}` : null,
    date ? t`Validated on ${date}` : null,
    validation.validationScope.length ? t`Covers: ${scope}` : null,
    by ? t`By ${by}` : null,
    conflict ? t`⚠ Conflict: the source (LDAP / dates) says “${derivedLabel}”` : null,
    stale ? t`⚠ Validation expired — to be rechecked` : null,
  ].filter(Boolean).join('\n');
  const warn = stale || conflict;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-semibold ${
        warn
          ? 'bg-[rgba(224,158,42,.18)] text-[#9a6a12] dark:bg-[rgba(224,158,42,.22)] dark:text-[#f0c266]'
          : 'bg-white border border-[rgba(46,160,102,.4)] text-[#1f7a4d] dark:bg-white/5 dark:border-[rgba(95,211,154,.35)] dark:text-[#5fd39a]'
      }`}
    >
      {warn ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
      {conflict ? t`Validated — conflict` : stale ? t`Expired` : t`Validated`}
    </span>
  );
};

export const PresenceBadge: React.FC<PresenceBadgeProps> = ({ presence, ldapAccount, validation, derivedPresence }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <PresenceChip presence={presence} />
    <LdapAccountMark state={ldapAccount} />
    <ValidationMark validation={validation} derivedPresence={derivedPresence} />
  </span>
);
