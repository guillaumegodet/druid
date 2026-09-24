import React, { useMemo } from 'react';
import { DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { keywordFrequencies } from './keywordFrequencies';
import { useVizTheme } from './EChartCard';
import { Trans, useLingui } from '@lingui/react/macro';
import { numberLocale } from '../../lib/i18n';

const MAX_WORDS = 70;

/** Deterministic shuffle (no Math.random: stable rendering across exports). */
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Keyword cloud — port of the Streamlit Plotly cloud in pure HTML:
 * size and color ∝ number of publications (titles + OpenAlex topics,
 * one occurrence per publication, FR/EN stop words excluded).
 */
export const KeywordCloud: React.FC<{
  publications: DashboardPublication[];
  range: YearRange;
  /** Click on a word — opens the publication list (free-text search). */
  onSelect?: (word: string) => void;
}> = ({ publications, range, onSelect }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const freqs = useMemo(
    () => keywordFrequencies(publications, range),
    [publications, range],
  );

  if (freqs.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No text (titles / topics) to generate the keyword cloud.</Trans>
      </div>
    );
  }

  const top = freqs.slice(0, MAX_WORDS);
  const fmax = top[0].count || 1;
  const ramp = t.seqRamp;
  const items = shuffled(
    top.map(({ word, count }) => {
      const s = count / fmax;
      return {
        word,
        count,
        size: Math.round(13 + 42 * Math.pow(s, 0.6)),
        color: ramp[Math.min(ramp.length - 1, 1 + Math.floor(s * (ramp.length - 1)))],
        weight: s > 0.5 ? 700 : 600,
      };
    }),
  );

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
          <Trans>Keyword cloud</Trans>
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>
            Most frequent words in titles and OpenAlex topics (one occurrence per publication, stop words excluded) — size and colour ∝ number of publications.
          </Trans>
        </p>
      </div>
      <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 py-4 leading-none">
        {items.map(({ word, count, size, color, weight }) =>
          onSelect ? (
            <button
              key={word}
              type="button"
              onClick={() => onSelect(word)}
              title={tr`${word}: ${count} publications — open the list`}
              className="font-disp cursor-pointer transition-transform hover:scale-110"
              style={{ fontSize: `${size}px`, color, fontWeight: weight }}
            >
              {word}
            </button>
          ) : (
            <span
              key={word}
              title={tr`${word}: ${count} publications`}
              className="font-disp cursor-default transition-transform hover:scale-110"
              style={{ fontSize: `${size}px`, color, fontWeight: weight }}
            >
              {word}
            </span>
          ),
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted dark:text-[#c3beb0] font-semibold text-[13px]">
          <Trans>Top 25 keywords</Trans>
        </summary>
        <table className="mt-2 text-sm w-full max-w-md">
          <tbody>
            {freqs.slice(0, 25).map(({ word, count }, i) => (
              <tr key={word} className="border-t border-ink/5 dark:border-white/5">
                <td className="py-1 pr-3 text-muted-lighter dark:text-[#8f897c] w-8">{i + 1}</td>
                <td className="py-1 pr-3 text-ink dark:text-[#f5f2ea] font-semibold">{word}</td>
                <td className="py-1 text-muted dark:text-[#c3beb0]">
                  {count.toLocaleString(numberLocale())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
};
