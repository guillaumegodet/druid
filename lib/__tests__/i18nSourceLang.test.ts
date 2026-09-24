// Guards the "UI source strings in English" convention (docs/i18n.md, docs/conventions.md):
// every msgid of the source catalog locales/en/messages.po must read as English. Uses the
// same heuristic as the comment checker (accents, French quotes, French function words).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import PO from 'pofile';
import { isFrench } from '../../scripts/tests/check_comments_lang.cjs';

// Deliberately French in the English UI, or false positives of the heuristic
// (a French data sample used as placeholder, an accented loanword).
const ALLOWED = new Set([
  'Passer en français',
  'Laboratoire de Psychologie des Pays de la Loire',
]);
const FALSE_POSITIVE = /grande école/;

describe('Lingui source catalog', () => {
  it('has English msgids only', () => {
    const po = PO.parse(readFileSync(resolve(__dirname, '../../locales/en/messages.po'), 'utf8'));
    const french = po.items
      .filter((it) => it.msgid && !ALLOWED.has(it.msgid) && !FALSE_POSITIVE.test(it.msgid) && isFrench(it.msgid))
      .map((it) => `${it.references[0] ?? '?'}: ${it.msgid.slice(0, 120)}`);
    expect(french, `French source strings remain:\n${french.join('\n')}`).toEqual([]);
  });
  it('has a French translation for every message', () => {
    const po = PO.parse(readFileSync(resolve(__dirname, '../../locales/fr/messages.po'), 'utf8'));
    const missing = po.items.filter((it) => it.msgid && !it.msgstr[0]).map((it) => it.msgid.slice(0, 120));
    expect(missing, `Untranslated messages in locales/fr:\n${missing.join('\n')}`).toEqual([]);
  });
});
