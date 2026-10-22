/**
 * @file onboarding.ts
 * @description Creation of a tenant « in a few clicks » (druid-internal docs/plan-druid-saas.md, lot 2): the open
 * registries the portal reads (ROR, the establishments and the research structures of the French ministry of higher
 * education — RNSR), the payload the creator confirms, and the seeding of the directory of the new tenant from it.
 * Pure functions (unit-tested) and the seeding (integration test); the HTTP relays live in functions/start.
 */
import { z } from 'zod';
import { StructureLevel, StructureMission, StructureNature, StructureStatus, type Structure } from '../../types';
import type { Db } from '../db/core';
import type { CommandContext } from '../directory/commands';
import { ApiError } from '../directory/errors';
import { createPgStorage } from '../directory/pg/storage';
import { RESERVED_SLUGS, SLUG_RE, normalizeEmail } from './controlPlane';

// ── ROR (api.ror.org/v2) ──────────────────────────────────────────────────────────────────────────────────────────────
export interface OrganizationCandidate {
  /** ROR id without the URL prefix (`03gnr7b55`). */
  ror: string;
  name: string;
  nameEn: string | null;
  acronym: string | null;
  countryCode: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  wikidata: string | null;
  grid: string | null;
  isni: string | null;
  types: string[];
}

export const rorIdOf = (v: unknown): string | null => {
  const m = String(v || '').trim().match(/(?:ror\.org\/)?(0[a-z0-9]{6}[0-9]{2})$/i);
  return m ? m[1].toLowerCase() : null;
};

const externalId = (raw: any, type: string): string | null => {
  const ext = (raw?.external_ids || []).find((e: any) => e?.type === type);
  return ext ? (ext.preferred || ext.all?.[0] || null) : null;
};

/** One organization of the ROR v2 API as the portal shows it. */
export const rorOrganizationFromRecord = (raw: any): OrganizationCandidate | null => {
  const ror = rorIdOf(raw?.id);
  if (!ror) return null;
  const names: any[] = raw.names || [];
  const byType = (t: string) => names.find((n) => (n.types || []).includes(t))?.value || null;
  const display = byType('ror_display') || names.find((n) => (n.types || []).includes('label'))?.value || null;
  const nameEn = names.find((n) => n.lang === 'en' && (n.types || []).includes('label'))?.value || null;
  const loc = raw.locations?.[0]?.geonames_details || {};
  const website = (raw.links || []).find((l: any) => l?.type === 'website')?.value || null;
  return {
    ror, name: display || nameEn || ror, nameEn, acronym: byType('acronym'),
    countryCode: loc.country_code || null, country: loc.country_name || null, city: loc.name || null, website,
    wikidata: externalId(raw, 'wikidata'), grid: externalId(raw, 'grid'), isni: externalId(raw, 'isni'), types: raw.types || [],
  };
};

// ── Establishments of the ministry (fr-esr-principaux-etablissements-enseignement-superieur) ──────────────────────────
export interface EsrEstablishment {
  uai: string | null;
  siret: string | null;
  idref: string | null;
  wikidata: string | null;
  ror: string | null;
  name: string;
  nameEn: string | null;
  type: string | null;
  city: string | null;
  website: string | null;
}

const first = (v: unknown): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as string | null;

export const esrEstablishmentFromRecord = (raw: any): EsrEstablishment | null => {
  if (!raw || !raw.uo_lib) return null;
  return {
    uai: raw.uai || null, siret: first(raw.siret), idref: first(raw.identifiant_idref), wikidata: first(raw.identifiant_wikidata),
    ror: rorIdOf(first(raw.identifiant_ror)), name: raw.uo_lib, nameEn: raw.uo_lib_en || null, type: first(raw.type_d_etablissement),
    city: raw.com_nom || null, website: raw.url || null,
  };
};

// ── Research structures of the ministry (fr-esr-structures-recherche-publiques-actives, RNSR) ─────────────────────────
export interface RnsrStructure {
  rnsr: string;
  acronym: string | null;
  name: string;
  /** Label number (`UMR 6004`), the first one when several. */
  label: string | null;
  /** Label type (`UMR`, `UR`, `FR`…), from the label. */
  labelType: string | null;
  code: string | null;
  type: string | null;
  /** 2 = unit, 3 = federation / grouping, 1 = team (code_de_niveau_de_structure). */
  level: string | null;
  city: string | null;
  website: string | null;
  tutelles: string[];
  uaiTutelles: string[];
  parent: string | null;
}

const splitList = (v: unknown): string[] => String(v || '').split(/[;,]\s*|\s*;\s*/).map((s) => s.trim()).filter(Boolean);

export const rnsrStructureFromRecord = (raw: any): RnsrStructure | null => {
  const rnsr = String(raw?.numero_national_de_structure || '').trim();
  if (!rnsr) return null;
  const labels = [...new Set(splitList(raw.label_numero))];
  const label = labels[0] || null;
  const m = label ? label.match(/^([A-Z]+)\s*([0-9A-Z-]+)?$/i) : null;
  return {
    rnsr, acronym: raw.sigle ? String(raw.sigle).trim() : null, name: String(raw.libelle || raw.sigle || rnsr).trim(),
    label, labelType: m ? m[1].toUpperCase() : null, code: m?.[2] || null, type: raw.type_de_structure || null,
    level: raw.code_de_niveau_de_structure != null ? String(raw.code_de_niveau_de_structure) : null,
    city: raw.commune ? String(raw.commune).replace(/\s+CEDEX.*$/i, '').trim() : null, website: raw.site_web || null,
    tutelles: splitList(raw.tutelles), uaiTutelles: splitList(raw.uai_des_tutelles),
    parent: first(raw.numero_de_structure_parent) || null,
  };
};

// ── Slug and mail domain ──────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'of', 'the', 'and']);

/** `Université de Démonstration` → `universite-demonstration` (ASCII, ≤ 40 chars, never reserved). */
export const proposeSlug = (name: string): string => {
  const words = String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  let slug = words.join('-').slice(0, 40).replace(/-+$/, '');
  if (!slug) return 'etablissement';
  if (!SLUG_RE.test(slug)) slug = `etab-${slug}`.slice(0, 40).replace(/-+$/, '');
  if (RESERVED_SLUGS.includes(slug)) slug = `${slug}-1`;
  return slug;
};

/** `https://www.univ-x.fr/` → `univ-x.fr` (the mail domain proposed to the creator). */
export const mailDomainOf = (website: string | null | undefined): string | null => {
  try {
    const h = new URL(String(website || '')).hostname.toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : null;
  } catch {
    return null;
  }
};

// ── Payload confirmed by the creator ──────────────────────────────────────────────────────────────────────────────────
const optionalText = (max = 200) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

export const OnboardingLab = z.object({
  rnsr: optionalText(20),
  acronym: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(300),
  label: optionalText(40),
  type: optionalText(40),
  website: optionalText(300),
  ror: optionalText(20),
  wikidata: optionalText(20),
  hal: optionalText(100),
  tutelles: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  uaiTutelles: z.array(z.string().trim().min(1).max(12)).max(30).default([]),
});

export const OnboardingPayload = z.object({
  slug: z.string().trim().regex(SLUG_RE),
  label: z.string().trim().min(2).max(120),
  mailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(10).default([]),
  establishment: z.object({
    ror: z.string().trim().regex(/^0[a-z0-9]{6}[0-9]{2}$/).nullable().optional().transform((v) => v || null),
    name: z.string().trim().min(2).max(300),
    nameEn: optionalText(300),
    country: optionalText(100),
    countryCode: optionalText(2),
    city: optionalText(100),
    website: optionalText(300),
    uai: optionalText(12),
    siret: optionalText(20),
    idref: optionalText(20),
    wikidata: optionalText(20),
    openalex: optionalText(20),
  }),
  labs: z.array(OnboardingLab).max(500).default([]),
});
export type OnboardingPayload = z.infer<typeof OnboardingPayload>;
export type OnboardingLab = z.infer<typeof OnboardingLab>;

/** Host of a tenant on the base domain of the deployment. */
export const tenantHostOf = (slug: string, baseDomain: string): string => `${slug}.${String(baseDomain).toLowerCase().replace(/^\.+|\.+$/g, '')}`;

// ── Seeding of the directory ──────────────────────────────────────────────────────────────────────────────────────────
/** A lab of the payload as the structure the directory command expects (level unit, public, research). */
export const structureOfLab = (lab: OnboardingLab): Structure => ({
  id: '', level: StructureLevel.ENTITE, nature: StructureNature.PUBLIC, type: lab.type || '', acronym: lab.acronym,
  officialName: lab.name, code: (lab.label || '').replace(/^[A-Z]+\s*/i, ''), rnsrId: lab.rnsr || '', status: StructureStatus.ACTIVE,
  historyLinks: [], primaryMission: StructureMission.RECHERCHE, scientificDomains: [], ercFields: [], director: '',
  supervisors: lab.tutelles, institutionCodes: lab.uaiTutelles.join(', '), doctoralSchools: [], address: '', zipCode: '', city: '',
  country: '', website: lab.website || undefined, rorId: lab.ror || undefined, halCollectionUrl: lab.hal || undefined,
  identifiers: { wikidata: lab.wikidata || undefined },
} as unknown as Structure);

export interface SeedReport { institution: number; structures: number; skipped: { acronym: string; reason: string }[] }

/** Writes the establishment and the labs of the payload into the (empty) directory of the tenant. */
export const seedTenantDirectory = async (db: Db, payload: OnboardingPayload, actor: string): Promise<SeedReport> => {
  const store = createPgStorage({ db, tablesActor: actor });
  const ctx: CommandContext = { scope: { all: true, labAnchors: [] }, actor, audit: () => {} };
  const report: SeedReport = { institution: 0, structures: 0, skipped: [] };
  const e = payload.establishment;
  try {
    await store.commands.createInstitution({ name: e.name, label: e.nameEn || undefined, uai: e.uai || undefined, ror: e.ror || undefined, idref: e.idref || undefined }, ctx);
    report.institution = 1;
  } catch (err) {
    // A retried provisioning (portal « Retry ») finds the institution of the first attempt: kept, not an error.
    if (!(err instanceof ApiError && err.status === 409)) throw err;
    report.skipped.push({ acronym: e.name, reason: err.message });
  }
  const seen = new Set<string>();
  for (const lab of payload.labs) {
    const key = lab.acronym.trim().toUpperCase();
    if (seen.has(key)) { report.skipped.push({ acronym: lab.acronym, reason: 'duplicate acronym' }); continue; }
    seen.add(key);
    try {
      await store.commands.createStructure(structureOfLab(lab), ctx);
      report.structures++;
    } catch (err) {
      report.skipped.push({ acronym: lab.acronym, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
};

/** Owner e-mail and mail domains of a payload, normalized. */
export const ownerAndDomains = (ownerEmail: string, payload: OnboardingPayload): { ownerEmail: string; mailDomains: string[] } => {
  const owner = normalizeEmail(ownerEmail);
  const domains = new Set(payload.mailDomains.map((d) => d.toLowerCase()));
  return { ownerEmail: owner, mailDomains: [...domains] };
};
