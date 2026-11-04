import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Who sees what in the people list header: the Synchronize menu needs the realm role, whereas the members of the
// /NantesUniversite/admin group (super admins, no realm role) still reach « To process » and « New ».
const rights = vi.hoisted(() => ({ superAdmin: false, realmAdmin: false, establishment: false }));

vi.mock('../auth', () => ({
  isSuperAdmin: () => rights.superAdmin,
  hasRole: (role: string) => role === 'admin' && rights.realmAdmin,
  canUseEstablishmentTools: () => rights.establishment,
}));
vi.mock('../../components/HelpButton', () => ({ HelpButton: () => null }));
vi.mock('../exportService', () => ({ ExportService: {} }));

const { ListHeader } = await import('../../components/researchers/ListHeader');

const noop = () => {};
const NEW = /\bNew<\/button>/;

const render = (handlers: { onOpenDuplicates?: () => void; onNewResearcher?: () => void }) =>
  renderToStaticMarkup(
    createElement(I18nProvider, { i18n },
      createElement(ListHeader, {
        count: 0, loading: false, showSyncMenu: false, sortedResearchers: [],
        onToggleSyncMenu: noop, onCloseSyncMenu: noop, onOpenAbesExport: noop, ...handlers,
      })),
  );

describe('ListHeader rights', () => {
  beforeEach(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} });
    Object.assign(rights, { superAdmin: false, realmAdmin: false, establishment: false });
  });

  it('shows To process and New to a super admin without the realm role, not Synchronise', () => {
    Object.assign(rights, { superAdmin: true, establishment: true });
    const html = render({ onOpenDuplicates: noop, onNewResearcher: noop });
    expect(html).toContain('To process');
    expect(html).toMatch(NEW);
    expect(html).not.toContain('Synchronise');
  });

  it('shows everything to a super admin with the realm role', () => {
    Object.assign(rights, { superAdmin: true, realmAdmin: true, establishment: true });
    const html = render({ onOpenDuplicates: noop, onNewResearcher: noop });
    expect(html).toMatch(NEW);
    for (const label of ['Synchronise', 'To process']) expect(html).toContain(label);
  });

  it('keeps New and Synchronise for the realm role with an institution right', () => {
    Object.assign(rights, { realmAdmin: true, establishment: true });
    const html = render({ onNewResearcher: noop });
    expect(html).toMatch(NEW);
    expect(html).toContain('Synchronise');
    expect(html).not.toContain('To process');
  });

  it('hides them from an institution viewer and from a lab viewer, whatever handler the caller passes', () => {
    rights.establishment = true;
    expect(render({ onNewResearcher: noop })).not.toMatch(NEW);
    rights.establishment = false;
    const html = render({ onNewResearcher: noop });
    expect(html).not.toMatch(NEW);
    expect(html).not.toContain('Synchronise');
  });

  it('hides New on a read-only instance, where the caller passes no handler', () => {
    Object.assign(rights, { superAdmin: true, establishment: true });
    expect(render({ onOpenDuplicates: noop })).not.toMatch(NEW);
  });
});
