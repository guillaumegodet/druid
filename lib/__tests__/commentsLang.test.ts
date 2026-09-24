// Guards the "comments in English" convention (docs/conventions.md) using the
// heuristic scanner in scripts/tests/check_comments_lang.cjs.
//
// Blocking by default since the translation campaign ended
// (docs/archive/plan-traduction-commentaires.md, lot 7): any French comment fails the
// suite. COMMENTS_LANG_STRICT=0 downgrades it to a printed report.
import { describe, expect, it } from 'vitest';
import { scan, isFrench, extractSlashComments, formatTable } from '../../scripts/tests/check_comments_lang.cjs';

const STRICT = process.env.COMMENTS_LANG_STRICT !== '0';

describe('isFrench heuristic', () => {
  it('flags French prose', () => {
    expect(isFrench('Renvoie la liste des chercheurs du labo')).toBe(true);
    expect(isFrench("Fiche Annuaire minimale (mêmes clés que rec.fields côté Grist).")).toBe(true);
    expect(isFrench('cache servi depuis la racine, pas dist/')).toBe(true);
  });
  it('accepts English prose', () => {
    expect(isFrench('Returns the list of researchers for the lab')).toBe(false);
    expect(isFrench('── Auth guard middleware ──')).toBe(false);
    expect(isFrench('TODO: remove once the proxy is gone')).toBe(false);
  });
  it('ignores quoted data values', () => {
    expect(isFrench('Status « Parti » means the person left the institution')).toBe(false);
    expect(isFrench('Grist column "Corps_grade" holds the emeritus code')).toBe(false);
    expect(isFrench('Employment before 2022 at Nantes Université.')).toBe(false);
    expect(isFrench('IdRef is only triggered in search mode — in verify, the « Vérifier les identifiants')).toBe(false);
  });
});

describe('comment extraction', () => {
  it('skips // inside strings and URLs', () => {
    const src = "const u = 'https://example.org//x'; // trailing note\n/* block\n * second */";
    expect(extractSlashComments(src).map((c) => c.text)).toEqual(['trailing note', 'block', 'second']);
  });
});

describe('repository comments', () => {
  it(STRICT ? 'contains no French comment' : 'reports remaining French comments', () => {
    const result = scan();
    if (STRICT) {
      const sample = result.french.slice(0, 20).map((c) => `${c.file}:${c.line}: ${c.text}`).join('\n');
      expect(result.french.length, `French comments remain:\n${sample}`).toBe(0);
    } else {
      console.info(`[comments-lang]\n${formatTable(result)}`);
      expect(result.total).toBeGreaterThan(0);
    }
  });
});
