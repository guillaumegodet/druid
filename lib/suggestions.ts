/**
 * @file suggestions.ts
 * @description « Suggestions de l'établissement » of a researcher record (docs/plan-parcours-affiliations.md,
 * lot 5): types and API client of /api/researchers/:key/suggestions (computed server-side by
 * scripts/lib/suggestions.cjs), official links of each action and the detail handed to the email
 * template. The texts themselves live in components/researchers/SuggestionsSection.tsx (Lingui).
 */
import { translateApiError } from './apiErrors';

export type SuggestionId =
  | 'orcid_creer' | 'orcid_rendre_public' | 'orcid_ajouter_poste' | 'idhal_creer' | 'idhal_fusionner'
  | 'scopus_corriger' | 'scopus_fusionner' | 'openalex_fusionner' | 'orcid_relier_scopus' | 'orcid_cloturer_poste';

export interface Suggestion {
  id: SuggestionId;
  priority: 1 | 2 | 3;
  rank: number;
  taskType: string | null;
  data: {
    orcid?: string; scopus?: string; ids?: string[]; halDocs?: number; detail?: string;
    institution?: string; ror?: string; start?: string; missing?: 'all' | 'local';
    reason?: 'never_local' | 'merged'; docCount?: number | null;
  };
  task: { id?: number; statut: string } | null;
}
export interface SuggestionsResponse {
  suggestions: Suggestion[];
  hidden: number;
  viewer: { self: boolean; canAct: boolean };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as T;
}
export const SuggestionsApi = {
  get: (key: string) => request<SuggestionsResponse>(`/api/researchers/${encodeURIComponent(key)}/suggestions`),
  /** « Create a task » (action task) or « Hide » (action dismiss, with a reason): administrators. */
  act: (key: string, id: SuggestionId, action: 'task' | 'dismiss', extra: { reason?: string; description?: string } = {}) =>
    request<{ task: { id: number } }>(`/api/researchers/${encodeURIComponent(key)}/suggestions/${id}/task`, { method: 'POST', body: JSON.stringify({ action, ...extra }) }),
};

/** Official page of each action (checked on 2026-09-30, lot 5a). */
export function suggestionLink(s: Suggestion): string {
  switch (s.id) {
    case 'orcid_creer': return 'https://orcid.org/register';
    case 'orcid_rendre_public': return 'https://orcid.org/account';
    case 'orcid_ajouter_poste':
    case 'orcid_cloturer_poste': return 'https://orcid.org/my-orcid';
    case 'idhal_creer':
    case 'idhal_fusionner': return 'https://hal.science/user/idhal';
    case 'scopus_corriger':
    case 'scopus_fusionner': return 'https://www.scopus.com/feedback/author/home.uri';
    case 'openalex_fusionner': return 'https://help.openalex.org/how-to/fixing-authors/';
    case 'orcid_relier_scopus': return 'https://orcid.scopusfeedback.com/';
    default: return '';
  }
}

/** Detail handed to the email template / task description (French: it goes to the researcher). */
export function suggestionDetail(s: Suggestion): string {
  const d = s.data;
  switch (s.id) {
    case 'orcid_ajouter_poste': return [`Organisation : ${d.institution || ''}${d.ror ? ` (ROR ${d.ror})` : ''}`, d.start ? `début : ${d.start}` : ''].filter(Boolean).join(' — ');
    case 'scopus_corriger': return d.reason === 'merged' ? `Le profil compte ${d.docCount ?? '?'} documents, dont beaucoup ne sont pas les vôtres.` : 'Le profil ne mentionne jamais Nantes Université.';
    case 'openalex_fusionner': return `Profils concernés : ${(d.ids || []).map((id) => `https://openalex.org/authors/${id}`).join(' ; ')}`;
    case 'idhal_fusionner':
    case 'scopus_fusionner': return d.detail || '';
    case 'idhal_creer': return d.halDocs ? `${d.halDocs} dépôt(s) HAL trouvé(s) à votre nom.` : '';
    default: return '';
  }
}
