import React from 'react';
import { ArrowRight, History, GitMerge, GitBranch } from 'lucide-react';
import { Structure, LineageType, LineageLink } from '../../types';

interface LineageGraphProps {
  currentStructure: Structure;
}

/**
 * Graphical visualization component of the structure's lineage (history).
 * Soft glass style with SVG connectors. Ported from docker/druid-demo (lot 3 of the
 * multi-instance architecture plan) on 2026-09-18.
 *
 * ⚠️ `historyLinks` is currently fed by no real source on the Nantes/Centrale side:
 * `gristService.ts::fetchStructures` hard-codes it to `[]` (no Grist column nor
 * structures.csv of the directory bridge carries any lineage). This component will thus
 * always display « Aucun antécédent enregistré » as long as this wiring does not exist — ported
 * anyway at the product owner's request, as a visible reminder that it remains to be developed.
 */
export const LineageGraph: React.FC<LineageGraphProps> = ({ currentStructure }) => {
  const links = currentStructure.historyLinks || [];

  if (links.length === 0) {
    return (
      <div className="p-8 rounded-panel border border-dashed border-ink/20 dark:border-white/20 flex flex-col items-center justify-center text-muted-lighter dark:text-[#8f897c] gap-4 bg-white/40 dark:bg-white/5">
        <History className="w-12 h-12 opacity-20" />
        <p className="text-xs font-semibold uppercase tracking-[.09em] text-center">Aucun antécédent enregistré pour cette unité</p>
      </div>
    );
  }

  const getTypeIcon = (type: LineageType) => {
    switch (type) {
      case LineageType.FUSION: return <GitMerge className="w-4 h-4" />;
      case LineageType.SCISSION: return <GitBranch className="w-4 h-4" />;
      default: return <History className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: LineageType) => {
    switch (type) {
      case LineageType.SUCCESSION: return "bg-[#3b5bdb]";
      case LineageType.INTEGRATION: return "bg-[#2ea066]";
      case LineageType.FUSION: return "bg-[#e76f9a]";
      case LineageType.SCISSION: return "bg-[#e09e2a]";
      default: return "bg-muted";
    }
  };

  return (
    <div className="relative p-8 glass-card overflow-x-auto min-h-[300px] flex items-center justify-center">
      <div className="flex items-center gap-16 min-w-max">

        {/* Ancestor columns */}
        <div className="flex flex-col gap-8">
           {links.map((link, idx) => (
             <div key={idx} className="relative flex items-center gap-4">
                <div className="flex flex-col items-end">
                   <div className="px-4 py-3 rounded-2xl bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 shadow-soft max-w-[200px]">
                      <h4 className="text-[13px] font-disp font-semibold truncate text-ink dark:text-[#f5f2ea]">{link.relatedStructureName}</h4>
                      <p className="text-[11px] text-muted-light dark:text-[#8f897c] mt-1">{link.date}</p>
                   </div>
                   <div className={`mt-2 px-2.5 py-0.5 rounded-full ${getTypeColor(link.type)} text-white text-[10px] font-bold uppercase tracking-wide`}>
                      {link.type}
                   </div>
                </div>

                {/* SVG connector */}
                <svg className="w-16 h-8 text-ink/30 dark:text-white/30 overflow-visible" preserveAspectRatio="none">
                   <path
                    d="M 0 16 L 64 16"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray="6 5"
                    strokeLinecap="round"
                   />
                   <circle cx="60" cy="16" r="4" fill="currentColor" />
                </svg>
             </div>
           ))}
        </div>

        {/* Current structure */}
        <div className="relative">
           <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="px-3 py-1 rounded-full bg-ink text-accent dark:bg-accent dark:text-ink text-[11px] font-disp font-semibold uppercase tracking-wide">Unité cible</span>
           </div>
           <div className="p-8 rounded-panel bg-ink dark:bg-white/10 text-white shadow-soft-lg transform hover:scale-105 transition-transform cursor-default ring-4 ring-accent/30">
              <h3 className="text-2xl font-disp font-bold tracking-tight">{currentStructure.acronym}</h3>
              <p className="text-[12px] font-mono mt-2 opacity-70">{currentStructure.code}</p>
           </div>
           {/* Current status indicator */}
           <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
              <div className="px-4 py-1 rounded-full bg-white/85 dark:bg-white/10 border border-white/90 dark:border-white/15 text-ink dark:text-[#f5f2ea] text-[11px] font-bold uppercase tracking-wide shadow-soft">
                 {currentStructure.status}
              </div>
           </div>
        </div>

        {/* Next steps (placeholder showing the direction) */}
        <div className="flex flex-col gap-8 opacity-20">
           <div className="flex items-center gap-4">
              <svg className="w-16 h-8 text-ink/40 dark:text-white/40" preserveAspectRatio="none">
                 <path d="M 0 16 L 64 16" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="6 5" strokeLinecap="round" />
              </svg>
              <div className="px-4 py-3 rounded-2xl border border-dashed border-ink/30 dark:border-white/30 bg-transparent">
                 <div className="w-24 h-4 rounded bg-ink/10 dark:bg-white/10"></div>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
};
