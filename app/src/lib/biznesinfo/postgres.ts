import { Pool, type PoolClient } from "pg";

import { getDbPool } from "@/lib/auth/db";
import { normalizeCityForFilter } from "@/lib/utils/location";
import { canonicalizeSemanticToken, tokenizeSemanticText } from "@/lib/search/semantic";

import type {
  BiznesinfoCatalogResponse,
  BiznesinfoCategoryRef,
  BiznesinfoCompany,
  BiznesinfoCompanyResponse,
  BiznesinfoCompanySummary,
  BiznesinfoRubricRef,
  BiznesinfoRubricResponse,
  BiznesinfoSuggestResponse,
} from "./types";

import { BIZNESINFO_CATEGORY_ICONS } from "./icons";
import { BIZNESINFO_KEYWORD_OVERRIDES } from "./keywordOverrides";
import { getServerKeywordGenerationOptions } from "./keywordRuntime";
import { generateCompanyKeywordPhrases } from "./keywords";
import { BIZNESINFO_LOGO_OVERRIDES } from "./logoOverrides";
import { BIZNESINFO_MAP_OVERRIDES } from "./mapOverrides";
import { companySlugForUrl } from "./slug";
import { isExcludedBiznesinfoCompany, normalizeBiznesinfoUnp } from "./exclusions";
import { BIZNESINFO_WEBSITE_OVERRIDES } from "./websiteOverrides";

const BIZNESINFO_SCHEMA_MIGRATION_ID = "20260217_01_biznesinfo_catalog_pg_primary";
const BIZNESINFO_SCHEMA_MIGRATION_ID_COMPANIES_SERVICES = "20260217_02_companies_services";

const BIZNESINFO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS biznesinfo_catalog_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS biznesinfo_companies (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'biznesinfo',
    unp TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    search_text TEXT NOT NULL DEFAULT '',
    region_slug TEXT,
    city_norm TEXT NOT NULL DEFAULT '',
    primary_category_slug TEXT,
    primary_category_name TEXT,
    primary_rubric_slug TEXT,
    primary_rubric_name TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS biznesinfo_categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS biznesinfo_rubrics (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    category_slug TEXT NOT NULL,
    category_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS biznesinfo_company_categories (
    company_id TEXT NOT NULL REFERENCES biznesinfo_companies(id) ON DELETE CASCADE,
    category_slug TEXT NOT NULL,
    category_name TEXT NOT NULL,
    category_url TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, category_slug)
  );

  CREATE TABLE IF NOT EXISTS biznesinfo_company_rubrics (
    company_id TEXT NOT NULL REFERENCES biznesinfo_companies(id) ON DELETE CASCADE,
    rubric_slug TEXT NOT NULL,
    rubric_name TEXT NOT NULL,
    rubric_url TEXT NOT NULL,
    category_slug TEXT NOT NULL,
    category_name TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, rubric_slug)
  );

  CREATE INDEX IF NOT EXISTS biznesinfo_companies_region_slug_idx
    ON biznesinfo_companies(region_slug);
  CREATE INDEX IF NOT EXISTS biznesinfo_companies_city_norm_idx
    ON biznesinfo_companies(city_norm);
  CREATE INDEX IF NOT EXISTS biznesinfo_companies_primary_category_idx
    ON biznesinfo_companies(primary_category_slug);
  CREATE INDEX IF NOT EXISTS biznesinfo_companies_primary_rubric_idx
    ON biznesinfo_companies(primary_rubric_slug);
  CREATE INDEX IF NOT EXISTS biznesinfo_companies_name_lower_idx
    ON biznesinfo_companies ((lower(name)));
  CREATE INDEX IF NOT EXISTS biznesinfo_companies_search_text_fts_idx
    ON biznesinfo_companies USING gin (to_tsvector('simple', search_text));

  CREATE INDEX IF NOT EXISTS biznesinfo_company_categories_slug_idx
    ON biznesinfo_company_categories(category_slug);
  CREATE INDEX IF NOT EXISTS biznesinfo_company_rubrics_slug_idx
    ON biznesinfo_company_rubrics(rubric_slug);
  CREATE INDEX IF NOT EXISTS biznesinfo_company_rubrics_category_slug_idx
    ON biznesinfo_company_rubrics(category_slug);
`;

const BIZNESINFO_COMPANIES_SERVICES_SQL = `
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    normalized_name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    logo_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS companies_region_idx
    ON companies(region);
  CREATE INDEX IF NOT EXISTS companies_city_idx
    ON companies(city);
  CREATE INDEX IF NOT EXISTS companies_normalized_name_idx
    ON companies(normalized_name);
  CREATE INDEX IF NOT EXISTS companies_status_idx
    ON companies(status);

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS services_company_id_idx
    ON services(company_id);
  CREATE INDEX IF NOT EXISTS services_title_idx
    ON services(title);
`;

const DASH_VARIANTS_RE = /[-‐‑‒–—―]/gu;

const REGION_ALIAS: Record<string, string[]> = {
  minsk: ["minsk"],
  "minsk-region": ["minsk-region"],
  brest: ["brest"],
  vitebsk: ["vitebsk"],
  gomel: ["gomel"],
  grodno: ["grodno"],
  mogilev: ["mogilev"],
};

// Product decision: region must never be empty in companies table.
// When exact inference is impossible, we put the record into common base bucket.
const COMMON_REGION_FALLBACK = "minsk-region";

const POSTAL_PREFIX_TO_REGION_SLUG: Record<string, string> = {
  "210": "vitebsk",
  "211": "vitebsk",
  "212": "mogilev",
  "213": "mogilev",
  "220": "minsk",
  "221": "minsk-region",
  "222": "minsk-region",
  "223": "minsk-region",
  "224": "brest",
  "225": "brest",
  "230": "grodno",
  "231": "grodno",
  "246": "gomel",
  "247": "gomel",

  "200": "minsk",
  "201": "vitebsk",
  "202": "minsk-region",
  "215": "minsk",
  "217": "vitebsk",
  "227": "minsk-region",
  "232": "minsk",
  "234": "grodno",
  "236": "gomel",
  "249": "vitebsk",
  "264": "gomel",
  "270": "minsk",
  "274": "gomel",
};

const REGION_GEO_ROOTS: Record<string, string[]> = {
  brest: [
    "брест",
    "пинск",
    "баранович",
    "кобрин",
    "жабинк",
    "пружан",
    "малорит",
    "столин",
    "лунинец",
    "дрогичин",
    "иванов",
    "берез",
    "белоозер",
    "каменец",
  ],
  vitebsk: [
    "витеб",
    "полоц",
    "новопол",
    "орша",
    "лепел",
    "глубок",
    "верхнедвин",
    "браслав",
    "докшиц",
    "чашник",
    "шумилин",
    "толочин",
    "постав",
  ],
  gomel: [
    "гомел",
    "жлобин",
    "мозыр",
    "речиц",
    "светлогор",
    "рогач",
    "калинкович",
    "добруш",
    "ельск",
    "петрик",
    "наровл",
    "хойник",
  ],
  grodno: [
    "гродн",
    "лида",
    "слоним",
    "волковыск",
    "сморгон",
    "новогруд",
    "мосты",
    "щучин",
    "ошмян",
    "корелич",
    "дзятлов",
  ],
  mogilev: [
    "могил",
    "бобруйск",
    "осипович",
    "шклов",
    "горк",
    "кричев",
    "белынич",
    "мстислав",
    "костюк",
    "чериков",
    "климович",
  ],
  "minsk-region": [
    "борисов",
    "солигор",
    "молодеч",
    "жодин",
    "слуцк",
    "дзержин",
    "несвиж",
    "столбц",
    "вилейк",
    "логойск",
    "смолевич",
    "пухович",
    "червен",
    "заслав",
    "колодищ",
    "боровлян",
    "жданович",
    "сениц",
    "стиклев",
    "тростенец",
    "миханович",
    "острошиц",
    "гатов",
    "щомыслиц",
    "мачулищ",
    "ратомк",
    "озерц",
    "юбилейн",
    "цнянк",
    "колядич",
    "лесной",
    "раубич",
  ],
};

const DISTRICT_MARKER_RE = /(р-н|район|обл\.?|область|деревн|д\.|пос\.?|п\.|гп\.?|аг\.?)/iu;

const DESCRIPTOR_STOP_WORDS = new Set([
  "компания",
  "компании",
  "компаний",
  "предприятие",
  "предприятия",
  "предприятий",
  "организация",
  "организации",
  "организаций",
  "фирма",
  "фирмы",
  "фирм",
  "завод",
  "завода",
  "заводы",
  "фабрика",
  "фабрики",
  "фабрик",
  "производство",
  "производства",
  "производитель",
  "производители",
  "продукция",
  "продукции",
  "промышленность",
  "промышленности",
  "отрасль",
  "отрасли",
  "направление",
  "направления",
  "товары",
  "товар",
  "услуги",
  "услуга",
  "работы",
  "работа",
]);

const DESCRIPTOR_PREFIXES = [
  "компан",
  "предприят",
  "организац",
  "фирм",
  "завод",
  "фабрик",
  "производств",
  "производител",
  "продукц",
  "промышленност",
  "отрасл",
  "направлен",
  "деятельност",
  "товар",
  "услуг",
  "работ",
];

let ensuredSchema = false;
let ensureSchemaPromise: Promise<void> | null = null;

function hasDatabaseUrl(): boolean {
  return Boolean((process.env.DATABASE_URL || "").trim());
}

function getCatalogDbPool(): Pool {
  return getDbPool();
}

function safeLower(value: string): string {
  return (value || "").toLowerCase();
}

function normalizeCompanyIdForMatch(id: string): string {
  return safeLower(id).replace(DASH_VARIANTS_RE, "");
}

function regionAliasKeys(region: string | null): string[] {
  if (!region) return [];
  return Array.from(new Set(REGION_ALIAS[region] || [region]));
}

function normalizeToken(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
}

function isDescriptorToken(token: string): boolean {
  const t = normalizeToken(token);
  if (!t) return false;
  if (DESCRIPTOR_STOP_WORDS.has(t)) return true;
  return DESCRIPTOR_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function normalizeHintToken(raw: string): string {
  const token = normalizeToken(raw).replace(/[^a-zа-я0-9-]+/giu, "");
  if (!token) return "";
  if (token.startsWith("молок")) return "молочная";
  if (token.startsWith("молочн")) return "молочная";
  return canonicalizeSemanticToken(token);
}

function normalizeGeoText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'`]/gu, " ")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsAnyGeoRoot(haystack: string, roots: string[]): boolean {
  if (!haystack) return false;
  return roots.some((root) => root && haystack.includes(root));
}

function regionSlugFromPostalCode(text: string): string | null {
  const matches = String(text || "").match(/\b\d{6}\b/g);
  if (!matches) return null;
  for (const code of matches) {
    const prefix = code.slice(0, 3);
    const regionSlug = POSTAL_PREFIX_TO_REGION_SLUG[prefix];
    if (regionSlug) return regionSlug;
  }
  return null;
}

function resolveRegionSlugFromPostalSources(...sources: string[]): string | null {
  for (const source of sources) {
    const regionSlug = regionSlugFromPostalCode(source || "");
    if (regionSlug) return regionSlug;
  }
  return null;
}

function inferRegionSlugByGeoRoots(city: string, region: string, address: string): string | null {
  const cityNorm = normalizeGeoText(city || "");
  const regionNorm = normalizeGeoText(region || "");
  const addressNorm = normalizeGeoText(address || "");
  const combined = normalizeGeoText([cityNorm, regionNorm, addressNorm].join(" "));
  if (!combined) return null;

  for (const [slug, roots] of Object.entries(REGION_GEO_ROOTS)) {
    if (slug === "minsk-region") continue;
    if (containsAnyGeoRoot(combined, roots)) return slug;
  }

  if (containsAnyGeoRoot(combined, REGION_GEO_ROOTS["minsk-region"] || [])) {
    return "minsk-region";
  }

  if (combined.includes("минск")) {
    if (DISTRICT_MARKER_RE.test(combined)) return "minsk-region";
    return "minsk";
  }

  return null;
}

function normalizeRegionSlug(city: string, region: string, address: string): string | null {
  const cityLow = (city || "").toLowerCase();
  const regionLow = (region || "").toLowerCase();
  const addressLow = (address || "").toLowerCase();

  if (regionLow.includes("брест")) return "brest";
  if (regionLow.includes("витеб")) return "vitebsk";
  if (regionLow.includes("гомел")) return "gomel";
  if (regionLow.includes("гродн")) return "grodno";
  if (regionLow.includes("могил")) return "mogilev";

  if (cityLow.includes("брест")) return "brest";
  if (cityLow.includes("витеб")) return "vitebsk";
  if (cityLow.includes("гомел")) return "gomel";
  if (cityLow.includes("гродн")) return "grodno";
  if (cityLow.includes("могил")) return "mogilev";

  const looksLikeDistrict = (s: string): boolean => {
    const v = (s || "").toLowerCase();
    return v.includes("р-н") || v.includes("район") || v.includes("обл") || v.includes("область");
  };

  const minskDistrictRe = /минск(?:ий|ого|ому|ом)?\s*(?:р-н|район)/i;
  const minskOblastRe = /минск(?:ая|ой|ую|ом)?\s*(?:обл\.?|область)/i;

  const isMinskRegion =
    minskDistrictRe.test(cityLow) ||
    minskOblastRe.test(cityLow) ||
    minskDistrictRe.test(regionLow) ||
    minskOblastRe.test(regionLow) ||
    minskDistrictRe.test(addressLow) ||
    minskOblastRe.test(addressLow) ||
    (cityLow.includes("минск") && looksLikeDistrict(cityLow)) ||
    (regionLow.includes("минск") && looksLikeDistrict(regionLow));

  if (isMinskRegion) return "minsk-region";

  const fromPostal = resolveRegionSlugFromPostalSources(city || "", region || "", address || "");
  if (fromPostal) return fromPostal;

  if (cityLow.includes("минск")) return "minsk";
  if (regionLow.includes("минск")) return "minsk";

  const byGeoRoots = inferRegionSlugByGeoRoots(city || "", region || "", address || "");
  if (byGeoRoots) return byGeoRoots;

  return null;
}

function normalizeCityLookupKey(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'`]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeSettlementLookupKey(raw: string): string {
  return normalizeCityLookupKey(raw)
    .replace(/\b(д\.?|деревня|пос\.?|поселок|п\.?|гп\.?|аг\.?|г\.?|город)\b/giu, " ")
    .replace(/\b\d{6}\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractSettlementFromAddress(rawAddress: string): string {
  const cleaned = String(rawAddress || "").replace(/^\s*,\s*/gu, "").trim();
  if (!cleaned) return "";
  const [firstPart] = cleaned.split(",");
  return String(firstPart || "").trim();
}

type RegionCount = {
  region: string;
  cnt: number;
};

function pickBestRegionByCounts(regionCounts: RegionCount[]): string | null {
  if (!regionCounts.length) return null;
  const sorted = [...regionCounts].sort((a, b) => b.cnt - a.cnt);
  if (sorted.length === 1) return sorted[0]?.region || null;

  const top = sorted[0];
  const second = sorted[1];
  if (!top || !second) return null;

  if (top.cnt >= 3 && top.cnt >= second.cnt * 3) return top.region;
  return null;
}

async function loadBackfillRegionHintsByCity(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{
    city_norm: string;
    region: string;
    cnt: string;
  }>(
    `
      SELECT
        lower(btrim(city)) AS city_norm,
        region,
        COUNT(*)::text AS cnt
      FROM companies
      WHERE region <> '' AND btrim(city) <> ''
      GROUP BY 1, 2
    `,
  );

  const exactBuckets = new Map<string, Map<string, number>>();
  const settlementBuckets = new Map<string, Map<string, number>>();

  for (const row of result.rows || []) {
    const cityKey = normalizeCityLookupKey(row.city_norm || "");
    const region = String(row.region || "").trim();
    const cnt = Number.parseInt(String(row.cnt || "0"), 10) || 0;
    if (!cityKey || !region || cnt <= 0) continue;

    const byRegion = exactBuckets.get(cityKey) || new Map<string, number>();
    byRegion.set(region, (byRegion.get(region) || 0) + cnt);
    exactBuckets.set(cityKey, byRegion);

    const settlementKey = normalizeSettlementLookupKey(cityKey);
    if (settlementKey && settlementKey !== cityKey) {
      const settlementByRegion = settlementBuckets.get(settlementKey) || new Map<string, number>();
      settlementByRegion.set(region, (settlementByRegion.get(region) || 0) + cnt);
      settlementBuckets.set(settlementKey, settlementByRegion);
    }
  }

  const hints = new Map<string, string>();

  for (const [cityKey, byRegion] of exactBuckets.entries()) {
    const best = pickBestRegionByCounts(
      Array.from(byRegion.entries()).map(([region, cnt]) => ({ region, cnt })),
    );
    if (best) hints.set(cityKey, best);
  }

  for (const [settlementKey, byRegion] of settlementBuckets.entries()) {
    if (hints.has(settlementKey)) continue;
    const best = pickBestRegionByCounts(
      Array.from(byRegion.entries()).map(([region, cnt]) => ({ region, cnt })),
    );
    if (best) hints.set(settlementKey, best);
  }

  return hints;
}

function normalizeLogoUrl(raw: string): string {
  const url = (raw || "").trim();
  if (!url) return "";
  const low = url.toLowerCase();
  if (low.endsWith("/images/icons/og-icon.png")) return "";
  if (low.includes("/images/logo/no-logo")) return "";
  if (low.includes("/images/logo/no_logo")) return "";
  return url;
}

function normalizeWebsites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const byHost = new Map<string, { url: string; isRoot: boolean; length: number }>();
  const fallback: string[] = [];
  const fallbackSeen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    const normalized = (() => {
      try {
        new URL(trimmed);
        return trimmed;
      } catch {
        return `https://${trimmed.replace(/^\/+/, "")}`;
      }
    })();

    let url: URL | null = null;
    try {
      url = new URL(normalized);
    } catch {
      url = null;
    }

    if (!url) {
      const key = trimmed.toLowerCase();
      if (fallbackSeen.has(key)) continue;
      fallbackSeen.add(key);
      fallback.push(trimmed);
      continue;
    }

    const hostKey = (url.hostname || "").toLowerCase().replace(/^www\./i, "");
    if (!hostKey) continue;

    const isRoot = (url.pathname || "") === "/" || (url.pathname || "") === "";
    const candidate = { url: normalized, isRoot, length: normalized.length };
    const existing = byHost.get(hostKey);
    if (!existing) {
      byHost.set(hostKey, candidate);
      continue;
    }

    if (candidate.isRoot && !existing.isRoot) {
      byHost.set(hostKey, candidate);
      continue;
    }

    if (candidate.isRoot === existing.isRoot && candidate.length < existing.length) {
      byHost.set(hostKey, candidate);
    }
  }

  return [...Array.from(byHost.values()).map((v) => v.url), ...fallback];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function applyWebsiteOverride(companyId: string, websites: string[]): string[] {
  const raw = (companyId || "").trim();
  if (!raw) return websites;
  const key = raw.toLowerCase();

  const hasOverride =
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, raw) ||
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, key);
  if (!hasOverride) return websites;

  const override = BIZNESINFO_WEBSITE_OVERRIDES[raw] ?? BIZNESINFO_WEBSITE_OVERRIDES[key];
  return normalizeWebsites(override);
}

function applyMapOverride(company: BiznesinfoCompany): void {
  const raw = (company.source_id || "").trim();
  if (!raw) return;
  const key = raw.toLowerCase();

  const override = BIZNESINFO_MAP_OVERRIDES[raw] ?? BIZNESINFO_MAP_OVERRIDES[key];
  if (!override) return;

  const address = String(override.address || "").trim();
  if (address) {
    company.address = address;
  }

  if (!company.extra) {
    company.extra = { lat: null, lng: null };
  }

  if (isFiniteNumber(override.lat)) {
    company.extra.lat = override.lat;
  }
  if (isFiniteNumber(override.lng)) {
    company.extra.lng = override.lng;
  }
}

function sanitizeCompanyRecord(company: BiznesinfoCompany): BiznesinfoCompany {
  const sourceId = (company.source_id || "").trim();
  company.logo_url = normalizeLogoUrl(company.logo_url || "");
  const logoOverride = BIZNESINFO_LOGO_OVERRIDES[sourceId];
  if (logoOverride) {
    company.logo_url = logoOverride;
  }
  applyMapOverride(company);
  company.websites = applyWebsiteOverride(sourceId, normalizeWebsites(company.websites));
  company.unp = normalizeBiznesinfoUnp(company.unp || "");
  return company;
}

function buildCompanySearchText(company: BiznesinfoCompany): string {
  return [
    company.name,
    company.description,
    company.about,
    company.address,
    company.city,
    company.region,
    (company.phones || []).join(" "),
    (company.emails || []).join(" "),
    (company.websites || []).join(" "),
    (company.categories || []).map((c) => `${c.name || ""} ${c.slug || ""}`).join(" "),
    (company.rubrics || []).map((r) => `${r.name || ""} ${r.slug || ""}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е");
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
}

function parseCategoryArray(value: unknown): BiznesinfoCategoryRef[] {
  if (!Array.isArray(value)) return [];
  const out: BiznesinfoCategoryRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const slug = String((item as { slug?: string }).slug || "").trim();
    if (!slug) continue;
    out.push({
      slug,
      name: String((item as { name?: string }).name || slug).trim() || slug,
      url: String((item as { url?: string }).url || "").trim() || `/catalog/${slug}`,
    });
  }
  return out;
}

function parseRubricArray(value: unknown): BiznesinfoRubricRef[] {
  if (!Array.isArray(value)) return [];
  const out: BiznesinfoRubricRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const slug = String((item as { slug?: string }).slug || "").trim();
    const categorySlug = String((item as { category_slug?: string }).category_slug || "").trim();
    if (!slug || !categorySlug) continue;
    const categoryName = String((item as { category_name?: string }).category_name || categorySlug).trim() || categorySlug;
    out.push({
      slug,
      name: String((item as { name?: string }).name || slug).trim() || slug,
      url: String((item as { url?: string }).url || "").trim() || `/catalog/${categorySlug}/${slug.split("/").slice(1).join("/")}`,
      category_slug: categorySlug,
      category_name: categoryName,
    });
  }
  return out;
}

function parsePhonesExt(value: unknown): Array<{ number: string; labels: string[] }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ number: string; labels: string[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const number = String((item as { number?: string }).number || "").trim();
    if (!number) continue;
    const labelsRaw = (item as { labels?: unknown }).labels;
    const labels = Array.isArray(labelsRaw)
      ? labelsRaw
          .map((raw) => String(raw || "").trim())
          .filter(Boolean)
      : [];
    out.push({ number, labels });
  }
  return out;
}

function toBiznesinfoCompany(rawPayload: unknown): BiznesinfoCompany {
  const payload = (rawPayload && typeof rawPayload === "object")
    ? (rawPayload as Partial<BiznesinfoCompany>)
    : {};

  const company: BiznesinfoCompany = {
    source: "biznesinfo",
    source_id: String(payload.source_id || "").trim(),
    source_url: String(payload.source_url || "").trim(),
    name: String(payload.name || "").trim(),
    unp: normalizeBiznesinfoUnp(String(payload.unp || "")),
    country: String(payload.country || "").trim(),
    region: String(payload.region || "").trim(),
    city: String(payload.city || "").trim(),
    address: String(payload.address || "").trim(),
    phones: parseStringArray(payload.phones),
    phones_ext: parsePhonesExt(payload.phones_ext),
    emails: parseStringArray(payload.emails),
    websites: normalizeWebsites(payload.websites),
    description: String(payload.description || "").trim(),
    about: String(payload.about || "").trim(),
    contact_person: String(payload.contact_person || "").trim(),
    logo_url: normalizeLogoUrl(String(payload.logo_url || "")),
    work_hours:
      payload.work_hours && typeof payload.work_hours === "object"
        ? {
            work_time: String((payload.work_hours as { work_time?: string }).work_time || "").trim() || undefined,
            break_time: String((payload.work_hours as { break_time?: string }).break_time || "").trim() || undefined,
            status: String((payload.work_hours as { status?: string }).status || "").trim() || undefined,
          }
        : {},
    categories: parseCategoryArray(payload.categories),
    rubrics: parseRubricArray(payload.rubrics),
    extra:
      payload.extra && typeof payload.extra === "object"
        ? {
            lat: isFiniteNumber((payload.extra as { lat?: unknown }).lat)
              ? ((payload.extra as { lat?: number }).lat ?? null)
              : null,
            lng: isFiniteNumber((payload.extra as { lng?: unknown }).lng)
              ? ((payload.extra as { lng?: number }).lng ?? null)
              : null,
          }
        : { lat: null, lng: null },
  };

  if (typeof payload.hero_image === "string" && payload.hero_image.trim()) {
    company.hero_image = payload.hero_image.trim();
  }
  if (Array.isArray(payload.photos)) company.photos = payload.photos;
  if (Array.isArray(payload.products)) company.products = payload.products;
  if (Array.isArray(payload.services_list)) company.services_list = payload.services_list;
  if (Array.isArray(payload.reviews)) company.reviews = payload.reviews;

  return sanitizeCompanyRecord(company);
}

function buildCompanySummary(company: BiznesinfoCompany, regionSlug: string | null): BiznesinfoCompanySummary {
  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;
  return {
    id: company.source_id,
    source: company.source,
    unp: company.unp || "",
    name: company.name || "",
    address: company.address || "",
    city: company.city || "",
    region: regionSlug || "",
    work_hours: company.work_hours || {},
    phones_ext: company.phones_ext || [],
    phones: company.phones || [],
    emails: company.emails || [],
    websites: company.websites || [],
    description: company.description || company.about || "",
    about: company.about || "",
    logo_url: company.logo_url || "",
    primary_category_slug: primaryCategory?.slug ?? null,
    primary_category_name: primaryCategory?.name ?? null,
    primary_rubric_slug: primaryRubric?.slug ?? null,
    primary_rubric_name: primaryRubric?.name ?? null,
  };
}

function buildSummaryFromSearchItem(item: BiznesinfoSearchItem): BiznesinfoCompanySummary {
  return {
    id: item.id,
    source: "biznesinfo",
    unp: "",
    name: item.name || "",
    address: "",
    city: item.city || "",
    region: item.region || "",
    work_hours: {},
    phones_ext: [],
    phones: [],
    emails: [],
    websites: [],
    description: item.description || "",
    about: "",
    logo_url: item.logo_url || "",
    primary_category_slug: null,
    primary_category_name: null,
    primary_rubric_slug: null,
    primary_rubric_name: null,
  };
}

function mergeSummaryWithSearchItem(
  summary: BiznesinfoCompanySummary,
  item: BiznesinfoSearchItem | undefined,
): BiznesinfoCompanySummary {
  if (!item) return summary;
  return {
    ...summary,
    id: item.id || summary.id,
    name: item.name || summary.name,
    description: item.description || summary.description,
    city: item.city || summary.city,
    region: item.region || summary.region,
    logo_url: item.logo_url || summary.logo_url,
  };
}

function getKeywordOverride(companyId: string): string[] | null {
  const raw = (companyId || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const override = BIZNESINFO_KEYWORD_OVERRIDES[raw] ?? BIZNESINFO_KEYWORD_OVERRIDES[key];
  if (!override || override.length === 0) return null;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const phrase of override) {
    const normalized = String(phrase || "").replace(/\s+/gu, " ").trim();
    if (!normalized) continue;
    const dedupKey = normalized.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(normalized);
  }
  return out.length > 0 ? out : null;
}

function buildCompanyKeywordPhrases(company: BiznesinfoCompany): string[] {
  const override = getKeywordOverride(company.source_id || "");
  if (override) return override;
  return generateCompanyKeywordPhrases(company, getServerKeywordGenerationOptions());
}

function scoreHintText(haystack: string, tokens: string[]): number {
  const text = normalizeToken(haystack);
  if (!text) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (text.includes(token)) score += 3;
    else if (token.length >= 3 && text.split(" ").some((part) => part.startsWith(token) || token.startsWith(part))) {
      score += 2;
    }
  }
  return score;
}

function normalizeCompanyName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function extractPostalCode(...sources: string[]): string {
  const source = sources
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const match = source.match(/\b\d{6}\b/u);
  return match?.[0] || "";
}

function normalizeCompanyStatus(status: unknown): string {
  if (typeof status !== "string") return "active";
  const normalized = status.trim().toLowerCase();
  return normalized || "active";
}

function normalizeRegionForStorage(company: BiznesinfoCompany): string {
  const inferred = normalizeRegionSlug(company.city || "", company.region || "", company.address || "");
  if (inferred) return inferred;

  const normalized = String(company.region || "").trim().toLowerCase();
  if (!normalized) return COMMON_REGION_FALLBACK;
  return Object.prototype.hasOwnProperty.call(REGION_ALIAS, normalized) ? normalized : COMMON_REGION_FALLBACK;
}

type ImportServiceRecord = {
  title: string;
  description: string;
  category: string;
};

type PreparedCompanyImportRecord = {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  region: string;
  city: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  logoUrl: string;
  status: string;
  services: ImportServiceRecord[];
};

function buildServiceImportRecords(company: BiznesinfoCompany): ImportServiceRecord[] {
  if (!Array.isArray(company.services_list)) return [];

  const fallbackCategory = String(company.rubrics?.[0]?.name || company.categories?.[0]?.name || "").trim();
  const records: ImportServiceRecord[] = [];

  for (const item of company.services_list) {
    if (!item || typeof item !== "object") continue;

    const service = item as { title?: unknown; name?: unknown; description?: unknown; category?: unknown };
    const title = String(service.title || service.name || "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!title) continue;

    const description = String(service.description || "")
      .replace(/\s+/gu, " ")
      .trim();
    const category = String(service.category || fallbackCategory || "")
      .replace(/\s+/gu, " ")
      .trim();

    records.push({ title, description, category });
  }

  return records;
}

function buildServiceRecordId(companyId: string, index: number): string {
  return `${companyId}::service::${index + 1}`;
}

function prepareCompanyImportRecord(rawCompany: BiznesinfoCompany): PreparedCompanyImportRecord | null {
  const sourceId = String(rawCompany?.source_id || "").trim();
  if (!sourceId) return null;

  const company = sanitizeCompanyRecord({
    ...rawCompany,
    source: "biznesinfo",
    source_id: sourceId,
  } as BiznesinfoCompany);

  const lat = isFiniteNumber(company.extra?.lat) ? company.extra.lat : null;
  const lng = isFiniteNumber(company.extra?.lng) ? company.extra.lng : null;
  const rawStatus = (rawCompany as { status?: unknown }).status;

  return {
    id: sourceId,
    name: String(company.name || "").replace(/\s+/gu, " ").trim(),
    normalizedName: normalizeCompanyName(company.name || ""),
    description: String(company.description || company.about || "").trim(),
    region: normalizeRegionForStorage(company),
    city: String(company.city || "").trim(),
    postalCode: extractPostalCode(company.address || "", company.city || "", company.region || ""),
    lat,
    lng,
    logoUrl: String(company.logo_url || "").trim(),
    status: normalizeCompanyStatus(rawStatus),
    services: buildServiceImportRecords(company),
  };
}

async function applyCatalogMigration(client: PoolClient, migrationId: string, sql: string): Promise<void> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM biznesinfo_catalog_schema_migrations WHERE id = $1 LIMIT 1",
    [migrationId],
  );

  if (existing.rows[0]?.id) return;

  await client.query(sql);
  await client.query(
    "INSERT INTO biznesinfo_catalog_schema_migrations (id) VALUES ($1)",
    [migrationId],
  );
}

async function applyBiznesinfoSchema(): Promise<void> {
  const pool = getCatalogDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS biznesinfo_catalog_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await applyCatalogMigration(client, BIZNESINFO_SCHEMA_MIGRATION_ID, BIZNESINFO_SCHEMA_SQL);
    await applyCatalogMigration(client, BIZNESINFO_SCHEMA_MIGRATION_ID_COMPANIES_SERVICES, BIZNESINFO_COMPANIES_SERVICES_SQL);

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureBiznesinfoPgSchema(): Promise<void> {
  if (!hasDatabaseUrl()) return;
  if (ensuredSchema) return;

  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await applyBiznesinfoSchema();
      ensuredSchema = true;
    })().finally(() => {
      ensureSchemaPromise = null;
    });
  }

  await ensureSchemaPromise;
}

export type ReplaceCatalogResult = {
  total: number;
  inserted: number;
  skipped: number;
};

export type UpsertCompaniesServicesBatchResult = {
  total: number;
  upsertedCompanies: number;
  skippedCompanies: number;
  insertedServices: number;
};

export type BiznesinfoSearchItem = {
  id: string;
  name: string;
  description: string;
  region: string;
  city: string;
  status: string;
  logo_url: string;
  createdAt: string;
  _geo: { lat: number; lng: number } | null;
};

export type BiznesinfoSearchIndexCompany = {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  servicesText: string;
  serviceTitles: string[];
  serviceCategories: string[];
  categoryNames: string[];
  region: string;
  city: string;
  status: string;
  logo_url: string;
  logo_rank: number;
  nameTokens: string[];
  serviceTokens: string[];
  categoryTokens: string[];
  domainTags: string[];
  data_quality_score: number;
  data_quality_tier: "high" | "medium" | "basic";
  createdAt: string;
  updatedAt: string;
  _geo: { lat: number; lng: number } | null;
};

type BiznesinfoSearchIndexDbRow = {
  id: string;
  name: string | null;
  normalized_name: string | null;
  description: string | null;
  region: string | null;
  city: string | null;
  status: string | null;
  logo_url: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  lat: number | null;
  lng: number | null;
  services_text: string | null;
  service_titles: string[] | null;
  service_categories: string[] | null;
  category_names: string[] | null;
};

export type BiznesinfoSearchIndexBatchParams = {
  afterId?: string | null;
  limit?: number;
};

const SEARCH_INDEX_BATCH_DEFAULT_LIMIT = 2000;
const SEARCH_INDEX_BATCH_MAX_LIMIT = 5000;

function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(value || "");
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function normalizeSearchText(value: string): string {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function computeLogoRankFromUrl(logoUrl: string): number {
  const normalized = String(logoUrl || "").trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("/images/logo/no-logo") || normalized.includes("/images/logo/no_logo")) return 1;
  return 2;
}

function hasValidGeo(lat: number | null, lng: number | null): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

const COMPANY_LEGAL_TOKENS = new Set([
  "ооо",
  "оао",
  "зао",
  "чуп",
  "уп",
  "ип",
  "ао",
  "пао",
  "гп",
  "рп",
  "ltd",
  "llc",
  "inc",
]);

const SEARCH_COMMON_STOP_TOKENS = new Set([
  "услуга",
  "услуги",
  "товар",
  "товары",
  "продукция",
  "компания",
  "организация",
  "предприятие",
  "группа",
  "центр",
  "плюс",
]);

const DOMAIN_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  {
    tag: "food",
    pattern: /(^|[^\p{L}\p{N}])(молок\p{L}*|молоч\p{L}*|сыр\p{L}*|рыб\p{L}*|хлеб\p{L}*|мяс\p{L}*|овощ\p{L}*|фрукт\p{L}*|бакале\p{L}*|пищев\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  },
  {
    tag: "garden_tools",
    pattern: /(^|[^\p{L}\p{N}])(сад\p{L}*|инвентар\p{L}*|бензопил\p{L}*|триммер\p{L}*|мотоблок\p{L}*|газонокос\p{L}*|кусторез\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  },
  {
    tag: "construction",
    pattern: /(^|[^\p{L}\p{N}])(строит\p{L}*|ремонт\p{L}*|кирпич\p{L}*|цемент\p{L}*|бетон\p{L}*|арматур\p{L}*|металлопрокат\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  },
  {
    tag: "auto",
    pattern: /(^|[^\p{L}\p{N}])(авто\p{L}*|шиномонтаж\p{L}*|сто\b|запчаст\p{L}*|двигател\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  },
  {
    tag: "logistics",
    pattern: /(^|[^\p{L}\p{N}])(логист\p{L}*|перевоз\p{L}*|достав\p{L}*|склад\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  },
];

function normalizeNameForSearchIndex(rawName: string, rawNormalizedName: string): string {
  const seed = normalizeSearchText(rawNormalizedName || rawName)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!seed) return "";

  const tokens = tokenizeSemanticText(seed)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !COMPANY_LEGAL_TOKENS.has(token));

  return tokens.join(" ").trim();
}

function dedupeNormalizedSearchValues(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of values || []) {
    const value = normalizeSearchText(raw || "");
    if (!value) continue;
    const key = value.toLowerCase().replace(/ё/gu, "е");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function buildStructuredSemanticTokens(
  values: string[],
  options?: {
    stopTokens?: Set<string>;
    maxTokens?: number;
  },
): string[] {
  const stopTokens = options?.stopTokens || SEARCH_COMMON_STOP_TOKENS;
  const maxTokens = Math.max(8, Math.min(240, options?.maxTokens || 120));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values || []) {
    for (const raw of tokenizeSemanticText(String(value || ""))) {
      const token = canonicalizeSemanticToken(raw)
        .trim()
        .toLowerCase()
        .replace(/ё/gu, "е");
      if (!token || token.length < 2) continue;
      if (COMPANY_LEGAL_TOKENS.has(token)) continue;
      if (stopTokens.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= maxTokens) return out;
    }
  }

  return out;
}

function buildSearchDomainTags(values: string[]): string[] {
  const source = normalizeSearchText(values.join(" "))
    .toLowerCase()
    .replace(/ё/gu, "е");
  if (!source) return [];

  const tags: string[] = [];
  for (const rule of DOMAIN_TAG_RULES) {
    if (rule.pattern.test(source)) tags.push(rule.tag);
  }
  return tags;
}

function computeDataQualityScore(input: {
  normalizedName: string;
  description: string;
  serviceTitles: string[];
  serviceCategories: string[];
  categoryNames: string[];
  region: string;
  city: string;
  logoUrl: string;
}): number {
  let score = 0;
  if (input.normalizedName.length >= 3) score += 20;
  if (input.description.length >= 32) score += 20;
  if (input.serviceTitles.length > 0) score += 20;
  if (input.serviceCategories.length > 0 || input.categoryNames.length > 0) score += 20;
  if (input.region || input.city) score += 10;
  if (input.logoUrl) score += 10;
  return Math.max(0, Math.min(100, score));
}

function mapSearchIndexDbRow(row: BiznesinfoSearchIndexDbRow): BiznesinfoSearchIndexCompany {
  const lat = Number.isFinite(row.lat) ? row.lat : null;
  const lng = Number.isFinite(row.lng) ? row.lng : null;
  const logoUrl = normalizeSearchText(row.logo_url || "");
  const normalizedName = normalizeNameForSearchIndex(row.name || "", row.normalized_name || "");
  const serviceTitles = dedupeNormalizedSearchValues((row.service_titles || []).map((raw) => String(raw || "")));
  const serviceCategories = dedupeNormalizedSearchValues(
    (row.service_categories || []).map((raw) => String(raw || "")),
  );
  const categoryNames = dedupeNormalizedSearchValues(
    (row.category_names || []).map((raw) => String(raw || "")),
  );
  const nameTokens = buildStructuredSemanticTokens([normalizedName], {
    stopTokens: COMPANY_LEGAL_TOKENS,
    maxTokens: 24,
  });
  const serviceTokens = buildStructuredSemanticTokens(
    [
      row.services_text || "",
      ...serviceTitles,
      ...serviceCategories,
    ],
    { maxTokens: 160 },
  );
  const categoryTokens = buildStructuredSemanticTokens(categoryNames, { maxTokens: 80 });
  const domainTags = buildSearchDomainTags([
    row.name || "",
    row.description || "",
    row.services_text || "",
    ...serviceTitles,
    ...serviceCategories,
    ...categoryNames,
  ]);
  const dataQualityScore = computeDataQualityScore({
    normalizedName,
    description: normalizeSearchText(row.description || ""),
    serviceTitles,
    serviceCategories,
    categoryNames,
    region: normalizeSearchText(row.region || ""),
    city: normalizeSearchText(row.city || ""),
    logoUrl,
  });
  const dataQualityTier: "high" | "medium" | "basic" =
    dataQualityScore >= 70 ? "high" : dataQualityScore >= 40 ? "medium" : "basic";

  return {
    id: row.id,
    name: normalizeSearchText(row.name || ""),
    normalizedName,
    description: normalizeSearchText(row.description || ""),
    servicesText: normalizeSearchText(row.services_text || ""),
    serviceTitles,
    serviceCategories,
    categoryNames,
    region: normalizeSearchText(row.region || ""),
    city: normalizeSearchText(row.city || ""),
    status: normalizeSearchText(row.status || "active") || "active",
    logo_url: logoUrl,
    logo_rank: computeLogoRankFromUrl(logoUrl),
    nameTokens,
    serviceTokens,
    categoryTokens,
    domainTags,
    data_quality_score: dataQualityScore,
    data_quality_tier: dataQualityTier,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    _geo: hasValidGeo(lat, lng) ? { lat: lat as number, lng: lng as number } : null,
  };
}

export async function biznesinfoGetSearchItemsByIds(ids: string[]): Promise<BiznesinfoSearchItem[]> {
  await ensureBiznesinfoPgSchema();
  const targetIds = ids
    .map((raw) => String(raw || "").trim())
    .filter(Boolean);
  if (targetIds.length === 0) return [];

  const pool = getCatalogDbPool();
  const result = await pool.query<{
    id: string;
    name: string | null;
    description: string | null;
    region: string | null;
    city: string | null;
    status: string | null;
    logo_url: string | null;
    created_at: Date | string | null;
    lat: number | null;
    lng: number | null;
  }>(
    `
      SELECT
        id,
        name,
        description,
        region,
        city,
        status,
        logo_url,
        created_at,
        lat,
        lng
      FROM companies
      WHERE id = ANY($1::text[])
    `,
    [Array.from(new Set(targetIds))],
  );

  const byId = new Map<string, BiznesinfoSearchItem>();
  for (const row of result.rows) {
    const lat = Number.isFinite(row.lat) ? row.lat : null;
    const lng = Number.isFinite(row.lng) ? row.lng : null;
    byId.set(row.id, {
      id: row.id,
      name: normalizeSearchText(row.name || ""),
      description: normalizeSearchText(row.description || ""),
      region: normalizeSearchText(row.region || ""),
      city: normalizeSearchText(row.city || ""),
      status: normalizeSearchText(row.status || ""),
      logo_url: normalizeSearchText(row.logo_url || ""),
      createdAt: toIsoString(row.created_at),
      _geo: hasValidGeo(lat, lng) ? { lat: lat as number, lng: lng as number } : null,
    });
  }

  const out: BiznesinfoSearchItem[] = [];
  for (const id of targetIds) {
    const item = byId.get(id);
    if (item) out.push(item);
  }
  return out;
}

export async function biznesinfoListCompaniesForSearchIndex(ids?: string[]): Promise<BiznesinfoSearchIndexCompany[]> {
  await ensureBiznesinfoPgSchema();
  const targetIds = Array.isArray(ids)
    ? ids.map((raw) => String(raw || "").trim()).filter(Boolean)
    : [];

  const pool = getCatalogDbPool();
  const hasIdFilter = targetIds.length > 0;

  const result = await pool.query<BiznesinfoSearchIndexDbRow>(
    `
      SELECT
        c.id,
        c.name,
        c.normalized_name,
        c.description,
        c.region,
        c.city,
        c.status,
        c.logo_url,
        c.created_at,
        c.updated_at,
        c.lat,
        c.lng,
        COALESCE(
          array_to_string(
            array_remove(
              array_agg(
                DISTINCT NULLIF(
                  btrim(
                    concat_ws(' ', s.title, s.description, s.category)
                  ),
                  ''
                )
              ),
              NULL
            ),
            ' '
          ),
          ''
        ) AS services_text,
        COALESCE(
          array_remove(
            array_agg(DISTINCT NULLIF(btrim(s.title), '')),
            NULL
          ),
          '{}'::text[]
        ) AS service_titles,
        COALESCE(
          array_remove(
            array_agg(DISTINCT NULLIF(btrim(s.category), '')),
            NULL
          ),
          '{}'::text[]
        ) AS service_categories,
        COALESCE(
          array_remove(
            array_agg(DISTINCT NULLIF(btrim(s.category), '')),
            NULL
          ),
          '{}'::text[]
        ) AS category_names
      FROM companies c
      LEFT JOIN services s ON s.company_id = c.id
      ${hasIdFilter ? "WHERE c.id = ANY($1::text[])" : ""}
      GROUP BY
        c.id,
        c.name,
        c.normalized_name,
        c.description,
        c.region,
        c.city,
        c.status,
        c.logo_url,
        c.created_at,
        c.updated_at,
        c.lat,
        c.lng
      ORDER BY c.id ASC
    `,
    hasIdFilter ? [Array.from(new Set(targetIds))] : [],
  );

  return result.rows.map(mapSearchIndexDbRow);
}

export async function biznesinfoListCompaniesForSearchIndexBatch(
  params: BiznesinfoSearchIndexBatchParams = {},
): Promise<BiznesinfoSearchIndexCompany[]> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();
  const afterId = String(params.afterId || "").trim();
  const requestedLimit = Number(params.limit);
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(SEARCH_INDEX_BATCH_MAX_LIMIT, Math.trunc(requestedLimit)))
    : SEARCH_INDEX_BATCH_DEFAULT_LIMIT;

  const result = afterId
    ? await pool.query<BiznesinfoSearchIndexDbRow>(
      `
        SELECT
          c.id,
          c.name,
          c.normalized_name,
          c.description,
          c.region,
          c.city,
          c.status,
          c.logo_url,
          c.created_at,
          c.updated_at,
          c.lat,
          c.lng,
          COALESCE(
            array_to_string(
              array_remove(
                array_agg(
                  DISTINCT NULLIF(
                    btrim(
                      concat_ws(' ', s.title, s.description, s.category)
                    ),
                    ''
                  )
                ),
                NULL
              ),
              ' '
            ),
            ''
          ) AS services_text,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.title), '')),
              NULL
            ),
            '{}'::text[]
          ) AS service_titles,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.category), '')),
              NULL
            ),
            '{}'::text[]
          ) AS service_categories,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.category), '')),
              NULL
            ),
            '{}'::text[]
          ) AS category_names
        FROM companies c
        LEFT JOIN services s ON s.company_id = c.id
        WHERE c.id > $1
        GROUP BY
          c.id,
          c.name,
          c.normalized_name,
          c.description,
          c.region,
          c.city,
          c.status,
          c.logo_url,
          c.created_at,
          c.updated_at,
          c.lat,
          c.lng
        ORDER BY c.id ASC
        LIMIT $2
      `,
      [afterId, safeLimit],
    )
    : await pool.query<BiznesinfoSearchIndexDbRow>(
      `
        SELECT
          c.id,
          c.name,
          c.normalized_name,
          c.description,
          c.region,
          c.city,
          c.status,
          c.logo_url,
          c.created_at,
          c.updated_at,
          c.lat,
          c.lng,
          COALESCE(
            array_to_string(
              array_remove(
                array_agg(
                  DISTINCT NULLIF(
                    btrim(
                      concat_ws(' ', s.title, s.description, s.category)
                    ),
                    ''
                  )
                ),
                NULL
              ),
              ' '
            ),
            ''
          ) AS services_text,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.title), '')),
              NULL
            ),
            '{}'::text[]
          ) AS service_titles,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.category), '')),
              NULL
            ),
            '{}'::text[]
          ) AS service_categories,
          COALESCE(
            array_remove(
              array_agg(DISTINCT NULLIF(btrim(s.category), '')),
              NULL
            ),
            '{}'::text[]
          ) AS category_names
        FROM companies c
        LEFT JOIN services s ON s.company_id = c.id
        GROUP BY
          c.id,
          c.name,
          c.normalized_name,
          c.description,
          c.region,
          c.city,
          c.status,
          c.logo_url,
          c.created_at,
          c.updated_at,
          c.lat,
          c.lng
        ORDER BY c.id ASC
        LIMIT $1
      `,
      [safeLimit],
    );

  return result.rows.map(mapSearchIndexDbRow);
}

export async function upsertCompaniesAndServicesBatch(companies: BiznesinfoCompany[]): Promise<UpsertCompaniesServicesBatchResult> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();
  const client = await pool.connect();

  let upsertedCompanies = 0;
  let skippedCompanies = 0;
  let insertedServices = 0;

  try {
    await client.query("BEGIN");

    const preparedCompanies: PreparedCompanyImportRecord[] = [];
    for (const rawCompany of companies || []) {
      const prepared = prepareCompanyImportRecord(rawCompany);
      if (!prepared) {
        skippedCompanies += 1;
        continue;
      }
      preparedCompanies.push(prepared);
    }

    for (const company of preparedCompanies) {
      await client.query(
        `
          INSERT INTO companies (
            id, name, normalized_name, description,
            region, city, postal_code, lat, lng,
            logo_url, status, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, now(), now()
          )
          ON CONFLICT (id)
          DO UPDATE SET
            name = EXCLUDED.name,
            normalized_name = EXCLUDED.normalized_name,
            description = EXCLUDED.description,
            region = EXCLUDED.region,
            city = EXCLUDED.city,
            postal_code = EXCLUDED.postal_code,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            logo_url = EXCLUDED.logo_url,
            status = EXCLUDED.status,
            updated_at = now()
        `,
        [
          company.id,
          company.name,
          company.normalizedName,
          company.description,
          company.region,
          company.city,
          company.postalCode,
          company.lat,
          company.lng,
          company.logoUrl,
          company.status,
        ],
      );
    }

    const companyIds = preparedCompanies.map((company) => company.id);
    if (companyIds.length > 0) {
      await client.query("DELETE FROM services WHERE company_id = ANY($1::text[])", [companyIds]);
    }

    for (const company of preparedCompanies) {
      for (let idx = 0; idx < company.services.length; idx += 1) {
        const service = company.services[idx];
        await client.query(
          `
            INSERT INTO services (
              id, company_id, title, description, category, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, now(), now())
          `,
          [
            buildServiceRecordId(company.id, idx),
            company.id,
            service.title,
            service.description,
            service.category,
          ],
        );
        insertedServices += 1;
      }
    }

    upsertedCompanies = preparedCompanies.length;
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }

  return {
    total: companies.length,
    upsertedCompanies,
    skippedCompanies,
    insertedServices,
  };
}

export type BackfillEmptyCompanyRegionsResult = {
  scanned: number;
  updated: number;
  remainingEmpty: number;
  unresolved: number;
  sampleUnresolvedIds: string[];
};

function payloadFieldText(payload: unknown, field: "city" | "region" | "address"): string {
  if (!payload || typeof payload !== "object") return "";
  return String((payload as Record<string, unknown>)[field] || "")
    .replace(/\s+/gu, " ")
    .trim();
}

export async function backfillEmptyCompanyRegions(limit = 10000): Promise<BackfillEmptyCompanyRegionsResult> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50000, Math.trunc(limit))) : 10000;
  const cityRegionHints = await loadBackfillRegionHintsByCity(pool);

  const candidates = await pool.query<{
    id: string;
    city: string | null;
    postal_code: string | null;
    payload: unknown;
  }>(
    `
      SELECT
        c.id,
        c.city,
        c.postal_code,
        bc.payload
      FROM companies c
      LEFT JOIN biznesinfo_companies bc ON bc.id = c.id
      WHERE c.region = ''
      ORDER BY c.id ASC
      LIMIT $1
    `,
    [safeLimit],
  );

  const rows = candidates.rows || [];
  if (rows.length === 0) {
    const remaining = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM companies WHERE region = ''`,
    );
    return {
      scanned: 0,
      updated: 0,
      remainingEmpty: Number.parseInt(String(remaining.rows[0]?.count || "0"), 10) || 0,
      unresolved: 0,
      sampleUnresolvedIds: [],
    };
  }

  const client = await pool.connect();
  let updated = 0;
  const unresolvedIds: string[] = [];

  try {
    await client.query("BEGIN");

    for (const row of rows) {
      const payloadCity = payloadFieldText(row.payload, "city");
      const payloadRegion = payloadFieldText(row.payload, "region");
      const payloadAddress = payloadFieldText(row.payload, "address");

      const city = String(row.city || payloadCity || "").replace(/\s+/gu, " ").trim();
      const postalCode = String(row.postal_code || "").trim();
      const address = [payloadAddress, city, postalCode].filter(Boolean).join(" ");

      let inferredRegion = normalizeRegionSlug(city, payloadRegion, address);
      if (!inferredRegion) {
        const settlementFromAddress = extractSettlementFromAddress(payloadAddress);
        const lookupCandidates = [city, payloadCity, settlementFromAddress];
        for (const candidate of lookupCandidates) {
          const cityKey = normalizeCityLookupKey(candidate);
          if (cityKey && cityRegionHints.has(cityKey)) {
            inferredRegion = cityRegionHints.get(cityKey) || null;
            break;
          }

          const settlementKey = normalizeSettlementLookupKey(candidate);
          if (settlementKey && cityRegionHints.has(settlementKey)) {
            inferredRegion = cityRegionHints.get(settlementKey) || null;
            break;
          }
        }
      }

      if (!inferredRegion) inferredRegion = COMMON_REGION_FALLBACK;

      const updateResult = await client.query(
        `
          UPDATE companies
          SET region = $2, updated_at = now()
          WHERE id = $1 AND region = ''
        `,
        [row.id, inferredRegion],
      );
      updated += updateResult.rowCount || 0;
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }

  const remaining = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM companies WHERE region = ''`,
  );

  return {
    scanned: rows.length,
    updated,
    remainingEmpty: Number.parseInt(String(remaining.rows[0]?.count || "0"), 10) || 0,
    unresolved: Math.max(0, rows.length - updated),
    sampleUnresolvedIds: unresolvedIds,
  };
}

export async function replaceBiznesinfoCatalog(companies: BiznesinfoCompany[]): Promise<ReplaceCatalogResult> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();
  const client = await pool.connect();

  let inserted = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE biznesinfo_company_rubrics, biznesinfo_company_categories, biznesinfo_rubrics, biznesinfo_categories, biznesinfo_companies RESTART IDENTITY");

    for (const rawCompany of companies || []) {
      const sourceId = String(rawCompany?.source_id || "").trim();
      if (!sourceId) {
        skipped += 1;
        continue;
      }

      const company = sanitizeCompanyRecord({
        ...rawCompany,
        source: "biznesinfo",
        source_id: sourceId,
      } as BiznesinfoCompany);

      if (isExcludedBiznesinfoCompany(company)) {
        skipped += 1;
        continue;
      }

      const regionSlug = normalizeRegionSlug(company.city || "", company.region || "", company.address || "");
      const cityNorm = normalizeCityForFilter(company.city || "");
      const primaryCategory = company.categories?.[0] ?? null;
      const primaryRubric = company.rubrics?.[0] ?? null;
      const searchText = buildCompanySearchText(company);

      await client.query(
        `
          INSERT INTO biznesinfo_companies (
            id, source, unp, name, search_text, region_slug, city_norm,
            primary_category_slug, primary_category_name,
            primary_rubric_slug, primary_rubric_name,
            payload, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9,
            $10, $11,
            $12::jsonb, now()
          )
        `,
        [
          sourceId,
          "biznesinfo",
          normalizeBiznesinfoUnp(company.unp || ""),
          company.name || "",
          searchText,
          regionSlug,
          cityNorm,
          primaryCategory?.slug ?? null,
          primaryCategory?.name ?? null,
          primaryRubric?.slug ?? null,
          primaryRubric?.name ?? null,
          JSON.stringify(company),
        ],
      );

      const seenCategories = new Set<string>();
      for (let idx = 0; idx < (company.categories || []).length; idx += 1) {
        const category = company.categories[idx];
        if (!category?.slug) continue;
        const slug = String(category.slug).trim();
        if (!slug || seenCategories.has(slug)) continue;
        seenCategories.add(slug);

        const name = String(category.name || slug).trim() || slug;
        const url = String(category.url || `/catalog/${slug}`).trim() || `/catalog/${slug}`;

        await client.query(
          `
            INSERT INTO biznesinfo_categories (slug, name, url)
            VALUES ($1, $2, $3)
            ON CONFLICT (slug)
            DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url
          `,
          [slug, name, url],
        );

        await client.query(
          `
            INSERT INTO biznesinfo_company_categories (
              company_id, category_slug, category_name, category_url, position
            ) VALUES ($1, $2, $3, $4, $5)
          `,
          [sourceId, slug, name, url, idx],
        );
      }

      const seenRubrics = new Set<string>();
      for (let idx = 0; idx < (company.rubrics || []).length; idx += 1) {
        const rubric = company.rubrics[idx];
        if (!rubric?.slug || !rubric?.category_slug) continue;
        const rubricSlug = String(rubric.slug).trim();
        const categorySlug = String(rubric.category_slug).trim();
        if (!rubricSlug || !categorySlug || seenRubrics.has(rubricSlug)) continue;
        seenRubrics.add(rubricSlug);

        const rubricName = String(rubric.name || rubricSlug).trim() || rubricSlug;
        const rubricUrl = String(rubric.url || `/catalog/${categorySlug}/${rubricSlug.split("/").slice(1).join("/")}`).trim()
          || `/catalog/${categorySlug}/${rubricSlug.split("/").slice(1).join("/")}`;
        const categoryName = String(rubric.category_name || categorySlug).trim() || categorySlug;

        await client.query(
          `
            INSERT INTO biznesinfo_rubrics (slug, name, url, category_slug, category_name)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (slug)
            DO UPDATE SET
              name = EXCLUDED.name,
              url = EXCLUDED.url,
              category_slug = EXCLUDED.category_slug,
              category_name = EXCLUDED.category_name
          `,
          [rubricSlug, rubricName, rubricUrl, categorySlug, categoryName],
        );

        await client.query(
          `
            INSERT INTO biznesinfo_company_rubrics (
              company_id, rubric_slug, rubric_name, rubric_url,
              category_slug, category_name, position
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [sourceId, rubricSlug, rubricName, rubricUrl, categorySlug, categoryName, idx],
        );
      }

      inserted += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }

  return {
    total: companies.length,
    inserted,
    skipped,
  };
}

async function getCompanyRowsByIds(ids: string[]): Promise<Array<{ id: string; region_slug: string | null; payload: unknown }>> {
  if (ids.length === 0) return [];
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const result = await pool.query<{
    id: string;
    region_slug: string | null;
    payload: unknown;
  }>(
    `
      SELECT id, region_slug, payload
      FROM biznesinfo_companies
      WHERE id = ANY($1::text[])
    `,
    [ids],
  );

  return result.rows;
}

export async function biznesinfoGetCompaniesSummaryByIds(ids: string[]): Promise<BiznesinfoCompanySummary[]> {
  const targetIds = ids
    .map((raw) => String(raw || "").trim())
    .filter(Boolean);
  if (targetIds.length === 0) return [];

  const uniqueIds = Array.from(new Set(targetIds));
  const [rows, searchItems] = await Promise.all([
    getCompanyRowsByIds(uniqueIds),
    biznesinfoGetSearchItemsByIds(uniqueIds),
  ]);
  const byId = new Map<string, BiznesinfoCompanySummary>();
  const searchById = new Map<string, BiznesinfoSearchItem>();

  for (const item of searchItems) {
    searchById.set(item.id, item);
  }

  for (const row of rows) {
    const company = toBiznesinfoCompany(row.payload);
    if (!company.source_id) continue;
    if (isExcludedBiznesinfoCompany(company)) continue;
    const summary = buildCompanySummary(company, row.region_slug || null);
    byId.set(row.id, mergeSummaryWithSearchItem(summary, searchById.get(row.id)));
  }

  for (const item of searchItems) {
    if (byId.has(item.id)) continue;
    if (isExcludedBiznesinfoCompany({ source_id: item.id })) continue;
    byId.set(item.id, buildSummaryFromSearchItem(item));
  }

  const out: BiznesinfoCompanySummary[] = [];
  for (const id of targetIds) {
    const summary = byId.get(id);
    if (summary) out.push(summary);
  }
  return out;
}

export async function biznesinfoGetCompanyCardsByIds(ids: string[]): Promise<Array<{
  id: string;
  unp: string;
  name: string;
  description: string;
  address: string;
  city: string;
  phones: string[];
  emails: string[];
  logo_url: string;
  categories: Array<{ slug: string; name: string }>;
  rubrics: Array<{ slug: string; name: string; category_slug: string | null; category_name: string | null }>;
  geo: { lat: number; lng: number } | null;
}>> {
  const targetIds = ids
    .map((raw) => String(raw || "").trim())
    .filter(Boolean);
  if (targetIds.length === 0) return [];

  const rows = await getCompanyRowsByIds(Array.from(new Set(targetIds)));
  const byId = new Map<string, {
    id: string;
    unp: string;
    name: string;
    description: string;
    address: string;
    city: string;
    phones: string[];
    emails: string[];
    logo_url: string;
    categories: Array<{ slug: string; name: string }>;
    rubrics: Array<{ slug: string; name: string; category_slug: string | null; category_name: string | null }>;
    geo: { lat: number; lng: number } | null;
  }>();

  for (const row of rows) {
    const company = toBiznesinfoCompany(row.payload);
    if (!company.source_id) continue;
    if (isExcludedBiznesinfoCompany(company)) continue;

    byId.set(row.id, {
      id: row.id,
      unp: company.unp || "",
      name: company.name || "",
      description: company.description || company.about || "",
      address: company.address || "",
      city: company.city || "",
      phones: company.phones || [],
      emails: company.emails || [],
      logo_url: company.logo_url || "",
      categories: (company.categories || []).map((item) => ({
        slug: item.slug,
        name: item.name || item.slug,
      })),
      rubrics: (company.rubrics || []).map((item) => ({
        slug: item.slug,
        name: item.name || item.slug,
        category_slug: item.category_slug || null,
        category_name: item.category_name || item.category_slug || null,
      })),
      geo:
        isFiniteNumber(company.extra?.lat) && isFiniteNumber(company.extra?.lng)
          ? { lat: company.extra.lat as number, lng: company.extra.lng as number }
          : null,
    });
  }

  const out: Array<{
    id: string;
    unp: string;
    name: string;
    description: string;
    address: string;
    city: string;
    phones: string[];
    emails: string[];
    logo_url: string;
    categories: Array<{ slug: string; name: string }>;
    rubrics: Array<{ slug: string; name: string; category_slug: string | null; category_name: string | null }>;
    geo: { lat: number; lng: number } | null;
  }> = [];

  for (const id of targetIds) {
    const card = byId.get(id);
    if (card) out.push(card);
  }

  return out;
}

export async function biznesinfoGetCompanyById(id: string): Promise<BiznesinfoCompanyResponse> {
  const rawId = (id || "").trim();
  if (!rawId) throw new Error("company_not_found:");

  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const exact = await pool.query<{ id: string; region_slug: string | null; payload: unknown }>(
    `SELECT id, region_slug, payload FROM biznesinfo_companies WHERE id = $1 LIMIT 1`,
    [rawId],
  );

  let row = exact.rows[0] || null;

  if (!row) {
    const normalizedTarget = normalizeCompanyIdForMatch(rawId);
    const fallback = await pool.query<{ id: string; region_slug: string | null; payload: unknown }>(
      `
        SELECT id, region_slug, payload
        FROM biznesinfo_companies
        WHERE regexp_replace(lower(id), '[-‐‑‒–—―]', '', 'g') = $1
        LIMIT 1
      `,
      [normalizedTarget],
    );
    row = fallback.rows[0] || null;
  }

  if (!row) {
    throw new Error(`company_not_found:${rawId}`);
  }

  const company = toBiznesinfoCompany(row.payload);
  if (!company.source_id || isExcludedBiznesinfoCompany(company)) {
    throw new Error(`company_not_found:${rawId}`);
  }

  return {
    id: row.id,
    company,
    generated_keywords: buildCompanyKeywordPhrases(company),
    primary: {
      category_slug: company.categories?.[0]?.slug ?? null,
      rubric_slug: company.rubrics?.[0]?.slug ?? null,
    },
  };
}

export async function biznesinfoGetCatalogFromPg(region: string | null): Promise<BiznesinfoCatalogResponse> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const regionKeys = regionAliasKeys(region);
  const hasRegion = regionKeys.length > 0;

  const [categoriesRes, rubricsRes, categoryCountsRes, rubricCountsRes, totalsRes, updatedAtRes] = await Promise.all([
    pool.query<{ slug: string; name: string; url: string }>(
      `SELECT slug, name, url FROM biznesinfo_categories ORDER BY name ASC, slug ASC`,
    ),
    pool.query<{ slug: string; name: string; url: string; category_slug: string; category_name: string }>(
      `SELECT slug, name, url, category_slug, category_name FROM biznesinfo_rubrics ORDER BY category_slug ASC, name ASC, slug ASC`,
    ),
    hasRegion
      ? pool.query<{ slug: string; count: string }>(
          `
            SELECT cc.category_slug AS slug, COUNT(DISTINCT cc.company_id)::text AS count
            FROM biznesinfo_company_categories cc
            JOIN biznesinfo_companies c ON c.id = cc.company_id
            WHERE c.region_slug = ANY($1::text[])
            GROUP BY cc.category_slug
          `,
          [regionKeys],
        )
      : pool.query<{ slug: string; count: string }>(
          `
            SELECT cc.category_slug AS slug, COUNT(DISTINCT cc.company_id)::text AS count
            FROM biznesinfo_company_categories cc
            GROUP BY cc.category_slug
          `,
        ),
    hasRegion
      ? pool.query<{ slug: string; count: string }>(
          `
            SELECT cr.rubric_slug AS slug, COUNT(DISTINCT cr.company_id)::text AS count
            FROM biznesinfo_company_rubrics cr
            JOIN biznesinfo_companies c ON c.id = cr.company_id
            WHERE c.region_slug = ANY($1::text[])
            GROUP BY cr.rubric_slug
          `,
          [regionKeys],
        )
      : pool.query<{ slug: string; count: string }>(
          `
            SELECT cr.rubric_slug AS slug, COUNT(DISTINCT cr.company_id)::text AS count
            FROM biznesinfo_company_rubrics cr
            GROUP BY cr.rubric_slug
          `,
        ),
    hasRegion
      ? pool.query<{ companies_total: string; categories_total: string; rubrics_total: string }>(
          `
            SELECT
              (SELECT COUNT(*)::text FROM biznesinfo_companies c WHERE c.region_slug = ANY($1::text[])) AS companies_total,
              (SELECT COUNT(*)::text FROM biznesinfo_categories) AS categories_total,
              (SELECT COUNT(*)::text FROM biznesinfo_rubrics) AS rubrics_total
          `,
          [regionKeys],
        )
      : pool.query<{ companies_total: string; categories_total: string; rubrics_total: string }>(
          `
            SELECT
              (SELECT COUNT(*)::text FROM biznesinfo_companies) AS companies_total,
              (SELECT COUNT(*)::text FROM biznesinfo_categories) AS categories_total,
              (SELECT COUNT(*)::text FROM biznesinfo_rubrics) AS rubrics_total
          `,
        ),
    pool.query<{ updated_at: string | null }>(
      `SELECT to_char(MAX(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at FROM biznesinfo_companies`,
    ),
  ]);

  const categoryCountBySlug = new Map<string, number>();
  for (const row of categoryCountsRes.rows) {
    const count = Number.parseInt(String(row.count || "0"), 10);
    categoryCountBySlug.set(row.slug, Number.isFinite(count) ? count : 0);
  }

  const rubricCountBySlug = new Map<string, number>();
  for (const row of rubricCountsRes.rows) {
    const count = Number.parseInt(String(row.count || "0"), 10);
    rubricCountBySlug.set(row.slug, Number.isFinite(count) ? count : 0);
  }

  const rubricsByCategory = new Map<string, Array<{ slug: string; name: string; url: string; count: number }>>();
  for (const rubric of rubricsRes.rows) {
    const list = rubricsByCategory.get(rubric.category_slug) || [];
    list.push({
      slug: rubric.slug,
      name: rubric.name || rubric.slug,
      url: rubric.url || "",
      count: rubricCountBySlug.get(rubric.slug) || 0,
    });
    rubricsByCategory.set(rubric.category_slug, list);
  }

  const categories: BiznesinfoCatalogResponse["categories"] = categoriesRes.rows.map((category) => ({
    slug: category.slug,
    name: category.name || category.slug,
    url: category.url || `/catalog/${category.slug}`,
    icon: BIZNESINFO_CATEGORY_ICONS[category.slug] || null,
    company_count: categoryCountBySlug.get(category.slug) || 0,
    rubrics: (rubricsByCategory.get(category.slug) || []).sort((a, b) =>
      (a.name || a.slug).localeCompare(b.name || b.slug, "ru", { sensitivity: "base" }),
    ),
  }));

  const totals = totalsRes.rows[0] || { companies_total: "0", categories_total: "0", rubrics_total: "0" };

  return {
    stats: {
      companies_total: Number.parseInt(String(totals.companies_total || "0"), 10) || 0,
      categories_total: Number.parseInt(String(totals.categories_total || "0"), 10) || 0,
      rubrics_total: Number.parseInt(String(totals.rubrics_total || "0"), 10) || 0,
      updated_at: updatedAtRes.rows[0]?.updated_at || null,
      source_path: "postgresql",
    },
    categories,
  };
}

export async function biznesinfoGetRubricCompaniesFromPg(params: {
  slug: string;
  region: string | null;
  query: string | null;
  offset: number;
  limit: number;
}): Promise<BiznesinfoRubricResponse> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const slug = (params.slug || "").trim();
  if (!slug) throw new Error("rubric_not_found:");

  const rubricRes = await pool.query<{
    slug: string;
    name: string;
    url: string;
    category_slug: string;
    category_name: string;
  }>(
    `
      SELECT slug, name, url, category_slug, category_name
      FROM biznesinfo_rubrics
      WHERE slug = $1
      LIMIT 1
    `,
    [slug],
  );
  const rubric = rubricRes.rows[0];
  if (!rubric) {
    throw new Error(`rubric_not_found:${slug}`);
  }

  const regionKeys = regionAliasKeys(params.region);
  const normalizedQuery = normalizeToken((params.query || "").trim());

  const relevanceGuardSql =
    "(c.primary_rubric_slug = $1 OR c.primary_category_slug = $2 OR (c.primary_rubric_slug IS NULL AND c.primary_category_slug IS NULL))";
  const where: string[] = ["cr.rubric_slug = $1", relevanceGuardSql];
  const values: Array<string | string[]> = [slug, rubric.category_slug];
  let index = 3;

  if (regionKeys.length > 0) {
    where.push(`c.region_slug = ANY($${index}::text[])`);
    values.push(regionKeys);
    index += 1;
  }

  if (normalizedQuery) {
    where.push(`c.search_text ILIKE $${index}`);
    values.push(`%${normalizedQuery}%`);
    index += 1;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRes = await pool.query<{ total: string }>(
    `
      SELECT COUNT(DISTINCT c.id)::text AS total
      FROM biznesinfo_company_rubrics cr
      JOIN biznesinfo_companies c ON c.id = cr.company_id
      ${whereSql}
    `,
    values,
  );

  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));

  const idsRes = await pool.query<{ id: string }>(
    `
      SELECT c.id
      FROM biznesinfo_company_rubrics cr
      JOIN biznesinfo_companies c ON c.id = cr.company_id
      ${whereSql}
      GROUP BY c.id, c.name
      ORDER BY
        CASE
          WHEN btrim(COALESCE(c.payload->>'logo_url', '')) <> ''
            AND lower(COALESCE(c.payload->>'logo_url', '')) NOT LIKE '%/images/logo/no-logo%'
            AND lower(COALESCE(c.payload->>'logo_url', '')) NOT LIKE '%/images/logo/no_logo%'
            AND lower(COALESCE(c.payload->>'logo_url', '')) NOT LIKE '%/images/logo/noimage%'
            AND lower(COALESCE(c.payload->>'logo_url', '')) NOT LIKE '%/images/logo/no-image%'
          THEN 1
          ELSE 0
        END DESC,
        c.name ASC,
        c.id ASC
      OFFSET $${index}
      LIMIT $${index + 1}
    `,
    [...values, offset, limit],
  );

  const ids = idsRes.rows.map((row) => row.id);
  const companies = await biznesinfoGetCompaniesSummaryByIds(ids);

  const rubricCountRes = regionKeys.length > 0
    ? await pool.query<{ count: string }>(
        `
          SELECT COUNT(DISTINCT c.id)::text AS count
          FROM biznesinfo_company_rubrics cr
          JOIN biznesinfo_companies c ON c.id = cr.company_id
          WHERE cr.rubric_slug = $1
            AND c.region_slug = ANY($2::text[])
            AND ${relevanceGuardSql}
        `,
        [slug, regionKeys, rubric.category_slug],
      )
    : await pool.query<{ count: string }>(
        `
          SELECT COUNT(DISTINCT c.id)::text AS count
          FROM biznesinfo_company_rubrics cr
          JOIN biznesinfo_companies c ON c.id = cr.company_id
          WHERE cr.rubric_slug = $1
            AND ${relevanceGuardSql}
        `,
        [slug, rubric.category_slug],
      );

  return {
    rubric: {
      slug: rubric.slug,
      name: rubric.name || rubric.slug,
      url: rubric.url || "",
      category_slug: rubric.category_slug,
      category_name: rubric.category_name || rubric.category_slug,
      count: Number.parseInt(String(rubricCountRes.rows[0]?.count || "0"), 10) || 0,
    },
    companies,
    page: {
      offset,
      limit,
      total: Number.parseInt(String(totalRes.rows[0]?.total || "0"), 10) || 0,
    },
  };
}

export async function biznesinfoSuggestFromPg(params: {
  query: string;
  region: string | null;
  limit: number;
}): Promise<BiznesinfoSuggestResponse> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const q = normalizeToken(params.query || "");
  const safeLimit = Math.max(1, Math.min(20, params.limit || 8));
  if (q.length < 2) {
    return { query: params.query, suggestions: [] };
  }

  const regionKeys = regionAliasKeys(params.region);
  const hasRegion = regionKeys.length > 0;

  const [categoryCountsRes, rubricCountsRes] = await Promise.all([
    hasRegion
      ? pool.query<{ slug: string; count: string }>(
          `
            SELECT cc.category_slug AS slug, COUNT(DISTINCT cc.company_id)::text AS count
            FROM biznesinfo_company_categories cc
            JOIN biznesinfo_companies c ON c.id = cc.company_id
            WHERE c.region_slug = ANY($1::text[])
            GROUP BY cc.category_slug
          `,
          [regionKeys],
        )
      : pool.query<{ slug: string; count: string }>(
          `
            SELECT category_slug AS slug, COUNT(DISTINCT company_id)::text AS count
            FROM biznesinfo_company_categories
            GROUP BY category_slug
          `,
        ),
    hasRegion
      ? pool.query<{ slug: string; count: string }>(
          `
            SELECT cr.rubric_slug AS slug, COUNT(DISTINCT cr.company_id)::text AS count
            FROM biznesinfo_company_rubrics cr
            JOIN biznesinfo_companies c ON c.id = cr.company_id
            WHERE c.region_slug = ANY($1::text[])
            GROUP BY cr.rubric_slug
          `,
          [regionKeys],
        )
      : pool.query<{ slug: string; count: string }>(
          `
            SELECT rubric_slug AS slug, COUNT(DISTINCT company_id)::text AS count
            FROM biznesinfo_company_rubrics
            GROUP BY rubric_slug
          `,
        ),
  ]);

  const categoryCountBySlug = new Map<string, number>();
  for (const row of categoryCountsRes.rows) {
    categoryCountBySlug.set(row.slug, Number.parseInt(String(row.count || "0"), 10) || 0);
  }

  const rubricCountBySlug = new Map<string, number>();
  for (const row of rubricCountsRes.rows) {
    rubricCountBySlug.set(row.slug, Number.parseInt(String(row.count || "0"), 10) || 0);
  }

  const suggestions: BiznesinfoSuggestResponse["suggestions"] = [];

  const categoriesRes = await pool.query<{ slug: string; name: string; url: string }>(
    `
      SELECT slug, name, url
      FROM biznesinfo_categories
      WHERE lower(name) LIKE $1
      ORDER BY name ASC, slug ASC
      LIMIT $2
    `,
    [`%${q}%`, String(safeLimit)],
  );

  for (const category of categoriesRes.rows) {
    if (suggestions.length >= safeLimit) break;
    suggestions.push({
      type: "category",
      slug: category.slug,
      name: category.name || category.slug,
      url: `/catalog/${category.slug}`,
      icon: BIZNESINFO_CATEGORY_ICONS[category.slug] || null,
      count: categoryCountBySlug.get(category.slug) || 0,
    });
  }

  if (suggestions.length < safeLimit) {
    const remain = safeLimit - suggestions.length;
    const rubricsRes = await pool.query<{
      slug: string;
      name: string;
      url: string;
      category_slug: string;
      category_name: string;
    }>(
      `
        SELECT slug, name, url, category_slug, category_name
        FROM biznesinfo_rubrics
        WHERE lower(name) LIKE $1
        ORDER BY name ASC, slug ASC
        LIMIT $2
      `,
      [`%${q}%`, String(remain)],
    );

    for (const rubric of rubricsRes.rows) {
      if (suggestions.length >= safeLimit) break;
      suggestions.push({
        type: "rubric",
        slug: rubric.slug,
        name: rubric.name || rubric.slug,
        url: `/catalog/${rubric.category_slug}/${rubric.slug.split("/").slice(1).join("/")}`,
        icon: BIZNESINFO_CATEGORY_ICONS[rubric.category_slug] || null,
        category_name: rubric.category_name || rubric.category_slug,
        count: rubricCountBySlug.get(rubric.slug) || 0,
      });
    }
  }

  if (suggestions.length < safeLimit) {
    const remain = safeLimit - suggestions.length;
    const compact = q.replace(/[^a-zа-я0-9]+/giu, "");

    const where: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (regionKeys.length > 0) {
      where.push(`region_slug = ANY($${idx}::text[])`);
      values.push(regionKeys);
      idx += 1;
    }

    const textConds: string[] = [`lower(name) LIKE $${idx}`];
    values.push(`%${q}%`);
    idx += 1;

    if (compact) {
      textConds.push(`regexp_replace(lower(name), '[^a-zа-я0-9]+', '', 'g') LIKE $${idx}`);
      values.push(`%${compact}%`);
      idx += 1;

      textConds.push(`regexp_replace(lower(id), '[^a-zа-я0-9]+', '', 'g') LIKE $${idx}`);
      values.push(`%${compact}%`);
      idx += 1;
    }

    where.push(`(${textConds.join(" OR ")})`);

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const companiesRes = await pool.query<{
      id: string;
      name: string;
      address: string;
      city: string;
      primary_category_slug: string | null;
    }>(
      `
        SELECT id, name,
          COALESCE(payload->>'address', '') AS address,
          COALESCE(payload->>'city', '') AS city,
          primary_category_slug
        FROM biznesinfo_companies
        ${whereSql}
        ORDER BY name ASC, id ASC
        LIMIT $${idx}
      `,
      [...values, remain],
    );

    for (const company of companiesRes.rows) {
      if (suggestions.length >= safeLimit) break;
      suggestions.push({
        type: "company",
        id: company.id,
        name: company.name,
        url: `/company/${companySlugForUrl(company.id)}`,
        icon: company.primary_category_slug ? BIZNESINFO_CATEGORY_ICONS[company.primary_category_slug] || null : null,
        subtitle: company.address || company.city || "",
      });
    }
  }

  return {
    query: params.query,
    suggestions,
  };
}

export type BiznesinfoRubricHint =
  | { type: "category"; slug: string; name: string; url: string; count: number }
  | { type: "rubric"; slug: string; name: string; url: string; category_slug: string; category_name: string; count: number };

function normalizeHintQueryTokens(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tokens = tokenizeSemanticText(raw);
  for (const token of tokens) {
    const normalized = normalizeHintToken(token);
    if (!normalized || normalized.length < 2) continue;
    if (isDescriptorToken(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 8) break;
  }
  return out;
}

export async function biznesinfoDetectRubricHintsFromPg(params: {
  text: string;
  limit: number;
}): Promise<BiznesinfoRubricHint[]> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();

  const limit = Math.max(1, Math.min(12, params.limit || 8));
  const tokens = normalizeHintQueryTokens((params.text || "").slice(0, 600));
  if (tokens.length === 0) return [];

  const likePatterns = tokens.map((token) => `%${token}%`);

  const [rubricRowsRes, categoryRowsRes, rubricCountRes, categoryCountRes] = await Promise.all([
    pool.query<{
      slug: string;
      name: string;
      url: string;
      category_slug: string;
      category_name: string;
    }>(
      `
        SELECT slug, name, url, category_slug, category_name
        FROM biznesinfo_rubrics
        WHERE lower(name) LIKE ANY($1::text[])
           OR lower(category_name) LIKE ANY($1::text[])
        ORDER BY name ASC, slug ASC
        LIMIT 300
      `,
      [likePatterns],
    ),
    pool.query<{ slug: string; name: string; url: string }>(
      `
        SELECT slug, name, url
        FROM biznesinfo_categories
        WHERE lower(name) LIKE ANY($1::text[])
        ORDER BY name ASC, slug ASC
        LIMIT 100
      `,
      [likePatterns],
    ),
    pool.query<{ slug: string; count: string }>(
      `
        SELECT rubric_slug AS slug, COUNT(DISTINCT company_id)::text AS count
        FROM biznesinfo_company_rubrics
        GROUP BY rubric_slug
      `,
    ),
    pool.query<{ slug: string; count: string }>(
      `
        SELECT category_slug AS slug, COUNT(DISTINCT company_id)::text AS count
        FROM biznesinfo_company_categories
        GROUP BY category_slug
      `,
    ),
  ]);

  const rubricCountBySlug = new Map<string, number>();
  for (const row of rubricCountRes.rows) {
    rubricCountBySlug.set(row.slug, Number.parseInt(String(row.count || "0"), 10) || 0);
  }

  const categoryCountBySlug = new Map<string, number>();
  for (const row of categoryCountRes.rows) {
    categoryCountBySlug.set(row.slug, Number.parseInt(String(row.count || "0"), 10) || 0);
  }

  const scoredRubrics = rubricRowsRes.rows
    .map((rubric) => {
      const nameScore = scoreHintText(rubric.name || "", tokens);
      const categoryScore = scoreHintText(rubric.category_name || rubric.category_slug || "", tokens);
      const score = nameScore * 3 + categoryScore;
      return {
        rubric,
        score,
        count: rubricCountBySlug.get(rubric.slug) || 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.count !== a.count) return b.count - a.count;
      return (a.rubric.slug || "").localeCompare(b.rubric.slug || "", "ru", { sensitivity: "base" });
    });

  const categoryBySlug = new Map<string, { slug: string; name: string; url: string }>();
  for (const category of categoryRowsRes.rows) {
    categoryBySlug.set(category.slug, category);
  }

  const categoryHints: BiznesinfoRubricHint[] = [];
  const categorySeen = new Set<string>();
  for (const item of scoredRubrics) {
    if (categoryHints.length >= Math.min(2, limit)) break;
    const slug = (item.rubric.category_slug || "").trim();
    if (!slug || categorySeen.has(slug.toLowerCase())) continue;

    const category = categoryBySlug.get(slug);
    if (!category) continue;

    categorySeen.add(slug.toLowerCase());
    categoryHints.push({
      type: "category",
      slug: category.slug,
      name: category.name || category.slug,
      url: `/catalog/${category.slug}`,
      count: categoryCountBySlug.get(category.slug) || 0,
    });
  }

  const rubricHints: BiznesinfoRubricHint[] = scoredRubrics
    .slice(0, Math.max(0, limit - categoryHints.length))
    .map((item) => ({
      type: "rubric" as const,
      slug: item.rubric.slug,
      name: item.rubric.name || item.rubric.slug,
      url: `/catalog/${item.rubric.category_slug}/${item.rubric.slug.split("/").slice(1).join("/")}`,
      category_slug: item.rubric.category_slug,
      category_name: item.rubric.category_name || item.rubric.category_slug,
      count: item.count,
    }));

  if (categoryHints.length > 0) {
    return [...categoryHints, ...rubricHints].slice(0, limit);
  }

  const fallbackCategories = categoryRowsRes.rows
    .map((category) => ({
      type: "category" as const,
      slug: category.slug,
      name: category.name || category.slug,
      url: `/catalog/${category.slug}`,
      count: categoryCountBySlug.get(category.slug) || 0,
      score: scoreHintText(category.name || category.slug, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.count !== a.count) return b.count - a.count;
      return a.slug.localeCompare(b.slug, "ru", { sensitivity: "base" });
    })
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);

  if (fallbackCategories.length > 0) return fallbackCategories;
  return rubricHints.slice(0, limit);
}

export async function biznesinfoListCompaniesForIndexing(): Promise<BiznesinfoCompany[]> {
  await ensureBiznesinfoPgSchema();
  const pool = getCatalogDbPool();
  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM biznesinfo_companies ORDER BY id ASC`,
  );

  const out: BiznesinfoCompany[] = [];
  for (const row of result.rows) {
    const company = toBiznesinfoCompany(row.payload);
    if (!company.source_id) continue;
    if (isExcludedBiznesinfoCompany(company)) continue;
    out.push(company);
  }
  return out;
}
