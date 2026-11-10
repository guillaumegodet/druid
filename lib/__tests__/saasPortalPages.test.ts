// Terms of the operator on the portal (druid-internal docs/plan-druid-saas.md, lot 7): linked where they are accepted
// when the deployment sets SAAS_TERMS_URL / SAAS_PRIVACY_URL, absent otherwise, https only, escaped.
import { describe, expect, it } from 'vitest';
import { assistantPage, homePage, httpsUrlOf, legalNotice } from '../../functions/_lib/portalPages.js';

const legal = { terms: 'https://example.org/conditions', privacy: 'https://example.org/confidentialite' };

describe('terms on the portal', () => {
  it('keeps https URLs only', () => {
    expect(httpsUrlOf('https://example.org/conditions')).toBe('https://example.org/conditions');
    expect(httpsUrlOf('http://example.org/conditions')).toBeNull();
    expect(httpsUrlOf('javascript:alert(1)')).toBeNull();
    expect(httpsUrlOf(undefined)).toBeNull();
  });

  it('links both documents, or only the one that is set, or nothing', () => {
    const both = legalNotice(legal, ['En créant', 'By creating']);
    expect(both).toContain('href="https://example.org/conditions"');
    expect(both).toContain('href="https://example.org/confidentialite"');
    expect(both).toMatch(/^<p class="muted">En créant, vous acceptez .+ · By creating, you accept /);
    expect(legalNotice({ terms: legal.terms, privacy: null }, ['A', 'B'])).not.toContain('confidentialite');
    expect(legalNotice({ terms: null, privacy: null }, ['A', 'B'])).toBe('');
    expect(legalNotice(null, ['A', 'B'])).toBe('');
    expect(legalNotice({ terms: 'https://example.org/a"b' }, ['A', 'B'])).toContain('href="https://example.org/a&quot;b"');
  });

  it('shows them on the sign-in form and before the creation', () => {
    expect(homePage({ email: null, tenants: [], sent: false, reason: '', baseDomain: 'example.org', legal })).toContain('En demandant un lien, vous acceptez');
    expect(assistantPage({ email: 'a@example.org', baseDomain: 'example.org', legal })).toContain('En créant ce Druid pour votre établissement, vous acceptez');
    expect(homePage({ email: null, tenants: [], sent: false, reason: '', baseDomain: 'example.org' })).not.toContain('vous acceptez');
  });
});
