import React from 'react';

/**
 * Component displaying the researcher identifier icons
 * « soft glass » style: rounded colored badges (see index.css .id-badge-*).
 */
export const ResearcherIcons: React.FC<{ identifiers: any }> = ({ identifiers }) => {
  const hasOrcid = !!identifiers.orcid;
  const hasHal = !!identifiers.halId;
  const hasIdref = !!identifiers.idref;
  const hasScopus = !!identifiers.scopusId;

  if (!hasOrcid && !hasHal && !hasIdref && !hasScopus) {
    return <span className="text-[12.5px] text-muted-faint dark:text-[#8f897c] italic">Aucun identifiant</span>;
  }

  return (
    <div className="flex gap-1.5 items-center flex-wrap">
      {/* ORCID */}
      {hasOrcid && (
        <span title={`ORCID: ${identifiers.orcid}`} className="id-badge-orcid cursor-help">
          iD
        </span>
      )}

      {/* IdHAL */}
      {hasHal && (
        <span title={`HAL: ${identifiers.halId}`} className="id-badge-hal cursor-help">
          HAL
        </span>
      )}

      {/* IdRef */}
      {hasIdref && (
        <span title={`IdRef: ${identifiers.idref}`} className="id-badge-idref cursor-help">
          IdRef
        </span>
      )}

      {/* Scopus */}
      {hasScopus && (
        <span title={`Scopus: ${identifiers.scopusId}`} className="id-badge-scopus cursor-help">
          Sc
        </span>
      )}
    </div>
  );
};
