import React, { useState } from 'react';
import { DownloadCloud, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';

export interface LdapLookupOutcome {
  tone: 'ok' | 'warn';
  lines: string[];
}

interface Props {
  uid: string;
  onUidChange: (uid: string) => void;
  /** Fetches the LDAP entry and fills the record; rejects with a displayable message. */
  onLookup: (uid: string) => Promise<LdapLookupOutcome>;
}

/**
 * UID field of a record being created, with « Fill from LDAP »: the directory entry fills the
 * civil status, email, grade, employment and lab (lib/ldapPerson.ts). Enter triggers the lookup.
 */
export const LdapUidLookup: React.FC<Props> = ({ uid, onUidChange, onLookup }) => {
  const { t } = useLingui();
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<LdapLookupOutcome | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    if (!uid.trim() || loading) return;
    setLoading(true);
    setError('');
    setOutcome(null);
    try {
      setOutcome(await onLookup(uid.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="md:col-span-2">
      <label className="block text-xs text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>UID (Dyna)</Trans></label>
      <div className="flex gap-2">
        <input
          type="text"
          value={uid}
          onChange={(e) => { onUidChange(e.target.value); setOutcome(null); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(); } }}
          placeholder={t`e.g. dupont-j`}
          className="input-soft font-mono flex-1 min-w-0"
        />
        <button type="button" className="btn-pill shrink-0" onClick={() => void run()} disabled={!uid.trim() || loading}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
          <Trans>Fill from LDAP</Trans>
        </button>
      </div>
      {!outcome && !error && (
        <p className="mt-1.5 text-[12px] text-muted-faint dark:text-[#8f897c]">
          <Trans>Enter the directory identifier, then fill the record from LDAP: name, title, email, date of birth, grade, employment and lab.</Trans>
        </p>
      )}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold text-[#b3261e] dark:text-[#f2b8b5]">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}
        </p>
      )}
      {outcome && (
        <div className={`mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold ${outcome.tone === 'ok' ? 'text-[#2e7d32] dark:text-[#a5d6a7]' : 'text-[#9a6a12] dark:text-[#f0c266]'}`}>
          {outcome.tone === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <div>{outcome.lines.map((l) => <p key={l}>{l}</p>)}</div>
        </div>
      )}
    </div>
  );
};
