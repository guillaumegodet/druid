/**
 * @file planFeatures.ts
 * @description Features a plan may lock (druid-internal docs/plan-druid-saas.md, § 5.2 and lot 6 b): `plan.features.locked`
 * of the control plane lists them. Shared by the API middleware (functions/api/_middleware.js refuses the routes of a
 * locked feature) and the front (a locked entry stays visible with its upgrade note instead of disappearing).
 */
export const PLAN_FEATURES = ['benchmark', 'reports', 'media', 'calls', 'ai'] as const;
export type PlanFeature = typeof PLAN_FEATURES[number];

/** Locked features of a plan row (`features.locked`), unknown names ignored. */
export const lockedFeaturesOf = (plan: { features?: unknown } | null | undefined): PlanFeature[] => {
  const locked = (plan?.features as { locked?: unknown } | undefined)?.locked;
  return Array.isArray(locked) ? locked.filter((f): f is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(f)) : [];
};

/** API routes of a feature: a request on a locked one is refused whatever the front shows. */
const GATED_ROUTES: [prefix: string, feature: PlanFeature][] = [
  ['/api/reports', 'reports'],
  ['/api/report-ai', 'ai'],
  ['/api/calls', 'calls'],
];
export const featureOfApiPath = (pathname: string): PlanFeature | null => {
  for (const [prefix, feature] of GATED_ROUTES) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return feature;
  return null;
};

/** Dashboard tabs of a feature (components/dashboard/dashboardNav.ts keys). */
export const DASHBOARD_TAB_FEATURE: Partial<Record<string, PlanFeature>> = { benchmark: 'benchmark', calls: 'calls' };

/** The first plan (in the order given, cheapest first) that does not lock `feature`. */
export const planUnlocking = <P extends { code: string; features?: unknown }>(plans: P[], feature: PlanFeature): P | null =>
  plans.find((p) => !lockedFeaturesOf(p).includes(feature)) ?? null;
