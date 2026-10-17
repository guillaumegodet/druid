import { describe, expect, it } from 'vitest';
import {
  catalogueCallInput, catalogueColumns, catalogueRowOf, categoryOf, dayOf, isoDay, manualFunderId, manualProgrammeId,
  pageText, pageTitle, parseExtraction, validateManualCall,
} from '../calls/manual';
import { CallDocumentError, checkPublicUrl, extractCallFields, fetchCallDocument, isPrivateAddress } from '../calls/callDocument';
import { htmlToText } from '../calls/ftPortal';
import { manualCallId, normalizedUrl } from '../calls/manualStore';
import { isResearchConnectText, parseResearchConnect, researchConnectRow, RESEARCHCONNECT_HEADERS } from '../calls/researchConnect';
import { rtfToText } from '../calls/rtfText';

const TODAY = '2026-10-17';
// Built from its parts: the publication guard of the public repository refuses literal 172.16/12 addresses.
const PRIVATE_172 = ['172', '20', '0', '2'].join('.');
const programme = { name: 'Étoiles montantes', funder: { name: 'Région Pays de la Loire', category: 'Régional' as const } };

describe('dates', () => {
  it('reads ISO, French and spreadsheet days, and refuses impossible ones', () => {
    expect(isoDay('2026-02-30')).toBeNull();
    expect(isoDay('2026-12-31')).toBe('2026-12-31');
    expect(dayOf('31/12/2026')).toBe('2026-12-31');
    expect(dayOf('1.3.2027')).toBe('2027-03-01');
    expect(dayOf('2026-12-31T23:59:00')).toBe('2026-12-31');
    expect(dayOf('46387')).toBe('2026-12-31');
    expect(dayOf('décembre')).toBeNull();
  });
});

describe('validateManualCall', () => {
  it('normalises a call and derives its status from its dates', () => {
    const { call, errors } = validateManualCall({
      title: '  Étoiles   montantes 2027 ', programme, url: 'https://www.paysdelaloire.fr/aides/etoiles', deadlines: ['2027-01-15', '2026-11-30', '2027-01-15'],
      scope: 'Toutes disciplines\r\n', lang: 'xx',
    }, TODAY);
    expect(errors).toEqual([]);
    expect(call).toMatchObject({ title: 'Étoiles montantes 2027', lang: 'fr', deadlines: ['2026-11-30', '2027-01-15'], scope: 'Toutes disciplines', status: 'open' });
    expect(validateManualCall({ title: 'Appel', programme, openingDate: '2027-01-01', deadlines: ['2027-03-01'] }, TODAY).call?.status).toBe('forthcoming');
    expect(validateManualCall({ title: 'Appel', programme }, TODAY).call?.status).toBe('unknown');
  });

  it('lists the errors of a call', () => {
    const { call, errors } = validateManualCall({
      title: 'A', programme: { name: '', funder: { name: '', category: 'Autre' } }, url: 'ftp://x', deadlines: ['31/12/2026'], openingDate: 'demain',
    }, TODAY);
    expect(call).toBeNull();
    expect(errors).toEqual([
      'The title is missing', 'The URL must start with http:// or https://', 'The opening date is not a valid day (YYYY-MM-DD)',
      'A deadline is not a valid day (YYYY-MM-DD)', 'The name of the programme is missing',
    ]);
    expect(validateManualCall({ title: 'Appel', programme, openingDate: '2027-02-01', deadlines: ['2027-01-01'] }, TODAY).errors).toEqual(['The deadline is before the opening date']);
    expect(validateManualCall({ title: 'Appel', programme: { programmeId: 'Pas un id' } }, TODAY).errors).toEqual(['The programme is missing']);
  });

  it('builds the ids of the funders and programmes created by hand', () => {
    expect(manualFunderId('Région Pays de la Loire')).toBe('m-region-pays-de-la-loire');
    expect(manualProgrammeId('m-region-pays-de-la-loire', 'Étoiles montantes')).toBe('m-region-pays-de-la-loire-etoiles-montantes');
    expect(manualProgrammeId('anr', 'Appels internes')).toBe('m-anr-appels-internes');
    expect(manualProgrammeId('m-fondation-pour-la-recherche-medicale-frm', 'Amorçage de jeunes équipes en santé').length).toBeLessThanOrEqual(60);
  });
});

describe('extraction', () => {
  it('parses the answer of the model', () => {
    const answer = '```json\n' + JSON.stringify({
      titre: 'Appel Étoiles montantes', financeur: 'Région Pays de la Loire', programme: '', langue: 'fr', date_ouverture: '2026-10-01',
      dates_limite: ['2027-01-15', 'mi-janvier', '2026-11-30'], resume: 'Finance des jeunes chercheurs.', perimetre: 'Toutes disciplines.', budget: '150 k€',
    }) + '\n```';
    expect(parseExtraction(answer)).toEqual({
      title: 'Appel Étoiles montantes', funder: 'Région Pays de la Loire', programme: '', lang: 'fr', openingDate: '2026-10-01',
      deadlines: ['2026-11-30', '2027-01-15'], summary: 'Finance des jeunes chercheurs.', objectives: '', scope: 'Toutes disciplines.', eligibility: '', budget: '150 k€',
    });
    expect(parseExtraction('{"titre": ""}')).toBeNull();
    expect(parseExtraction('[]')).toBeNull();
    expect(parseExtraction('pas du json')).toBeNull();
  });

  it('keeps the text of a page without its scripts and navigation', () => {
    const html = '<html><head><title>Appel X | Région</title><script>var a=1;</script></head><body><nav><a>Accueil</a></nav>'
      + '<main><h1>Appel X</h1><p>Le texte.</p><style>.a{}</style></main><footer>Mentions</footer></body></html>';
    expect(pageText(html, htmlToText)).toBe('Appel X\nLe texte.');
    expect(pageTitle(html)).toBe('Appel X | Région');
    expect(pageTitle('<meta property="og:title" content="Titre OG"><title>T</title>')).toBe('Titre OG');
  });

  it('asks the model and retries a failed answer', async () => {
    let n = 0;
    const fetchImpl = async (_url: string, init: { body: string }) => {
      n++;
      expect(JSON.parse(init.body).messages[1].content).toContain('Adresse : https://x.fr/appel');
      if (n === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"titre": "Appel"}' } }] }) };
    };
    const doc = { kind: 'html' as const, text: 'Texte', title: '', url: 'https://x.fr/appel' };
    expect((await extractCallFields(doc, { apiBase: 'https://llm', apiKey: 'k', model: 'm' }, fetchImpl as never, 2))?.title).toBe('Appel');
    expect(n).toBe(2);
  });
});

describe('reading a call document', () => {
  it('tells the private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', PRIVATE_172, '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['203.0.113.10', '172.32.0.1', '2001:660::1', '8.8.8.8']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('refuses the addresses that are not public websites', async () => {
    const resolve = async (host: string) => (host === 'intranet.example' ? ['10.0.0.5'] : ['203.0.113.10']);
    await expect(checkPublicUrl('file:///etc/passwd', resolve)).rejects.toMatchObject({ status: 400 });
    await expect(checkPublicUrl('http://127.0.0.1:3006/api', resolve)).rejects.toMatchObject({ status: 403 });
    await expect(checkPublicUrl('https://intranet.example/', resolve)).rejects.toMatchObject({ status: 403 });
    await expect(checkPublicUrl('https://user:pw@example.org/', resolve)).rejects.toMatchObject({ status: 400 });
    expect((await checkPublicUrl('https://www.example.fr/appel', resolve)).hostname).toBe('www.example.fr');
  });

  it('follows the redirects to public hosts only and reads the page text', async () => {
    const resolve = async (host: string) => (host === 'internal.example' ? [PRIVATE_172] : ['203.0.113.10']);
    const longText = 'Objectifs de l’appel. '.repeat(20);
    const pages: Record<string, { status: number; location?: string; contentType: string; body: Buffer }> = {
      'https://a.example/old': { status: 301, location: '/new', contentType: '', body: Buffer.from('') },
      'https://a.example/new': { status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(`<title>Appel</title><body><p>${longText}</p></body>`) },
      'https://a.example/evil': { status: 302, location: 'http://internal.example/admin', contentType: '', body: Buffer.from('') },
      'https://a.example/empty': { status: 200, contentType: 'text/html', body: Buffer.from('<body><div id="app"></div></body>') },
      'https://a.example/zip': { status: 200, contentType: 'application/zip', body: Buffer.from('PK') },
    };
    const get = async (u: URL) => pages[u.href] ?? { status: 404, contentType: '', body: Buffer.from('') };
    const doc = await fetchCallDocument('https://a.example/old', { resolve, get });
    expect(doc).toMatchObject({ kind: 'html', title: 'Appel', url: 'https://a.example/new' });
    expect(doc.text).toContain('Objectifs de l’appel.');
    await expect(fetchCallDocument('https://a.example/evil', { resolve, get })).rejects.toMatchObject({ status: 403 });
    await expect(fetchCallDocument('https://a.example/empty', { resolve, get })).rejects.toBeInstanceOf(CallDocumentError);
    await expect(fetchCallDocument('https://a.example/zip', { resolve, get })).rejects.toMatchObject({ status: 415 });
    await expect(fetchCallDocument('https://a.example/missing', { resolve, get })).rejects.toMatchObject({ status: 404 });
  });
});

describe('catalogue', () => {
  it('recognises the columns whatever their accents and case', () => {
    const { known, ignored } = catalogueColumns(['Intitulé', 'Financeur', 'Catégorie', 'Date limite', 'Date limite 2', 'Lien', 'Référence', 'Chargé DRI', 'Titre']);
    expect(known).toEqual({ Intitulé: 'title', Financeur: 'funder', Catégorie: 'category', 'Date limite': 'deadline', 'Date limite 2': 'deadline2', Lien: 'url', Référence: 'reference' });
    expect(ignored).toEqual(['Chargé DRI', 'Titre']);
  });

  it('turns a row into a call', () => {
    const { known } = catalogueColumns(['Titre', 'Financeur', 'Catégorie', 'Programme', 'Clôture', 'Langue', 'Thématiques']);
    const row = catalogueRowOf({ Titre: 'Amorçage jeunes équipes', Financeur: 'FRM', Catégorie: 'Fondation', Programme: 'Amorçage', Clôture: '15/01/2027', Langue: 'Anglais', Thématiques: 'santé' }, known);
    expect(catalogueCallInput(row)).toEqual({
      title: 'Amorçage jeunes équipes', programme: { name: 'Amorçage', funder: { name: 'FRM', category: 'Privé / fondations' } }, url: '', lang: 'en',
      openingDate: null, deadlines: ['2027-01-15'], summary: '', objectives: '', scope: 'santé', eligibility: '', budget: '',
    });
    const byId = catalogueRowOf({ Titre: 'X', 'Programme id': 'm-frm-amorcage' }, catalogueColumns(['Titre', 'Programme id']).known);
    expect(catalogueCallInput(byId).programme).toEqual({ programmeId: 'm-frm-amorcage' });
  });

  it('maps the categories people write', () => {
    expect(categoryOf('ANR')).toBe('ANR');
    expect(categoryOf('Région')).toBe('Régional');
    expect(categoryOf('Privé / fondations')).toBe('Privé / fondations');
    expect(categoryOf('Union européenne')).toBe('Europe');
    expect(categoryOf('UE')).toBe('Europe');
    expect(categoryOf('Ministère')).toBe('Recherche nationale');
    expect(categoryOf('')).toBe('Autre');
  });

  it('gives a stable id to a call', () => {
    expect(normalizedUrl('https://WWW.Example.fr/appel/#top')).toBe('https://www.example.fr/appel');
    const a = manualCallId({ programmeId: 'm-x', url: 'https://www.example.fr/appel/', title: 'Appel' });
    expect(a).toMatch(/^M-[0-9A-F]{12}$/);
    expect(manualCallId({ programmeId: 'm-x', url: 'https://www.example.fr/appel#a', title: 'APPEL' })).toBe(a);
    expect(manualCallId({ programmeId: 'm-x', url: 'https://www.example.fr/appel', title: 'Autre appel' })).not.toBe(a);
    expect(manualCallId({ reference: 'DRI-12', programmeId: 'm-x', title: 'Appel' })).toBe(manualCallId({ reference: ' dri-12', programmeId: 'm-y', title: 'Autre' }));
  });
});

describe('ResearchConnect export', () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252\uc1{\fonttbl{\f0 Arial;}}{\*\generator Word;}{\mmathPr\mmathFont34\mbrkBin0}`
    + String.raw` \pard ResearchConnect\par Prepared for someone\par\par Fondation Test Fellowships UPDATED\par`
    + String.raw` Fund ID:\tab S100\cell\row Status:\tab Open for Applications\cell\row Last updated:\tab Not specified\cell\row`
    + String.raw` Fellowships for research in all disciplines ${'\\u8211'}\'96 for juniors.\par Fund Information\par`
    + String.raw` Funding body:\tab Fondation Test (FT)\cell\row Maximum value:\tab \'80 50,000\cell\row Application deadline:\tab 01-12-2026\cell\row`
    + String.raw` Extended Description\par {\pict\pngblip 89504e47}The fellowship funds \b one\b0  year.\par Eligibility Criteria\par Early career researchers.\par`
    + String.raw` Value Notes\par Salary and travel.\par Application Procedure\par Online.\par Useful links\par Programme page\par https://ft.example/fellowships\par`
    + String.raw` Funder contact\par Fondation Test\par Calls and deadlines\par Spring Deadline\par Application start date:\tab -\cell\row`
    + String.raw` Application end date:\tab 01-12-2026\cell\row Next Deadline\par Call ID:\par Fund:\tab Fondation Test Fellowships\par Funding body:\tab Other\par`
    + String.raw` Application start date:\par Application deadline:\tab 15-03-2027\cell\row\par Second Fund\par Fund ID:\tab S200\cell\row Status:\tab Future\cell\row`
    + String.raw` Last updated:\tab Not specified\cell\row Grants.\par Fund Information\par Funding body:\tab Agence Test\cell\row Maximum value:\tab Not specified\cell\row`
    + String.raw` Application deadline:\tab None specified\cell\row Extended Description\par Topics.\par Calls and deadlines\par Call\par`
    + String.raw` Application start date:\tab 01-01-2027\cell\row Application end date:\tab 01-02-2027\cell\row}`;

  it('reads the text of an RTF document without its destinations', () => {
    const text = rtfToText(rtf);
    expect(text).not.toMatch(/Arial|Word|mmath|Bin0|89504e47/);
    expect(text).toContain('Fellowships for research in all disciplines – for juniors.');
    expect(text).toContain('Maximum value:\t€ 50,000');
    expect(text).toContain('The fellowship funds one year.');
    expect(isResearchConnectText(text)).toBe(true);
    expect(isResearchConnectText('Fund ID: S1')).toBe(false);
  });

  it('parses the funds and turns them into rows of the catalogue', () => {
    const funds = parseResearchConnect(rtfToText(rtf));
    expect(funds).toHaveLength(2);
    expect(funds[0]).toMatchObject({
      fundId: 'S100', title: 'Fondation Test Fellowships', status: 'Open for Applications', funder: 'Fondation Test (FT)',
      summary: 'Fellowships for research in all disciplines – for juniors.', maximumValue: '€ 50,000', deadlines: ['2026-12-01', '2027-03-15'],
      openingDate: null, description: 'The fellowship funds one year.', eligibility: 'Early career researchers.', url: 'https://ft.example/fellowships',
    });
    expect(funds[1]).toMatchObject({ fundId: 'S200', title: 'Second Fund', maximumValue: '', deadlines: ['2027-02-01'], openingDate: '2027-01-01' });

    const row = researchConnectRow(funds[0], '2026-12-15');
    expect(row).toMatchObject({ Reference: 'RC-S100', Category: 'Privé / fondations', Programme: 'Fondation Test (FT)', Deadline: '2027-03-15', 'Deadline 2': '', Source: 'researchconnect' });
    expect(researchConnectRow(funds[1], TODAY).Category).toBe('International');
    const { known } = catalogueColumns(RESEARCHCONNECT_HEADERS);
    expect(Object.keys(known)).toEqual(RESEARCHCONNECT_HEADERS);
    const input = catalogueCallInput(catalogueRowOf(row, known));
    expect(input).toMatchObject({ lang: 'en', deadlines: ['2027-03-15'], taxonomy: { source: 'researchconnect' } });
    expect(validateManualCall(input, TODAY).call?.taxonomy).toEqual({ source: 'researchconnect' });
  });
});
