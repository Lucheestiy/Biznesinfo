import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { isAddressLikeLocationQuery, normalizeCityForFilter } from "@/lib/utils/location";
import { generateCompanyKeywordPhrases, keywordPhrasesToSearchTokens } from "./keywords";
import { getServerKeywordGenerationOptions } from "./keywordRuntime";
import { BIZNESINFO_KEYWORD_OVERRIDES } from "./keywordOverrides";
import { BIZNESINFO_LOGO_OVERRIDES } from "./logoOverrides";
import { BIZNESINFO_MAP_OVERRIDES } from "./mapOverrides";
import { BIZNESINFO_WEBSITE_OVERRIDES } from "./websiteOverrides";
import { companySlugForUrl } from "./slug";
import { isExcludedBiznesinfoCompany } from "./exclusions";

import type {
  BiznesinfoCatalogResponse,
  BiznesinfoCategoryRef,
  BiznesinfoCompany,
  BiznesinfoCompanyResponse,
  BiznesinfoCompanySummary,
  BiznesinfoRubricRef,
  BiznesinfoRubricResponse,
  BiznesinfoSearchResponse,
  BiznesinfoSuggestResponse,
} from "./types";

import { BIZNESINFO_CATEGORY_ICONS } from "./icons";

const REGION_ALIAS: Record<string, string[]> = {
  minsk: ["minsk"],
  "minsk-region": ["minsk-region"],
  brest: ["brest"],
  vitebsk: ["vitebsk"],
  gomel: ["gomel"],
  grodno: ["grodno"],
  mogilev: ["mogilev"],
};

const POSTAL_PREFIX_TO_REGION_SLUG: Record<string, string> = {
  // Canonical Belarus postal prefixes
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

  // Rare “corrupted” prefixes observed in current dataset exports
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

const DASH_VARIANTS_RE = /[-‐‑‒–—―]/gu;

function regionSlugFromPostalCode(address: string): string | null {
  const matches = (address || "").match(/\b2\d{5}\b/g);
  if (!matches) return null;
  for (const code of matches) {
    const prefix = code.slice(0, 3);
    const regionSlug = POSTAL_PREFIX_TO_REGION_SLUG[prefix];
    if (regionSlug) return regionSlug;
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

  const fromPostal = regionSlugFromPostalCode(address || "");
  if (fromPostal) return fromPostal;

  if (cityLow.includes("минск")) return "minsk";

  if (regionLow.includes("минск")) return "minsk";

  return null;
}

function biznesinfoDataPathCandidates(): string[] {
  const env = process.env.BIZNESINFO_COMPANIES_JSONL_PATH?.trim();
  const candidates: string[] = [];
  if (env) candidates.push(env);

  candidates.push(path.join(process.cwd(), "public", "data", "biznesinfo", "companies.jsonl"));
  return candidates;
}

function resolveCompaniesJsonlPath(): string {
  for (const p of biznesinfoDataPathCandidates()) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  throw new Error(
    `companies.jsonl not found. Set BIZNESINFO_COMPANIES_JSONL_PATH or place it at public/data/biznesinfo/companies.jsonl. Tried: ${biznesinfoDataPathCandidates().join(
      ", ",
    )}`,
  );
}

function safeLower(s: string): string {
  return (s || "").toLowerCase();
}

function normalizeCompanyIdForMatch(id: string): string {
  return safeLower(id).replace(DASH_VARIANTS_RE, "");
}

function compactAlnum(s: string): string {
  return safeLower(s)
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const LEGAL_FORM_WORDS = new Set([
  "ооо",
  "оао",
  "зао",
  "ао",
  "одо",
  "сооо",
  "сп",
  "ип",
  "чуп",
  "уп",
  "куп",
  "руп",
  "птуп",
  "пуп",
]);

function buildCompanyNameInitialism(name: string): string {
  const tokens = safeLower(name)
    .replace(/ё/gu, "е")
    .replace(/№/gu, " ")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const token of tokens) {
    if (LEGAL_FORM_WORDS.has(token)) continue;
    if (/^\d+$/u.test(token)) {
      parts.push(token);
      continue;
    }
    parts.push(token[0] || "");
  }
  return compactAlnum(parts.join(""));
}

const LOCATION_STOP_WORDS = new Set([
  "г",
  "город",
  "ул",
  "улица",
  "пр",
  "пр-т",
  "проспект",
  "пер",
  "переулок",
  "бул",
  "бульвар",
  "наб",
  "набережная",
  "пл",
  "площадь",
  "д",
  "дом",
  "к",
  "корп",
  "корпус",
  "оф",
  "офис",
  "кв",
  "квартира",
  "р-н",
  "район",
  "обл",
  "область",
]);

function tokenizeLocation(raw: string): string[] {
  const cleaned = safeLower(raw)
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return tokens.filter((t) => {
    if (LOCATION_STOP_WORDS.has(t)) return false;
    if (/^\d+$/.test(t)) return true;
    return t.length >= 2;
  });
}

function isCheeseIntentToken(rawToken: string): boolean {
  const t = (rawToken || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return false;
  if (!t.startsWith("сыр")) return false;
  if (t.startsWith("сырь")) return false; // сырьё / сырьевой
  if (/^сыр(о|ой|ая|ое|ые|ого|ому|ым|ых|ую)$/u.test(t)) return false; // сырой / сырые / сырых ...
  if (t.startsWith("сырост")) return false; // сырость
  if (t.startsWith("сырокопч")) return false; // сырокопчёный
  if (t.startsWith("сыровялен") || t.startsWith("сыровял")) return false; // сыровяленый
  return true;
}

function shouldApplyDairyRubricFilter(serviceTokens: string[]): boolean {
  const tokens = (serviceTokens || []).map((t) => (t || "").trim().toLowerCase().replace(/ё/gu, "е"));
  if (tokens.some((t) => t.startsWith("молок"))) return true;
  if (tokens.some((t) => isCheeseIntentToken(t))) return true;
  return tokens.length === 1 && tokens[0] === "молочная";
}

function isDairyPrimaryRubric(summary: BiznesinfoCompanySummary | undefined): boolean {
  const slug = safeLower(summary?.primary_rubric_slug || "");
  if (slug.includes("molochnaya-promyshlennost")) return true;
  const rubricName = safeLower(summary?.primary_rubric_name || "").replace(/ё/gu, "е");
  return rubricName.includes("молочная промышленность");
}

function tokenizeServiceText(raw: string): string[] {
  // Transactional words should not block matching (e.g., "купить тетради", "заказать сантехнику").
  const QUERY_STOP_WORDS = new Set([
    "купить",
    "куплю",
    "заказать",
    "закажу",
    "продажа",
    "покупка",
    "оптом",
    "розница",
    "услуга",
    "услуги",
    "работа",
    "работы",
    "компания",
    "компании",
    "организация",
    "организации",
  ]);

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
    "продукция",
    "продукции",
    "промышленность",
    "промышленности",
    "отрасль",
    "отрасли",
    "направление",
    "направления",
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

  const cleaned = safeLower(raw)
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ");

  const normalizeQueryToken = (token: string): string => {
    const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!t) return "";

    // Keep core demand terms stable across Russian inflections:
    // "молоко", "молока", "молоком", "молоку" => "молочная".
    // Product intent should still discover dairy-domain companies.
    if (t.startsWith("молок")) return "молочная";
    // "молочная", "молочной", "молочную" => "молочная".
    if (t.startsWith("молочн")) return "молочная";

    return t;
  };

  const isDescriptorToken = (token: string): boolean => {
    const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!t) return false;
    if (DESCRIPTOR_STOP_WORDS.has(t)) return true;
    return DESCRIPTOR_PREFIXES.some((prefix) => t.startsWith(prefix));
  };

  const picked = cleaned
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !QUERY_STOP_WORDS.has(t))
    .filter((t) => !isDescriptorToken(t))
    .map((t) => normalizeQueryToken(t))
    .filter(Boolean);

  // Keep fallback behavior aligned with Meili search:
  // plain "сыр*" query should discover dairy companies, not only literal "сыр" tokens.
  if (picked.length > 0 && picked.every((token) => isCheeseIntentToken(token))) {
    return ["молочная"];
  }

  return picked;
}

function matchesServiceToken(companyTokens: string[], token: string): boolean {
  if (!token) return true;

  if (token === "сыр" || token === "сыры" || token === "сыра") {
    return companyTokens.some((raw) => {
      const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
      if (!t.startsWith("сыр")) return false;
      if (t.startsWith("сырь")) return false; // сырьё / сырьевой
      if (/^сыр(о|ой|ая|ое|ые|ого|ому|ым|ых|ую)$/u.test(t)) return false; // сырой / сырые / сырых ...
      if (t.startsWith("сырост")) return false; // сырость
      if (t.startsWith("сырокопч")) return false; // сырокопчёный
      if (t.startsWith("сыровялен") || t.startsWith("сыровял")) return false; // сыровяленый
      return true;
    });
  }

  if (token === "газ") {
    return companyTokens.some((raw) => {
      const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
      if (!t.startsWith("газ")) return false;
      if (t.startsWith("газет")) return false;
      if (t.startsWith("газон")) return false;
      if (t.startsWith("газел")) return false;
      if (t.startsWith("газир")) return false;
      return true;
    });
  }

  if (token === "лес") {
    return companyTokens.some((raw) => {
      const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
      if (!t.startsWith("лес")) return false;
      if (t.startsWith("лест")) return false;
      return true;
    });
  }

  if (token.length <= 2) return companyTokens.includes(token);
  return companyTokens.some((t) => {
    if (t === token) return true;
    if (t.startsWith(token)) return true;
    // Allow "кефира" -> "кефир", "ремонта" -> "ремонт" in fallback mode.
    if (t.length >= 4 && token.startsWith(t)) return true;
    return false;
  });
}

function matchesServiceTokens(companyTokens: string[], queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false;
  return queryTokens.every((t) => matchesServiceToken(companyTokens, t));
}

function scoreServiceTokens(companyTokens: string[], queryTokens: string[]): number {
  let score = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    if (companyTokens.includes(token)) {
      score += 2;
      continue;
    }
    if (companyTokens.some((t) => (t || "").startsWith(token))) score += 1;
  }
  return score;
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

function computeLogoRank(summary: BiznesinfoCompanySummary | undefined): number {
  if (!summary) return 0;
  if (normalizeLogoUrl(summary.logo_url || "")) return 2;
  if ((summary.name || "").trim()) return 1;
  return 0;
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
        // Keep as-is if already absolute.
        new URL(trimmed);
        return trimmed;
      } catch {
        // Best-effort: treat as host/path and add https://
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

function applyWebsiteOverride(companyId: string, websites: string[]): string[] {
  const raw = (companyId || "").trim();
  if (!raw) return websites;
  const key = raw.toLowerCase();

  const hasOverride =
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, raw) ||
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, key);
  if (!hasOverride) return websites;

  const override = (BIZNESINFO_WEBSITE_OVERRIDES as Record<string, string[]>)[raw]
    ?? (BIZNESINFO_WEBSITE_OVERRIDES as Record<string, string[]>)[key];
  return normalizeWebsites(override);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function applyMapOverride(company: BiznesinfoCompany): void {
  const raw = (company.source_id || "").trim();
  if (!raw) return;
  const key = raw.toLowerCase();

  const hasOverride =
    Object.prototype.hasOwnProperty.call(BIZNESINFO_MAP_OVERRIDES, raw) ||
    Object.prototype.hasOwnProperty.call(BIZNESINFO_MAP_OVERRIDES, key);
  if (!hasOverride) return;

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
  return company;
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
  return generateCompanyKeywordPhrases(
    company,
    getServerKeywordGenerationOptions(),
  );
}

async function findCompanyByIdFast(rawId: string): Promise<{ id: string; company: BiznesinfoCompany } | null> {
  const target = (rawId || "").trim();
  if (!target) return null;

  const targetLower = safeLower(target);
  const targetNormalized = normalizeCompanyIdForMatch(target);
  let normalizedFallback: { id: string; company: BiznesinfoCompany } | null = null;
  const sourcePath = resolveCompaniesJsonlPath();
  const input = fs.createReadStream(sourcePath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const raw = line.trim();
      if (!raw) continue;

      let company: BiznesinfoCompany;
      try {
        company = JSON.parse(raw) as BiznesinfoCompany;
      } catch {
        continue;
      }

      const sourceId = (company.source_id || "").trim();
      if (!sourceId) continue;
      if (isExcludedBiznesinfoCompany(company)) continue;

      const sourceLower = safeLower(sourceId);
      const sourceNormalized = normalizeCompanyIdForMatch(sourceId);
      const exactMatch = sourceId === target || sourceLower === targetLower;
      if (exactMatch) {
        return {
          id: sourceId,
          company: sanitizeCompanyRecord(company),
        };
      }

      if (!normalizedFallback && targetNormalized.length > 0 && sourceNormalized === targetNormalized) {
        normalizedFallback = {
          id: sourceId,
          company: sanitizeCompanyRecord(company),
        };
      }
    }
  } finally {
    rl.close();
    input.close();
  }

  return normalizedFallback;
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

type Store = {
  sourcePath: string;
  updatedAt: string | null;
  companiesById: Map<string, BiznesinfoCompany>;
  companySummaryById: Map<string, BiznesinfoCompanySummary>;
  companyRegionById: Map<string, string | null>;
  companySearchById: Map<string, string>;
  companyKeywordsById: Map<string, string[]>; // Search tokens for service query matching
  companyKeywordPhrasesById: Map<string, string[]>; // Keyword phrases for company page and exports

  categoriesBySlug: Map<string, BiznesinfoCategoryRef>;
  rubricsBySlug: Map<string, BiznesinfoRubricRef>;
  rubricsByCategorySlug: Map<string, string[]>;

  companyIdsByRubricSlug: Map<string, string[]>;

  companyCountAll: number;
  companyCountByRegion: Map<string, number>;
  categoryCountAll: Map<string, number>;
  categoryCountByRegion: Map<string, Map<string, number>>;
  rubricCountAll: Map<string, number>;
  rubricCountByRegion: Map<string, Map<string, number>>;
};

let storeCache: { sourcePath: string; mtimeMs: number; store: Store } | null = null;
let storeLoadPromise: Promise<Store> | null = null;
let storeLoadKey: string | null = null;
let storeWarmupPromise: Promise<void> | null = null;

function regionAliasKeys(region: string): string[] {
  return Array.from(new Set(REGION_ALIAS[region] || [region]));
}

function sumRegionCount(map: Map<string, number>, region: string): number {
  let total = 0;
  for (const regionKey of regionAliasKeys(region)) {
    total += map.get(regionKey) || 0;
  }
  return total;
}

function sumRegionNestedCount(
  map: Map<string, Map<string, number>>,
  region: string,
  key: string,
): number {
  let total = 0;
  for (const regionKey of regionAliasKeys(region)) {
    total += map.get(regionKey)?.get(key) || 0;
  }
  return total;
}

async function loadStoreFrom(sourcePath: string, stat: fs.Stats): Promise<Store> {
  const updatedAt = stat?.mtime ? new Date(stat.mtime).toISOString() : null;

  const companiesById = new Map<string, BiznesinfoCompany>();
  const companySummaryById = new Map<string, BiznesinfoCompanySummary>();
  const companyRegionById = new Map<string, string | null>();
  const companySearchById = new Map<string, string>();
  const companyKeywordsById = new Map<string, string[]>(); // Search tokens for service query matching
  const companyKeywordPhrasesById = new Map<string, string[]>();

  const categoriesBySlug = new Map<string, BiznesinfoCategoryRef>();
  const rubricsBySlug = new Map<string, BiznesinfoRubricRef>();
  const rubricsByCategorySlug = new Map<string, string[]>();

  const companyIdsByRubricSlug = new Map<string, string[]>();

  const companyCountByRegion = new Map<string, number>();
  const categoryCountAll = new Map<string, number>();
  const categoryCountByRegion = new Map<string, Map<string, number>>();
  const rubricCountAll = new Map<string, number>();
  const rubricCountByRegion = new Map<string, Map<string, number>>();

  const input = fs.createReadStream(sourcePath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    let company: BiznesinfoCompany;
    try {
      company = JSON.parse(raw) as BiznesinfoCompany;
    } catch {
      continue;
    }

    const id = (company.source_id || "").trim();
    if (!id) continue;
    if (isExcludedBiznesinfoCompany(company)) continue;

    company = sanitizeCompanyRecord(company);

    const regionSlug = normalizeRegionSlug(company.city || "", company.region || "", company.address || "");
    companiesById.set(id, company);
    companyRegionById.set(id, regionSlug);

    const summary = buildCompanySummary(company, regionSlug);
    companySummaryById.set(id, summary);

    const searchText = [
      company.name,
      company.description,
      company.about,
      company.address,
      (company.phones || []).join(" "),
      (company.emails || []).join(" "),
      (company.websites || []).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    companySearchById.set(id, safeLower(searchText));

    if (regionSlug) {
      companyCountByRegion.set(regionSlug, (companyCountByRegion.get(regionSlug) || 0) + 1);
    }

    for (const cat of company.categories || []) {
      if (!cat?.slug) continue;
      if (!categoriesBySlug.has(cat.slug)) categoriesBySlug.set(cat.slug, cat);
      categoryCountAll.set(cat.slug, (categoryCountAll.get(cat.slug) || 0) + 1);
      if (regionSlug) {
        let m = categoryCountByRegion.get(regionSlug);
        if (!m) {
          m = new Map<string, number>();
          categoryCountByRegion.set(regionSlug, m);
        }
        m.set(cat.slug, (m.get(cat.slug) || 0) + 1);
      }
    }

    const rubricSlugsForCompany = new Set<string>();
    for (const r of company.rubrics || []) {
      if (!r?.slug || !r.category_slug) continue;
      if (!rubricsBySlug.has(r.slug)) rubricsBySlug.set(r.slug, r);
      rubricCountAll.set(r.slug, (rubricCountAll.get(r.slug) || 0) + 1);
      if (regionSlug) {
        let m = rubricCountByRegion.get(regionSlug);
        if (!m) {
          m = new Map<string, number>();
          rubricCountByRegion.set(regionSlug, m);
        }
        m.set(r.slug, (m.get(r.slug) || 0) + 1);
      }

      if (!rubricsByCategorySlug.has(r.category_slug)) rubricsByCategorySlug.set(r.category_slug, []);
      if (!rubricsByCategorySlug.get(r.category_slug)!.includes(r.slug)) {
        rubricsByCategorySlug.get(r.category_slug)!.push(r.slug);
      }

      rubricSlugsForCompany.add(r.slug);
    }

    for (const rubricSlug of rubricSlugsForCompany) {
      if (!companyIdsByRubricSlug.has(rubricSlug)) companyIdsByRubricSlug.set(rubricSlug, []);
      companyIdsByRubricSlug.get(rubricSlug)!.push(id);
    }

  }

  for (const [catSlug, rubricSlugs] of rubricsByCategorySlug.entries()) {
    rubricSlugs.sort((a, b) => {
      const ra = rubricsBySlug.get(a);
      const rb = rubricsBySlug.get(b);
      return (ra?.name || a).localeCompare(rb?.name || b, "ru", { sensitivity: "base" });
    });
    rubricsByCategorySlug.set(catSlug, rubricSlugs);
  }

  const companyCountAll = companiesById.size;

  return {
    sourcePath,
    updatedAt,
    companiesById,
    companySummaryById,
    companyRegionById,
    companySearchById,
    companyKeywordsById,
    companyKeywordPhrasesById,
    categoriesBySlug,
    rubricsBySlug,
    rubricsByCategorySlug,
    companyIdsByRubricSlug,
    companyCountAll,
    companyCountByRegion,
    categoryCountAll,
    categoryCountByRegion,
    rubricCountAll,
    rubricCountByRegion,
  };
}

async function getStore(): Promise<Store> {
  const sourcePath = resolveCompaniesJsonlPath();
  const stat = fs.statSync(sourcePath);
  const mtimeMs = stat.mtimeMs || 0;

  if (storeCache && storeCache.sourcePath === sourcePath && storeCache.mtimeMs === mtimeMs) {
    return storeCache.store;
  }

  const key = `${sourcePath}:${mtimeMs}`;
  if (storeLoadPromise && storeLoadKey === key) {
    return storeLoadPromise;
  }

  storeLoadKey = key;
  storeLoadPromise = loadStoreFrom(sourcePath, stat);

  try {
    const store = await storeLoadPromise;
    storeCache = { sourcePath, mtimeMs, store };
    return store;
  } catch (e) {
    if (storeCache) {
      return storeCache.store;
    }
    throw e;
  } finally {
    if (storeLoadKey === key) {
      storeLoadPromise = null;
      storeLoadKey = null;
    }
  }
}

export function biznesinfoWarmStore(): Promise<void> {
  if (storeWarmupPromise) return storeWarmupPromise;

  storeWarmupPromise = getStore()
    .then(() => undefined)
    .catch((error) => {
      // allow retry on next request if warmup failed
      storeWarmupPromise = null;
      throw error;
    });

  return storeWarmupPromise;
}

function getOrBuildCompanyKeywordPhrases(store: Store, id: string): string[] {
  const companyId = (id || "").trim();
  if (!companyId) return [];

  const cached = store.companyKeywordPhrasesById.get(companyId);
  if (cached) return cached;

  const company = store.companiesById.get(companyId);
  if (!company) return [];

  const keywordPhrases = buildCompanyKeywordPhrases(company);
  store.companyKeywordPhrasesById.set(companyId, keywordPhrases);
  return keywordPhrases;
}

function getOrBuildCompanyKeywordTokens(store: Store, id: string): string[] {
  const companyId = (id || "").trim();
  if (!companyId) return [];

  const cached = store.companyKeywordsById.get(companyId);
  if (cached) return cached;

  const keywordPhrases = getOrBuildCompanyKeywordPhrases(store, companyId);
  const tokens = keywordPhrasesToSearchTokens(keywordPhrases);
  store.companyKeywordsById.set(companyId, tokens);
  return tokens;
}

function applyRegionAlias(region: string | null, companyRegionSlug: string | null): boolean {
  if (!region) return true;
  const want = REGION_ALIAS[region] || [region];
  if (!companyRegionSlug) return false;
  return want.includes(companyRegionSlug);
}

export async function biznesinfoGetCatalog(region: string | null): Promise<BiznesinfoCatalogResponse> {
  const store = await getStore();
  const categories: BiznesinfoCatalogResponse["categories"] = [];

  const cats = Array.from(store.categoriesBySlug.values()).sort((a, b) =>
    (a.name || a.slug).localeCompare(b.name || b.slug, "ru", { sensitivity: "base" }),
  );

  for (const cat of cats) {
    const rubrics: BiznesinfoCatalogResponse["categories"][number]["rubrics"] = [];
    const rubricSlugs = store.rubricsByCategorySlug.get(cat.slug) || [];
    for (const rubricSlug of rubricSlugs) {
      const r = store.rubricsBySlug.get(rubricSlug);
      if (!r) continue;
      const count = region ? sumRegionNestedCount(store.rubricCountByRegion, region, r.slug) : store.rubricCountAll.get(r.slug) || 0;
      rubrics.push({ slug: r.slug, name: r.name || r.slug, url: r.url || "", count });
    }

    const company_count = region ? sumRegionNestedCount(store.categoryCountByRegion, region, cat.slug) : store.categoryCountAll.get(cat.slug) || 0;

    categories.push({
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: cat.url || "",
      icon: BIZNESINFO_CATEGORY_ICONS[cat.slug] || null,
      company_count,
      rubrics,
    });
  }

  const companies_total = region ? sumRegionCount(store.companyCountByRegion, region) : store.companyCountAll;
  const rubrics_total = store.rubricsBySlug.size;
  const categories_total = store.categoriesBySlug.size;

  return {
    stats: {
      companies_total,
      categories_total,
      rubrics_total,
      updated_at: store.updatedAt,
      source_path: store.sourcePath,
    },
    categories,
  };
}

export async function biznesinfoGetRubricCompanies(params: {
  slug: string;
  region: string | null;
  query: string | null;
  offset: number;
  limit: number;
}): Promise<BiznesinfoRubricResponse> {
  const store = await getStore();
  const r = store.rubricsBySlug.get(params.slug);
  if (!r) {
    throw new Error(`rubric_not_found:${params.slug}`);
  }

  const ids = store.companyIdsByRubricSlug.get(params.slug) || [];
  const q = (params.query || "").trim().toLowerCase();

  const filtered: string[] = [];
  for (const id of ids) {
    const companyRegionSlug = store.companyRegionById.get(id) || null;
    if (!applyRegionAlias(params.region, companyRegionSlug)) continue;

    if (q) {
      const search = store.companySearchById.get(id) || "";
      if (!search.includes(q)) continue;
    }
    filtered.push(id);
  }

  const total = filtered.length;
  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));
  const pageIds = filtered.slice(offset, offset + limit);

  const companies: BiznesinfoCompanySummary[] = [];
  for (const id of pageIds) {
    const summary = store.companySummaryById.get(id);
    if (summary) companies.push(summary);
  }

  const count = params.region ? sumRegionNestedCount(store.rubricCountByRegion, params.region, r.slug) : store.rubricCountAll.get(r.slug) || 0;

  return {
    rubric: {
      slug: r.slug,
      name: r.name || r.slug,
      url: r.url || "",
      category_slug: r.category_slug,
      category_name: r.category_name || r.category_slug,
      count,
    },
    companies,
    page: { offset, limit, total },
  };
}

export async function biznesinfoGetCompany(id: string): Promise<BiznesinfoCompanyResponse> {
  const rawId = (id || "").trim();
  if (!rawId) throw new Error("company_not_found:");

  // Fast cold-path: avoid waiting for full in-memory store load on first company request.
  if (!storeCache) {
    const fast = await findCompanyByIdFast(rawId);
    if (fast) {
      const company = fast.company;
      const generatedKeywords = buildCompanyKeywordPhrases(company);
      return {
        id: fast.id,
        company,
        generated_keywords: generatedKeywords,
        primary: {
          category_slug: company.categories?.[0]?.slug ?? null,
          rubric_slug: company.rubrics?.[0]?.slug ?? null,
        },
      };
    }
  }

  const store = await getStore();

  const direct = store.companiesById.get(rawId);
  if (direct) {
    return {
      id: rawId,
      company: direct,
      generated_keywords: getOrBuildCompanyKeywordPhrases(store, rawId),
      primary: {
        category_slug: direct.categories?.[0]?.slug ?? null,
        rubric_slug: direct.rubrics?.[0]?.slug ?? null,
      },
    };
  }

  const normalized = rawId.replace(DASH_VARIANTS_RE, "");
  const normalizedCompany =
    normalized && normalized !== rawId ? store.companiesById.get(normalized) : undefined;
  if (!normalizedCompany) {
    throw new Error(`company_not_found:${rawId}`);
  }
  return {
    id: normalized,
    company: normalizedCompany,
    generated_keywords: getOrBuildCompanyKeywordPhrases(store, normalized),
    primary: {
      category_slug: normalizedCompany.categories?.[0]?.slug ?? null,
      rubric_slug: normalizedCompany.rubrics?.[0]?.slug ?? null,
    },
  };
}

export async function biznesinfoSuggest(params: {
  query: string;
  region: string | null;
  limit: number;
}): Promise<BiznesinfoSuggestResponse> {
  const store = await getStore();
  const q = (params.query || "").trim().toLowerCase();
  const qCompact = compactAlnum(q);
  const tryInitialism = qCompact.length >= 2 && qCompact.length <= 6;
  const limit = Math.max(1, Math.min(20, params.limit || 8));
  if (q.length < 2) return { query: params.query, suggestions: [] };

  const suggestions: BiznesinfoSuggestResponse["suggestions"] = [];

  for (const cat of store.categoriesBySlug.values()) {
    if (suggestions.length >= limit) break;
    if (!safeLower(cat.name || "").includes(q)) continue;
    const count = params.region ? sumRegionNestedCount(store.categoryCountByRegion, params.region, cat.slug) : store.categoryCountAll.get(cat.slug) || 0;
    suggestions.push({
      type: "category",
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: `/catalog/${cat.slug}`,
      icon: BIZNESINFO_CATEGORY_ICONS[cat.slug] || null,
      count,
    });
  }

  for (const r of store.rubricsBySlug.values()) {
    if (suggestions.length >= limit) break;
    if (!safeLower(r.name || "").includes(q)) continue;
    const count = params.region ? sumRegionNestedCount(store.rubricCountByRegion, params.region, r.slug) : store.rubricCountAll.get(r.slug) || 0;
    suggestions.push({
      type: "rubric",
      slug: r.slug,
      name: r.name || r.slug,
      url: `/catalog/${r.category_slug}/${r.slug.split("/").slice(1).join("/")}`,
      icon: BIZNESINFO_CATEGORY_ICONS[r.category_slug] || null,
      category_name: r.category_name || r.category_slug,
      count,
    });
  }

  if (suggestions.length < limit) {
    for (const [id, summary] of store.companySummaryById.entries()) {
      if (suggestions.length >= limit) break;
      const companyRegionSlug = store.companyRegionById.get(id) || null;
      if (!applyRegionAlias(params.region, companyRegionSlug)) continue;
      // Search ONLY by company name, not by description/keywords
      const name = summary.name || "";
      const nameLower = safeLower(name);
      if (!nameLower.includes(q)) {
        if (!qCompact) continue;
        const nameCompact = compactAlnum(name);
        const idCompact = compactAlnum(id);
        if (nameCompact.includes(qCompact)) {
          // ok
        } else if (idCompact.includes(qCompact)) {
          // ok (match by company id / slug without separators)
        } else if (tryInitialism && buildCompanyNameInitialism(name).includes(qCompact)) {
          // ok
        } else {
          continue;
        }
      }
      suggestions.push({
        type: "company",
        id,
        name: summary.name,
        url: `/company/${companySlugForUrl(id)}`,
        icon: summary.primary_category_slug ? BIZNESINFO_CATEGORY_ICONS[summary.primary_category_slug] || null : null,
        subtitle: summary.address || summary.city || "",
      });
    }
  }

  return { query: params.query, suggestions };
}

export type BiznesinfoRubricHint =
  | { type: "category"; slug: string; name: string; url: string }
  | { type: "rubric"; slug: string; name: string; url: string; category_slug: string; category_name: string };

export async function biznesinfoDetectRubricHints(params: {
  text: string;
  limit: number;
}): Promise<BiznesinfoRubricHint[]> {
  const store = await getStore();
  const limit = Math.max(1, Math.min(12, params.limit || 8));
  const tokens = tokenizeServiceText((params.text || "").slice(0, 600)).slice(0, 8);
  if (tokens.length === 0) return [];

  type ScoredRubric = {
    slug: string;
    name: string;
    categorySlug: string;
    categoryName: string;
    url: string;
    score: number;
    count: number;
  };

  const rubricMatches: ScoredRubric[] = [];
  for (const r of store.rubricsBySlug.values()) {
    const nameTokens = tokenizeServiceText(r.name || "");
    const categoryTokens = tokenizeServiceText(r.category_name || r.category_slug || "");
    const nameScore = scoreServiceTokens(nameTokens, tokens);
    const categoryScore = scoreServiceTokens(categoryTokens, tokens);
    const score = nameScore * 3 + categoryScore;
    if (score <= 0) continue;

    rubricMatches.push({
      slug: r.slug,
      name: r.name || r.slug,
      categorySlug: r.category_slug || r.slug.split("/")[0] || "",
      categoryName: r.category_name || r.category_slug || "",
      url: `/catalog/${r.category_slug}/${r.slug.split("/").slice(1).join("/")}`,
      score,
      count: store.rubricCountAll.get(r.slug) || 0,
    });
  }

  rubricMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return a.slug.localeCompare(b.slug, "ru", { sensitivity: "base" });
  });

  const categoryHints: BiznesinfoRubricHint[] = [];
  const categorySeen = new Set<string>();
  for (const match of rubricMatches) {
    if (categoryHints.length >= Math.min(2, limit)) break;
    const slug = (match.categorySlug || "").trim();
    if (!slug) continue;
    if (categorySeen.has(slug.toLowerCase())) continue;
    const cat = store.categoriesBySlug.get(slug);
    if (!cat) continue;
    categorySeen.add(slug.toLowerCase());
    categoryHints.push({
      type: "category",
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: `/catalog/${cat.slug}`,
    });
  }

  const rubricHints: BiznesinfoRubricHint[] = rubricMatches
    .slice(0, Math.max(0, limit - categoryHints.length))
    .map((match) => ({
      type: "rubric",
      slug: match.slug,
      name: match.name,
      url: match.url,
      category_slug: match.categorySlug,
      category_name: match.categoryName,
    }));

  if (categoryHints.length > 0) return [...categoryHints, ...rubricHints].slice(0, limit);

  const categoryMatches: Array<{ slug: string; name: string; url: string; score: number; count: number }> = [];
  for (const cat of store.categoriesBySlug.values()) {
    const score = scoreServiceTokens(tokenizeServiceText(cat.name || cat.slug), tokens);
    if (score <= 0) continue;
    categoryMatches.push({
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: `/catalog/${cat.slug}`,
      score,
      count: store.categoryCountAll.get(cat.slug) || 0,
    });
  }
  categoryMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return a.slug.localeCompare(b.slug, "ru", { sensitivity: "base" });
  });

  const fallbackCategories: BiznesinfoRubricHint[] = categoryMatches.slice(0, limit).map((match) => ({
    type: "category",
    slug: match.slug,
    name: match.name,
    url: match.url,
  }));
  if (fallbackCategories.length > 0) return fallbackCategories;

  return rubricHints.slice(0, limit);
}

export async function biznesinfoSearch(params: {
  query: string;
  service?: string;
  city?: string | null;
  region: string | null;
  offset: number;
  limit: number;
}): Promise<BiznesinfoSearchResponse> {
  const store = await getStore();
  const q = (params.query || "").trim().toLowerCase();
  const qCompact = q ? compactAlnum(q) : "";
  const tryInitialism = qCompact.length >= 2 && qCompact.length <= 6;
  const serviceTokens = tokenizeServiceText(params.service || "");
  const applyDairyFilter = shouldApplyDairyRubricFilter(serviceTokens);
  const rawCity = (params.city || "").trim();
  const cityLower = rawCity.toLowerCase();
  const cityTokens = tokenizeLocation(cityLower);
  const cityNorm = normalizeCityForFilter(rawCity);
  const useCityExactFilter = Boolean(cityNorm) && !isAddressLikeLocationQuery(rawCity);
  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));
  
  // No filters = no results
  if (!q && serviceTokens.length === 0 && cityTokens.length === 0 && !cityNorm) {
    return { query: params.query, total: 0, companies: [] };
  }

  const qNorm = q.replace(/ё/gu, "е");
  const matches: Array<{ id: string; logoRank: number; score: number; name: string }> = [];
  for (const [id, search] of store.companySearchById.entries()) {
    const companyRegionSlug = store.companyRegionById.get(id) || null;
    if (!applyRegionAlias(params.region, companyRegionSlug)) continue;

    const summary = store.companySummaryById.get(id);
    if (serviceTokens.length > 0 && applyDairyFilter && !isDairyPrimaryRubric(summary)) {
      continue;
    }
    if (useCityExactFilter) {
      if (normalizeCityForFilter(summary?.city || "") !== cityNorm) continue;
    } else if (cityTokens.length > 0) {
      const cityHaystack = safeLower(`${summary?.city || ""} ${summary?.address || ""}`);
      let ok = true;
      for (const token of cityTokens) {
        if (!cityHaystack.includes(token)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    
    const companyTokens = serviceTokens.length > 0
      ? getOrBuildCompanyKeywordTokens(store, id)
      : [];

    const pushMatch = () => {
      const logoRank = computeLogoRank(summary);
      const name = summary?.name || id;
      const nameNorm = safeLower(name).replace(/ё/gu, "е");
      let score = 0;
      if (serviceTokens.length > 0) score += scoreServiceTokens(companyTokens, serviceTokens);
      if (qNorm) {
        if (nameNorm.startsWith(qNorm)) score += 20;
        else if (nameNorm.includes(qNorm)) score += 10;
        else score += 5;
      }
      matches.push({ id, logoRank, score, name });
    };

    // Combined search: company name (and/or other text) + product/service keywords.
    if (q && serviceTokens.length > 0) {
      if (search.includes(q) && matchesServiceTokens(companyTokens, serviceTokens)) pushMatch();
      continue;
    }

    // Service search: match generated keyword tokens (word/prefix match, not substring).
    if (serviceTokens.length > 0) {
      if (matchesServiceTokens(companyTokens, serviceTokens)) pushMatch();
      continue;
    }

    // Company name search (fallback uses combined text index)
    if (q) {
      if (search.includes(q)) {
        pushMatch();
      } else if (qCompact) {
        const name = summary?.name || "";
        const nameCompact = compactAlnum(name);
        if (nameCompact.includes(qCompact)) {
          pushMatch();
        } else if (compactAlnum(id).includes(qCompact)) {
          pushMatch();
        } else if (tryInitialism && buildCompanyNameInitialism(name).includes(qCompact)) {
          pushMatch();
        }
      }
      continue;
    }

    // City-only filter
    pushMatch();
  }

  const total = matches.length;
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.logoRank !== a.logoRank) return b.logoRank - a.logoRank;
    return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
  });

  const pageIds = matches.slice(offset, offset + limit).map((m) => m.id);
  const companies: BiznesinfoCompanySummary[] = [];
  for (const id of pageIds) {
    const summary = store.companySummaryById.get(id);
    if (summary) companies.push(summary);
  }

  return { query: params.query, total, companies };
}

export async function biznesinfoGetCompaniesSummary(ids: string[]): Promise<BiznesinfoCompanySummary[]> {
  const store = await getStore();
  const out: BiznesinfoCompanySummary[] = [];
  for (const raw of ids) {
    const id = (raw || "").trim();
    if (!id) continue;
    const summary = store.companySummaryById.get(id);
    if (summary) out.push(summary);
  }
  return out;
}
