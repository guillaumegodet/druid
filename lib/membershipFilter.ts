import type { MembershipType, Researcher } from '../types';

/**
 * @file membershipFilter.ts
 * @description « Membership » filter of the researcher list: lab membership type
 * (Grist column `membership_type`) of the PRIMARY affiliation, like the « Lab » filter —
 * matching any affiliation would let « Lab = X + Associate » return someone who is
 * statutory in X and associate elsewhere.
 */

/** Filter value of the records whose primary affiliation has no membership type. */
export const MEMBERSHIP_NONE = 'none';

/** Membership type of the primary affiliation (undefined when absent or not filled in). */
export const primaryMembershipType = (r: Pick<Researcher, 'affiliations'>): MembershipType | undefined =>
  r.affiliations.find((a) => a.isPrimary)?.membershipType;

/** True when the record matches the selected values (empty selection = no filter). */
export const matchesMembershipFilter = (r: Pick<Researcher, 'affiliations'>, selected: string[]): boolean => {
  if (selected.length === 0) return true;
  return selected.includes(primaryMembershipType(r) ?? MEMBERSHIP_NONE);
};
