import { describe, expect, it } from 'vitest';
import { htmlToText, parsePortalListingTopic, portalListingObjects, programmeOfPortalTopic, splitDescription } from '../calls/ftPortal';

const listingObject = (identifier: string, extra: Record<string, unknown> = {}) => ({
  type: 1, identifier, title: ` Title of ${identifier} `, callIdentifier: 'HORIZON-CL6-2026-04', callTitle: 'Call 04',
  frameworkProgramme: { id: 1, abbreviation: 'HORIZON', description: 'Horizon Europe (HORIZON)' },
  programmeDivision: [{ abbreviation: 'HORIZON.2.6.3' }, { abbreviation: 'HORIZON.2' }],
  status: { id: 31094502, abbreviation: 'Open', description: 'Open' },
  deadlineDatesLong: [1795651200000], plannedOpeningDateLong: 1787616000000,
  keywords: ['Data', ''], topicActions: [{ abbreviation: 'HORIZON-COFUND' }],
  ...extra,
});

describe('parsePortalListingTopic', () => {
  it('reads a grant topic and ignores the other object types', () => {
    const t = parsePortalListingTopic(listingObject('HORIZON-CL6-2026-04-GOVERNANCE-01'));
    expect(t).toEqual({
      identifier: 'HORIZON-CL6-2026-04-GOVERNANCE-01', title: 'Title of HORIZON-CL6-2026-04-GOVERNANCE-01', callIdentifier: 'HORIZON-CL6-2026-04', callTitle: 'Call 04',
      framework: 'HORIZON', divisions: ['HORIZON.2.6.3', 'HORIZON.2'], status: 'open', deadlines: ['2026-11-26'], openingDate: '2026-08-25',
      keywords: ['Data'], typesOfAction: ['HORIZON-COFUND'],
    });
    expect(parsePortalListingTopic(listingObject('X', { type: 2 }))).toBeNull();
    expect(parsePortalListingTopic({ type: 1 })).toBeNull();
    expect(parsePortalListingTopic(null)).toBeNull();
  });
  it('maps the statuses and tolerates missing dates', () => {
    expect(parsePortalListingTopic(listingObject('A', { status: { abbreviation: 'Forthcoming' }, deadlineDatesLong: undefined, plannedOpeningDateLong: null }))).toMatchObject({ status: 'forthcoming', deadlines: [], openingDate: null });
    expect(parsePortalListingTopic(listingObject('A', { status: { abbreviation: 'Closed' } }))?.status).toBe('closed');
    expect(parsePortalListingTopic(listingObject('A', { status: {} }))?.status).toBe('unknown');
  });
});

describe('portalListingObjects', () => {
  const collect = async (chunks: (string | Uint8Array)[]) => {
    const out: string[] = [];
    for await (const o of portalListingObjects((async function* () { for (const c of chunks) yield c; })())) out.push(o);
    return out;
  };
  it('yields every object of the array whatever the chunking, braces inside strings included', async () => {
    const a = { identifier: 'A', title: 'brace { in } string "quoted \\" too"', nested: { deep: [1, { x: ']' }] } };
    const b = { identifier: 'B', list: [] };
    const text = JSON.stringify({ fundingData: { GrantTenderObj: [a, b] } });
    for (const size of [1, 7, 50, text.length]) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      const out = await collect(chunks);
      expect(out.map((o) => JSON.parse(o))).toEqual([a, b]);
    }
  });
  it('decodes UTF-8 bytes split across chunks', async () => {
    const text = JSON.stringify({ fundingData: { GrantTenderObj: [{ identifier: 'É', title: 'Marie Skłodowska-Curie' }] } });
    const bytes = new TextEncoder().encode(text);
    const out = await collect([bytes.slice(0, 40), bytes.slice(40, 41), bytes.slice(41)]);
    expect(JSON.parse(out[0])).toEqual({ identifier: 'É', title: 'Marie Skłodowska-Curie' });
  });
});

describe('programmeOfPortalTopic', () => {
  const horizon = (identifier: string) => programmeOfPortalTopic({ identifier, framework: 'HORIZON' });
  it('splits Horizon Europe the way a research office reads it', () => {
    expect(horizon('HORIZON-CL4-2026-03-DIGITAL-01')).toEqual({ programmeId: 'horizon-europe', subset: 'CL4', scheme: '' });
    expect(horizon('ERC-2027-COG')).toEqual({ programmeId: 'erc', subset: 'CoG', scheme: 'ERC-CoG' });
    expect(horizon('ERC-2026-POC')).toEqual({ programmeId: 'erc', subset: 'PoC', scheme: 'ERC-PoC' });
    expect(horizon('HORIZON-MSCA-2026-DN-01-01')).toEqual({ programmeId: 'msca', subset: 'DN', scheme: 'MSCA-DN' });
    expect(horizon('HORIZON-MSCA-2026-PF-01-01')).toEqual({ programmeId: 'msca', subset: 'PF', scheme: 'MSCA-PF' });
    expect(horizon('HORIZON-EIC-2026-PATHFINDEROPEN-01')).toEqual({ programmeId: 'eic', subset: 'Pathfinder', scheme: 'EIC-Pathfinder' });
    expect(horizon('HORIZON-EIC-2026-ACCELERATOR-01')).toEqual({ programmeId: 'eic', subset: 'Accelerator', scheme: 'EIC-Accelerator' });
    expect(horizon('HORIZON-MISS-2026-07-CROSS-04')).toEqual({ programmeId: 'horizon-missions', subset: 'CROSS', scheme: '' });
    expect(horizon('HORIZON-MISS-2026-CANCER-01')).toEqual({ programmeId: 'horizon-missions', subset: 'CANCER', scheme: '' });
    expect(horizon('HORIZON-INFRA-2026-TECH-01')).toEqual({ programmeId: 'horizon-infra', subset: 'TECH', scheme: '' });
    expect(horizon('HORIZON-WIDERA-2027-04-WIDENING-01')).toEqual({ programmeId: 'horizon-widera', subset: 'WIDENING', scheme: '' });
    expect(horizon('HORIZON-EIE-2027-02-CONNECT-01')).toEqual({ programmeId: 'horizon-eie', subset: '', scheme: '' });
    expect(horizon('HORIZON-JU-CLEANH2-2026-01-01')).toEqual({ programmeId: 'horizon-ju', subset: 'CLEANH2', scheme: '' });
    expect(horizon('HORIZON-EUSPA-2026-SPACE-01')).toBeNull();
  });
  it('maps the other framework programmes by abbreviation and ignores the unknown ones', () => {
    expect(programmeOfPortalTopic({ identifier: 'HORIZON-EURATOM-2027-01-01', framework: 'EURATOM2027' })).toEqual({ programmeId: 'euratom', subset: '', scheme: '' });
    expect(programmeOfPortalTopic({ identifier: 'DIGITAL-JU-CHIPS-2026-AI1-SG', framework: 'DIGITAL' })?.programmeId).toBe('digital-europe');
    expect(programmeOfPortalTopic({ identifier: 'LIFE-2026-SAP-NAT', framework: 'LIFE2027' })?.programmeId).toBe('life');
    expect(programmeOfPortalTopic({ identifier: 'H2020-X', framework: 'H2020' })).toBeNull();
    expect(programmeOfPortalTopic({ identifier: 'I3-2026-INV1', framework: 'I3' })).toBeNull();
  });
});

describe('htmlToText / splitDescription', () => {
  it('turns blocks into lines, items into dashes, decodes entities', () => {
    expect(htmlToText('<p>A &amp; B&nbsp;C</p><ul><li>one</li><li>two &#39;x&#x27;</li></ul><p>End<br>line</p>')).toBe('A & B C\n- one\n- two \'x\'\nEnd\nline');
  });
  it('separates the expected outcome and the scope of a Horizon topic', () => {
    const { objectives, scope } = splitDescription('<p class="topicdescriptionkind">Expected Outcome:</p><p>Outcome text.</p><p class="topicdescriptionkind">Scope:</p><p>Scope text.</p><p>More scope.</p>');
    expect(objectives).toBe('Outcome text.');
    expect(scope).toBe('Scope text.\nMore scope.');
  });
  it('keeps a description without sections whole as objectives', () => {
    expect(splitDescription('<p>Single text.</p>')).toEqual({ objectives: 'Single text.', scope: '' });
    expect(splitDescription('')).toEqual({ objectives: '', scope: '' });
  });
});
