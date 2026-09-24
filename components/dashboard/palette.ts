// Dashboard dataviz palette — derived from the 2026 redesign tokens
// (tailwind.config.js) then VALIDATED with the dataviz skill validator
// (OKLCH luminance band, chroma floor, color-blindness separation
// Machado adjacent ΔE ≥ 12, contrast ≥ 3:1 vs surface):
//   light : surface #f9f6ef (white/60 card on cream background) — 4 PASS
//   dark  : surface #2b2a26 (white/5 card on #201e1a background) — 4 PASS
// The slot order is the color-blindness safety mechanism: do not
// reorder it without re-validating.

export interface VizTheme {
  /** Categorical slots, fixed order (never cycled beyond 8: fold into « Autres »). */
  series: string[];
  /** Chrome inks (text, axes, grids). */
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  grid: string;
  axis: string;
  /** Tooltip background and separator border between segments (surface color). */
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
  /**
   * Sequential ramp (magnitude): a single hue (the blue of slot 4),
   * from closest to the surface to most contrasted — the anchor flips in dark mode.
   * For visualMap (choropleth, heatmap) and bar gradients.
   */
  seqRamp: string[];
  /** "No data" fill of the maps (polygon background) + coastline. */
  mapArea: string;
  mapBorder: string;
}

export const VIZ_LIGHT: VizTheme = {
  series: ['#7048e8', '#ab7f10', '#2ea066', '#3b5bdb', '#d2600e', '#0a9191', '#c94d76', '#b23b3b'],
  ink: '#1c1b19',
  inkSecondary: '#6f6a5e',
  inkMuted: '#8c8677',
  grid: '#e7e3d8',
  axis: '#cfcabd',
  surface: '#f9f6ef',
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(28,27,25,0.10)',
  seqRamp: ['#e6ebfb', '#98aaf0', '#3b5bdb', '#1d2d6b'],
  mapArea: '#efece1',
  mapBorder: '#d8d3c4',
};

export const VIZ_DARK: VizTheme = {
  series: ['#8e6ffa', '#b98a16', '#2ea066', '#5c7cfa', '#dd6614', '#1da3a3', '#d95a89', '#d64545'],
  ink: '#f5f2ea',
  inkSecondary: '#c3beb0',
  inkMuted: '#8f897c',
  grid: '#3a3833',
  axis: '#4a4740',
  surface: '#2b2a26',
  tooltipBg: '#33312c',
  tooltipBorder: 'rgba(255,255,255,0.12)',
  seqRamp: ['#23283b', '#3a4f9e', '#5c7cfa', '#b9c7ff'],
  mapArea: '#35332d',
  mapBorder: '#4a4740',
};

/**
 * Open Access status colors — domain convention (gold, green, bronze…),
 * mapped onto the validated slots of the current mode's palette.
 */
export function oaColors(t: VizTheme): Record<string, string> {
  return {
    diamond: t.series[5], // cyan
    gold: t.series[1],    // gold
    green: t.series[2],   // green
    hybrid: t.series[0],  // purple
    bronze: t.series[4],  // orange
    closed: t.series[7],  // red
    unknown: '#8c8677',   // neutral gray (outside the categorical palette, "unknown" value)
  };
}
