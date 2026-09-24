import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

interface GroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Grist write handled by the caller (asynchronous, see ResearcherList.tsx::handleConfirmGroupAdd). */
  onConfirm: (groupName: string) => void;
  selectedCount: number;
  allGroups: string[];
}

/** « Ajouter à un groupe » modal — extracted from ResearcherList.tsx (lot 3 of the
 * multi-instance architecture plan, refactor sub-lot ResearcherList); now owns its
 * own `groupInput` state (the demo writes nothing to Grist, this component only
 * calls `onConfirm`, the actual write stays in the orchestrator). */
export const GroupModal: React.FC<GroupModalProps> = ({ isOpen, onClose, onConfirm, selectedCount, allGroups }) => {
  const { t } = useLingui();
  const [groupInput, setGroupInput] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    const name = groupInput.trim();
    if (!name) return;
    onConfirm(name);
    setGroupInput('');
  };

  const handleClose = () => {
    setGroupInput('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-ink/5 dark:border-white/5 flex justify-between items-center">
          <h3 className="font-disp text-lg font-bold text-ink dark:text-[#f5f2ea]"><Trans>Add to a group</Trans></h3>
          <button onClick={handleClose} className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:bg-ink/5 dark:text-[#8f897c] dark:hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <label className="block text-xs text-muted-lighter dark:text-[#8f897c]"><Trans>Group name</Trans></label>
          <input
            type="text"
            value={groupInput}
            onChange={(e) => setGroupInput(e.target.value)}
            list="existing-groups"
            className="input-soft"
            placeholder={t`Select or create…`}
            autoFocus
          />
          <datalist id="existing-groups">
            {allGroups.map(g => <option key={g} value={g} />)}
          </datalist>
          <div className="text-sm font-semibold rounded-xl bg-accent/15 text-ink dark:text-[#f5f2ea] px-3.5 py-2.5">
            <Plural value={selectedCount} one="# researcher selected" other="# researchers selected" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-ink/5 dark:border-white/5 flex justify-end gap-2.5">
          <button onClick={handleClose} className="btn-pill h-10"><Trans>Cancel</Trans></button>
          <button onClick={handleConfirm} disabled={!groupInput.trim()} className="btn-pill-dark h-10 disabled:opacity-50"><Trans>Validate</Trans></button>
        </div>
      </div>
    </div>
  );
};
