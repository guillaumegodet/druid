// Alignments through the domain API (druid-internal docs/plan-migration-postgresql.md, lot 2 e): texts computed on the
// server as tokens and localized by the browser, selection rebuilt by the server, rights. Fictitious data.
import { describe, it, expect, vi } from 'vitest';
import { tokenAlignTexts, localizeAlignTokens, AlignTexts } from '../directory/alignTexts';
import { i18nAlignTexts } from '../alignTextsI18n';
import { createGristAlignCommands } from '../directory/alignCommands';
import { createGristDirectoryRepository, GristClient } from '../directory/repository';
import { unifiedFillKey } from '../directory/alignments';

describe('alignment texts', () => {
  it('localizes the tokens of any string of a diff, nested ones included, with the browser texts', () => {
    const detail = [tokenAlignTexts.mergedInto('A1', 'A2'), tokenAlignTexts.gone('A3')].join(', ');
    const diff = {
      rows: [{ conflicts: [
        { reason: tokenAlignTexts.listToFix(), detail: tokenAlignTexts.listToFixDetail(detail) },
        { reason: tokenAlignTexts.recordDeleted(), detail: tokenAlignTexts.recordDeletedDetail('') },
      ] }],
      count: 3,
    };
    expect(JSON.stringify(diff)).not.toContain('merged into');
    const localized = localizeAlignTokens(diff, i18nAlignTexts);
    expect(localized.rows[0].conflicts[0]).toEqual({
      reason: 'List to fix (not written)',
      detail: 'A1 merged into A2, A3 gone → rerun (direct write) or fix OpenAlex_ids',
    });
    expect(localized.rows[0].conflicts[1].detail).toBe('PPN ?: the record no longer exists on IdRef (404) — fix or remove the IdRef from the Annuaire');
    expect(localized.count).toBe(3);
  });

  it('only sends the fields a text needs (no whole cache entry)', () => {
    const entry = { orcid: '0000-0002-1825-0097', candidates: Array(50).fill({ big: 'x'.repeat(100) }) };
    expect(tokenAlignTexts.noProfile(entry).length).toBeLessThan(80);
  });

  it('declares a browser text for every key of the server texts', () => {
    expect(Object.keys(i18nAlignTexts).sort()).toEqual(Object.keys(tokenAlignTexts).sort());
    const keys = Object.keys(tokenAlignTexts) as (keyof AlignTexts)[];
    expect(keys.length).toBe(29);
  });
});

describe('alignment commands', () => {
  const records = [
    { id: 1, fields: { uid_dyna: 'durand-a', Nom: 'Durand', Prenom: 'Alice', LABO: 'LAB-A', ORCID: '' } },
    { id: 2, fields: { uid_dyna: 'martin-b', Nom: 'Martin', Prenom: 'Bruno', LABO: 'LAB-A', ORCID: '' } },
  ];
  const orcidCache = {
    'durand-a': { mode: 'search', status: 'found', best: '0000-0002-1825-0097', queryName: 'DURAND Alice', candidates: [{ orcid: '0000-0002-1825-0097', fullName: 'Alice Durand', score: 'fort', evidence: ['email'] }] },
  };
  const make = (tables: Record<string, any[]> = { Annuaire: records }) => {
    const writes: string[] = [];
    const grist = {
      docUpdatedAt: async () => 'v', tableIds: async () => Object.keys(tables),
      records: async (t: string) => tables[t] || [], columns: async () => [],
      addTables: async (list: any[]) => { for (const t of list) tables[t.id] = []; writes.push(`table ${list.map((t) => t.id)}`); },
      addRecords: async (t: string, recs: any[]) => { writes.push(`add ${t}`); recs.forEach((r, i) => tables[t].push({ id: 100 + i, fields: r.fields })); return recs.map((_, i) => 100 + i); },
      updateRecords: async (t: string, recs: any[]) => { writes.push(`update ${t} ${recs.map((r) => `${r.id}:${Object.keys(r.fields).join('+')}`)}`); },
    } as unknown as GristClient;
    const repository = createGristDirectoryRepository({ grist });
    const align = createGristAlignCommands({
      grist, repository, texts: tokenAlignTexts, hasQualinka: false,
      annuaireColumns: async () => [{ id: 'ORCID', label: 'ORCID', type: 'Text', isFormula: false }, { id: 'ORCID_derniere_maj', label: '', type: 'Text', isFormula: false }],
      caches: { read: async (name) => (name === 'orcid_align_cache' ? orcidCache : null) },
      today: () => '2026-10-08',
    });
    const ctx = (all = true) => ({ scope: { all, labAnchors: all ? [] : ['laba'] }, audit: vi.fn() });
    return { align, writes, ctx, tables };
  };

  it('computes the unified diff and writes only what the server diff proposes for the selection', async () => {
    const { align, writes, ctx } = make();
    const diff = await align.unifiedDiff(['orcid'], 'search', ctx());
    const cell = diff.rows.find((r) => r.id === 'G-1')!.sources.orcid!;
    expect(cell.status).toBe('strong');
    const key = unifiedFillKey('G-1', 'orcid', '0000-0002-1825-0097');
    // An unknown key (forged, or for a row without candidate) writes nothing.
    expect(await align.applySelection({ mode: 'search', selected: [key, unifiedFillKey('G-2', 'orcid', '0000-0000-0000-0000')], chosen: {}, decisions: {} }, ctx()))
      .toEqual({ updated: 1 });
    expect(writes).toEqual(['update Annuaire 1:ORCID+ORCID_derniere_maj+Commentaires']);
  });

  it('keeps the alignments to the institution right and refuses an unknown redirection', async () => {
    const { align, ctx } = make();
    await expect(align.unifiedDiff(['orcid'], 'search', ctx(false))).rejects.toMatchObject({ status: 403 });
    await expect(align.applyRedirection('G-1', '123456789', ctx())).rejects.toMatchObject({ status: 404 });
  });

  it('records a rejection in the review table: the IdRef one is created on the fly, the others need their script', async () => {
    const { align, writes, ctx, tables } = make();
    const row = { id: 'G-1', uid: 'durand-a', displayName: 'DURAND Alice', labo: 'LAB-A' };
    const res = await align.reject({ source: 'idref', row, candidate: { ppn: '123456789', fullName: 'Durand, Alice' } as any, decision: 'Rejeté', note: '' }, ctx());
    expect(res).toEqual({ rejected: 1, tableCreated: true });
    expect(tables.Alignement_IdRef[0].fields).toMatchObject({ uid_dyna: 'durand-a', PPN_candidat: '123456789', Decision: 'Rejeté' });
    expect(writes[0]).toBe('table Alignement_IdRef');
    await expect(align.reject({ source: 'orcid', row, candidate: { id: '0000-0002-1825-0097', ids: {} } as any, decision: 'Rejeté', note: '' }, ctx()))
      .rejects.toMatchObject({ status: 409 });
  });
});
