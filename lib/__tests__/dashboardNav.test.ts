import { describe, expect, it } from 'vitest';
import { DASHBOARD_FAMILIES, DASHBOARD_TABS, familyOf, isDashboardTab, visibleFamilies } from '../../components/dashboard/dashboardNav';
import { visibleTabKeys } from '../../components/dashboard/tabAvailability';
import { REPORT_SECTIONS } from '../../components/dashboard/report/reportCatalog';

describe('dashboard families', () => {
  it('lists every leaf once, the overview first, under seven families', () => {
    const keys = DASHBOARD_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('overview');
    expect(DASHBOARD_FAMILIES).toHaveLength(7);
    expect(familyOf('journals')).toBe('publications');
    expect(familyOf('staff')).toBe('people');
    expect(isDashboardTab('news')).toBe(true);
    expect(isDashboardTab('console')).toBe(false);
    expect(isDashboardTab(null)).toBe(false);
  });

  it('covers every section of the report catalog', () => {
    for (const s of REPORT_SECTIONS) expect(isDashboardTab(s.tab), s.tab).toBe(true);
  });

  it('drops the families left without a visible view and keeps the order', () => {
    const visible = visibleTabKeys(DASHBOARD_TABS.map((t) => t.key), {
      hidden: ['books', 'journals', 'list', 'sources', 'news'], hasAxes: false, hasBenchmark: false, hasStaff: false,
    });
    const fams = visibleFamilies(visible);
    expect(fams.map((f) => f.key)).toEqual(['overview', 'impact', 'collaborations', 'people', 'steering']);
    expect(fams.find((f) => f.key === 'impact')?.tabs.map((t) => t.key)).toEqual(['impact']);
    expect(fams.find((f) => f.key === 'people')?.tabs.map((t) => t.key)).toEqual(['researchers', 'teams', 'phd']);
    expect(fams.find((f) => f.key === 'steering')?.tabs.map((t) => t.key)).toEqual(['funders', 'apc', 'charte']);
  });

  it('shows the headcount view only when directory records are matched', () => {
    expect(visibleTabKeys(['overview', 'staff'], { hidden: [], hasAxes: true, hasBenchmark: true })).toEqual(['overview']);
    expect(visibleTabKeys(['overview', 'staff'], { hidden: [], hasAxes: true, hasBenchmark: true, hasStaff: true })).toEqual(['overview', 'staff']);
    expect(visibleTabKeys(['overview', 'staff'], { hidden: ['staff'], hasAxes: true, hasBenchmark: true, hasStaff: true })).toEqual(['overview']);
  });
});
