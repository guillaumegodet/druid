// Source of the identifiers a write brings (lib/directory/pg/identifierProvenance.ts, lot 4 b of the provenance plan).
import { describe, expect, it } from 'vitest';
import { identifierSourceOf } from '../directory/pg/identifierProvenance';

describe('identifierSourceOf', () => {
  it('the caller\'s source first, then the alignment trace of the write, then the author', () => {
    expect(identifierSourceOf(['ORCID', 'ORCID_derniere_maj'], 'lab_file', true)).toBe('lab_file');
    expect(identifierSourceOf(['OpenAlex_ids', 'OpenAlex_derniere_maj'], undefined, false)).toBe('align:openalex');
    expect(identifierSourceOf(['IdHAL_i', 'HAL_derniere_maj'], undefined, true)).toBe('align:hal');
    // The LDAP trace is not an identifier alignment.
    expect(identifierSourceOf(['ORCID', 'LDAP_derniere_maj'], undefined, true)).toBe('manual');
    expect(identifierSourceOf(['ORCID'], undefined, false)).toBe('job');
  });
});
