// Features a plan locks (druid-internal docs/plan-druid-saas.md, lot 6 b): the shared rules of the API middleware and
// of the dashboard.
import { describe, expect, it } from 'vitest';
import { featureOfApiPath, lockedFeaturesOf, planUnlocking } from '../saas/planFeatures';
import { visibleTabKeys } from '../../components/dashboard/tabAvailability';

const TRIAL = { code: 'trial', features: { locked: ['benchmark', 'reports', 'media', 'calls', 'ai', 'nonsense'] } };
const TEAM = { code: 'team', features: { locked: ['benchmark', 'reports'], exports: true } };
const COMPLETE = { code: 'complete', features: { locked: [] } };

describe('plan features', () => {
  it('locked features of a plan, unknown names and odd shapes ignored', () => {
    expect(lockedFeaturesOf(TRIAL)).toEqual(['benchmark', 'reports', 'media', 'calls', 'ai']);
    expect(lockedFeaturesOf(COMPLETE)).toEqual([]);
    expect(lockedFeaturesOf({ features: { locked: 'reports' } })).toEqual([]);
    expect(lockedFeaturesOf(null)).toEqual([]);
  });
  it('API routes of a feature', () => {
    expect(featureOfApiPath('/api/reports')).toBe('reports');
    expect(featureOfApiPath('/api/reports/12/share')).toBe('reports');
    expect(featureOfApiPath('/api/report-ai')).toBe('ai');
    expect(featureOfApiPath('/api/calls/researchers/x')).toBe('calls');
    expect(featureOfApiPath('/api/reportsX')).toBeNull();
    expect(featureOfApiPath('/api/v1/structures')).toBeNull();
  });
  it('the cheapest plan unlocking a feature', () => {
    expect(planUnlocking([TRIAL, TEAM, COMPLETE], 'calls')?.code).toBe('team');
    expect(planUnlocking([TRIAL, TEAM, COMPLETE], 'reports')?.code).toBe('complete');
    expect(planUnlocking([TRIAL], 'reports')).toBeNull();
  });
  it('a locked tab is shown without its data, unless the admin hides it', () => {
    const tabs = ['overview', 'calls', 'benchmark', 'apc'] as const;
    expect(visibleTabKeys(tabs, { hidden: [], hasAxes: false, hasBenchmark: false, hasCalls: false })).toEqual(['overview', 'apc']);
    expect(visibleTabKeys(tabs, { hidden: ['benchmark'], hasAxes: false, hasBenchmark: false, hasCalls: false, locked: ['calls', 'benchmark'] }))
      .toEqual(['overview', 'calls', 'apc']);
  });
});
