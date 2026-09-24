import { t } from '@lingui/core/macro';
import { useState, useEffect, useCallback } from 'react';
import { Researcher, Structure } from '../types';
import { GristService } from '../lib/gristService';
import { canSeeStructure, hasFullAccess } from '../lib/auth';

/**
 * Custom hook managing Druid's global data (Researchers and Structures).
 * Handles loading, errors and the linking between the two.
 */
export function useDruidData() {
  const [researchers, setResearchers] = useState<Researcher[]>([]);
  const [structures, setStructures] = useState<Structure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  /** Fetch and synchronize the data from Grist */
  const fetchData = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError('');
      
      // fetchResearchers no longer falls back to MOCK_RESEARCHERS (fake data — Marie Curie, Alan
      // Turing) when Grist fails: an admin would see a fake directory with no hint of an outage,
      // since the enclosing catch (setError) would never fire once the promise no longer
      // rejected (review lot 7a).
      const [resData, structData] = await Promise.all([
        GristService.fetchResearchers(force),
        GristService.fetchStructures(force).catch((err: any) => {
          console.error('Failed to sync structures:', err);
          return [];
        })
      ]);

      // Maximum consistency: link the researchers' affiliations to the structures by ID
      const linkedResearchers = resData.map(r => {
        const linkedAffiliations = r.affiliations.map(aff => {
          if (!aff.structureName) return aff;
          const structureNameUpper = Array.isArray(aff.structureName) 
            ? aff.structureName[0].toUpperCase().trim() 
            : String(aff.structureName).toUpperCase().trim();
          
          const matchedStruct = structData.find(s => 
            s.acronym.toUpperCase().trim() === structureNameUpper || 
            s.officialName.toUpperCase().trim() === structureNameUpper
          );
          
          if (matchedStruct) {
            return { 
              ...aff, 
              structureId: matchedStruct.id,
              structureName: matchedStruct.acronym || structureNameUpper
            };
          }
          return aff;
        });
        return { ...r, affiliations: linkedAffiliations };
      });

      // Access rights: a lab director only sees their own structure (and the
      // researchers affiliated with it); an institution-wide right (or super
      // admin) sees everything, as before this work. See lib/auth.ts.
      const visibleStructures = hasFullAccess()
        ? structData
        : structData.filter((s) => canSeeStructure(s.acronym));
      const visibleStructIds = new Set(visibleStructures.map((s) => s.id));
      const visibleResearchers = hasFullAccess()
        ? linkedResearchers
        : linkedResearchers.filter((r) => r.affiliations.some((aff) => visibleStructIds.has(aff.structureId)));

      setResearchers(visibleResearchers);
      setStructures(visibleStructures);
    } catch (err) {
      console.error('Failed to sync with Grist:', err);
      setError(t`Unable to synchronize with Grist.`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    researchers,
    setResearchers,
    structures,
    setStructures,
    loading,
    error,
    setError,
    setLoading,
    refreshData: () => fetchData(true)
  };
}
