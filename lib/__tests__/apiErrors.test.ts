// Guards the API error translation mechanism (docs/plan-langue-source-en.md, chantier C):
// every `error: '…'` literal sent by server.cjs and functions/ must be declared in
// lib/apiErrors.ts (as a `msg` descriptor, so that Lingui extracts it and locales/fr can
// translate it), and translateApiError() must resolve them through the real French catalog.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { i18n } from '@lingui/core';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';
import PO from 'pofile';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorText, translateApiError } from '../apiErrors';

const ROOT = resolve(__dirname, '../..');

/** Fixed texts declared in lib/apiErrors.ts (msg`…`). */
function declared(): Set<string> {
  const src = readFileSync(join(ROOT, 'lib/apiErrors.ts'), 'utf8');
  return new Set([...src.matchAll(/msg`([^`]+)`/g)].map((m) => m[1]));
}

/** Server error literals: fixed strings, and the head of `Head: ${detail}` templates. */
function serverLiterals(): { file: string; text: string; raw: string; head?: string }[] {
  // server.cjs, functions/, and the shared modules they serve responses from.
  const files = [join(ROOT, 'server.cjs'), join(ROOT, 'scripts/lib/reports_store.cjs'), join(ROOT, 'scripts/lib/reports_ai.cjs')];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|ts)$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, 'functions'));
  walk(join(ROOT, 'lib/directory'));   // domain API (/api/v1), served by server.cjs and functions/
  const out: { file: string; text: string; raw: string; head?: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\berror: (['"])((?:\\.|(?!\1).)*)\1/g)) out.push({ file, text: m[2].replace(/\\(['"])/g, '$1'), raw: m[0] });
    // Domain API commands (lib/directory/commands.ts): new ApiError(<status>, '…')
    for (const m of src.matchAll(/\bnew ApiError\(\d+, (['"])((?:\\.|(?!\1).)*)\1/g)) {
      // Translated whole, or by its head when it has the `Head: detail` shape (translateApiError).
      const text = m[2].replace(/\\(['"])/g, '$1');
      out.push({ file, text, raw: m[0], head: text.includes(': ') ? text.slice(0, text.indexOf(': ')) : undefined });
    }
    for (const m of src.matchAll(/\berror: `([^`$]*)\$\{/g)) {
      // `Head: detail ${x}` → translated by head (see translateApiError)
      const head = m[1].includes(': ') ? m[1].slice(0, m[1].indexOf(': ')) : m[1].replace(/:\s*$/, '').trim();
      out.push({ file, text: head, raw: m[0] });
    }
  }
  return out;
}

// Admin-only diagnostics whose variable part comes first (not translatable by head).
const IGNORED = new Set(['Cannot write']);

describe('API error catalog', () => {
  it('declares every error literal of server.cjs, functions/ and the shared server modules', () => {
    const known = declared();
    const missing = serverLiterals()
      .filter((l) => l.text && !IGNORED.has(l.text) && !known.has(l.text) && !(l.head && known.has(l.head)))
      .map((l) => `${l.file.replace(ROOT + '/', '')}: ${l.raw}`);
    expect(missing, `Undeclared server error messages:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('translateApiError', () => {
  beforeAll(() => {
    // Load the real French catalog the way the Vite plugin would compile it.
    const po = PO.parse(readFileSync(join(ROOT, 'locales/fr/messages.po'), 'utf8'));
    const messages: Record<string, string> = {};
    for (const it of po.items) if (it.msgid && it.msgstr[0]) messages[generateMessageId(it.msgid, it.msgctxt || undefined)] = it.msgstr[0];
    i18n.load('fr', messages);
    i18n.activate('fr');
  });
  afterAll(() => i18n.activate('en'));

  it('translates a known message', () => {
    expect(translateApiError('Unauthorized')).toBe('Non authentifié');
    expect(translateApiError('An LDAP synchronization is already running')).toBe('Une synchronisation LDAP est déjà en cours');
  });
  it('translates the head of a "Head: detail" message and keeps the detail', () => {
    expect(translateApiError('Unknown alignment source: foo')).toBe("Source d'alignement inconnue: foo");
    expect(translateApiError('Generation failed: upstream 502')).toBe('Échec de la génération: upstream 502');
  });
  it('returns unknown texts unchanged', () => {
    expect(translateApiError('Something else: detail')).toBe('Something else: detail');
    expect(translateApiError('')).toBe('');
  });
  it('apiErrorText accepts any thrown value', () => {
    expect(apiErrorText(new Error('Forbidden'))).toBe('Accès interdit');
    expect(apiErrorText('Forbidden')).toBe('Accès interdit');
    expect(apiErrorText({ message: 'Forbidden' })).toBe('Accès interdit');
    expect(apiErrorText(null)).toBe('');
  });
});
