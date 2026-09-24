import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { ResearcherStatus } from '../../types';
import { ValidationInfo, isValidationStale, hasValidationConflict } from '../../lib/validation';
import { useLingui } from '@lingui/react/macro';
import { STATUS_LABELS, VALIDATION_SCOPE_LABELS } from '../../lib/researcherLabels';

interface StatusBadgeProps {
  status: ResearcherStatus;
  /** Manual validation layer — adds a « validé / périmé / conflit » decorator. */
  validation?: ValidationInfo;
  /** Status derived from the sources (LDAP / dates): if it contradicts the validated status, « conflit » decorator. */
  derivedStatus?: ResearcherStatus;
}

const StatusChip: React.FC<{ status: ResearcherStatus }> = ({ status }) => {
  const { t } = useLingui();
  switch (status) {
    case ResearcherStatus.INTERNE:
      return <span className="status-pill-internal">● {t(STATUS_LABELS[status])}</span>;
    case ResearcherStatus.DEPART:
      return <span className="status-pill-leaving">● {t(STATUS_LABELS[status])}</span>;
    case ResearcherStatus.PARTI:
      return (
        <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold bg-ink/10 text-muted dark:bg-white/10 dark:text-[#8f897c]">
          ● {t(STATUS_LABELS[status])}
        </span>
      );
    case ResearcherStatus.EXTERNE:
      return <span className="status-pill-external">● {t(STATUS_LABELS[status])}</span>;
    default:
      return (
        <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-semibold bg-ink/5 text-muted-faint dark:bg-white/5 dark:text-[#8f897c]">
          {t`No status`}
        </span>
      );
  }
};

/**
 * « validé » decorator: axis orthogonal to the status. Indicates that the row was
 * made reliable by hand (✓ + source/date in tooltip), or « périmé » if the
 * validation is too old (to re-check).
 */
export const ValidationMark: React.FC<{ validation?: ValidationInfo; derivedStatus?: ResearcherStatus; now?: Date }> = ({
  validation,
  derivedStatus,
  now = new Date(),
}) => {
  const { t } = useLingui();
  if (!validation?.validated) return null;
  const stale = isValidationStale(validation, now);
  // Conflict: the source (LDAP / dates) says something else than the validated status — the displayed
  // status is the validated one, so we flag that the derived one diverges (to arbitrate via the LDAP sync).
  const conflict = derivedStatus !== undefined && hasValidationConflict(validation, derivedStatus);
  const derivedLabel = derivedStatus !== undefined ? t(STATUS_LABELS[derivedStatus]) : '';
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

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, validation, derivedStatus }) => (
  <span className="inline-flex items-center gap-1.5">
    <StatusChip status={status} />
    <ValidationMark validation={validation} derivedStatus={derivedStatus} />
  </span>
);
