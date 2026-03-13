import { NextResponse } from "next/server";
import { meiliSearch } from "@/lib/meilisearch";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import { filterOutLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";
import type { BiznesinfoCompanySummary, BiznesinfoSearchResponse } from "@/lib/biznesinfo/types";
import { biznesinfoSearchCompaniesByPhone } from "@/lib/biznesinfo/postgres";
import { localizeCompanySummaries, localizeTextByUiLanguage, normalizeUiLanguage } from "@/lib/biznesinfo/translation";
import { understandBiznesinfoSearchQuery } from "@/lib/search/queryUnderstanding";
import { regions } from "@/data/regions";
import { isAddressLikeLocationQuery, localizeBelarusGeoLabel, splitServiceAndCity } from "@/lib/utils/location";

export const runtime = "nodejs";

type SearchAbVariant = "control" | "treatment";
type ServiceSoftCorrection = {
  field: "service";
  mode: "soft";
  applied: boolean;
  original: string;
  corrected: string;
  strict: boolean;
};

const EXPLICIT_WHOLESALE_FORMAT_RE =
  /(^|[^\p{L}\p{N}])(опт\p{L}*|оптов\p{L}*|крупн\p{L}*\s+опт|паллет\p{L}*|контейнер\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const EXPLICIT_RETAIL_FORMAT_RE =
  /(^|[^\p{L}\p{N}])(розниц\p{L}*|в\s+розницу|поштуч\p{L}*|штучн\p{L}*|для\s+себя)(?=$|[^\p{L}\p{N}])/iu;
const NON_ADDRESS_SERVICE_TOKEN_RE =
  /^(кафе|бар|аптек|молок|сыр|авто|строй|ремонт|суши|пицц|ресторан|такси|банк|магаз|достав|ветерин|парикмах|гостиниц|хостел|аренд|постав|опт|розниц)/u;
const ADDRESS_MARKER_RE =
  /(^|[\s,.;:()\-])(ул\.?|улица|пр-?т\.?|просп\.?|проспект|пер\.?|переулок|пл\.?|площадь|наб\.?|набережная|бул\.?|бульвар|шоссе|тракт|дом|д\.|корп\.?|кв\.?)(?=$|[\s,.;:()\-])/iu;
const PHONE_ONLY_QUERY_RE = /^\+?[\d\s().-]{7,}$/u;
const REGION_LABEL_TO_SLUG = (() => {
  const map = new Map<string, string>();
  for (const region of regions) {
    const slug = String(region.slug || "").trim().toLowerCase();
    const name = String(region.name || "").trim();
    if (!slug || !name) continue;

    const normalized = normalizeRegionLabelForLookup(name);
    if (normalized) map.set(normalized, slug);

    const short = normalized.replace(/\s+обл(?:\.|асть)?$/u, "").trim();
    if (short) map.set(short, slug);

    map.set(slug, slug);
  }
  return map;
})();
const SERVICE_GLUE_SPLIT_RULES: Array<{
  label: string;
  replace: (_token: string) => string;
}> = [
  {
    label: "salon_beauty",
    replace: (token) => token.replace(/^(салоны?)(красот\p{L}*)$/iu, "$1 $2"),
  },
  {
    label: "products_food",
    replace: (token) => token.replace(/^(продукт\p{L}*)(питан\p{L}*)$/iu, "$1 $2"),
  },
  {
    label: "dairy_products",
    replace: (token) => token.replace(/^(молочн\p{L}*)(продукт\p{L}*)$/iu, "$1 $2"),
  },
  {
    label: "beauty_salon_rev",
    replace: (token) => token.replace(/^(красот\p{L}*)(салоны?)$/iu, "$1 $2"),
  },
];

function normalizeStrictServiceFlag(raw: string | null): boolean {
  const value = String(raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "y";
}

function collapseWhitespace(raw: string): string {
  return String(raw || "").replace(/\s+/gu, " ").trim();
}

function applySoftServiceCorrection(
  rawService: string,
  options: { strict: boolean },
): ServiceSoftCorrection | null {
  const original = collapseWhitespace(rawService);
  if (!original) return null;
  if (options.strict) {
    return {
      field: "service",
      mode: "soft",
      applied: false,
      original,
      corrected: original,
      strict: true,
    };
  }

  const tokens = original.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const correctedTokens = tokens.map((token) => {
    let out = token;
    for (const rule of SERVICE_GLUE_SPLIT_RULES) {
      const next = rule.replace(out);
      if (next !== out) {
        out = next;
      }
    }
    return out;
  });

  const corrected = collapseWhitespace(correctedTokens.join(" "));
  if (!corrected || corrected === original) return null;

  return {
    field: "service",
    mode: "soft",
    applied: true,
    original,
    corrected,
    strict: false,
  };
}

function normalizeRegionLabelForLookup(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„()]/gu, " ")
    .replace(/[.,;:!?/\\]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function resolveRegionSlugFromLocationInput(raw: string | null): string | null {
  const source = String(raw || "").trim();
  if (!source) return null;

  const localized = localizeBelarusGeoLabel(source);
  const variants = [
    normalizeRegionLabelForLookup(source),
    normalizeRegionLabelForLookup(localized),
  ].filter(Boolean);

  for (const variant of variants) {
    const slug = REGION_LABEL_TO_SLUG.get(variant);
    if (slug) return slug;

    const short = variant.replace(/\s+обл(?:\.|асть)?$/u, "").trim();
    if (!short) continue;
    const shortSlug = REGION_LABEL_TO_SLUG.get(short);
    if (shortSlug) return shortSlug;
  }

  return null;
}

function looksLikeAddressHouseService(raw: string): boolean {
  const source = String(raw || "").trim();
  if (!source) return false;
  if (!/\d/u.test(source)) return false;
  if (!isAddressLikeLocationQuery(source)) return false;

  const normalized = source
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return false;
  if (ADDRESS_MARKER_RE.test(source)) return true;

  const tokens = normalized.split(" ").filter(Boolean);
  const textTokens = tokens.filter((token) => !/\d/u.test(token));
  const hasHouseToken = tokens.some((token) => /\d/u.test(token));
  if (!hasHouseToken || textTokens.length === 0) return false;

  return textTokens.some((token) => token.length >= 5 && !NON_ADDRESS_SERVICE_TOKEN_RE.test(token));
}

function normalizePhoneDigits(raw: string): string {
  return String(raw || "").replace(/[^\d]+/gu, "");
}

function extractPhoneLikeQuery(query: string, service: string): string | null {
  const candidates = [String(service || "").trim(), String(query || "").trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!PHONE_ONLY_QUERY_RE.test(candidate)) continue;
    const digits = normalizePhoneDigits(candidate);
    if (digits.length < 7) continue;
    return candidate;
  }
  return null;
}

function normalizeSupplyType(raw: string | null): "any" | "delivery" | "pickup" {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "delivery") return "delivery";
  if (value === "pickup") return "pickup";
  return "any";
}

function normalizeBusinessFormat(raw: string | null): "any" | "b2b" | "b2c" {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "b2b") return "b2b";
  if (value === "b2c") return "b2c";
  return "any";
}

function inferBusinessFormatFromText(raw: string): "any" | "b2b" | "b2c" {
  const text = String(raw || "").trim();
  if (!text) return "any";
  const hasWholesale = EXPLICIT_WHOLESALE_FORMAT_RE.test(text);
  const hasRetail = EXPLICIT_RETAIL_FORMAT_RE.test(text);
  if (hasWholesale && !hasRetail) return "b2b";
  if (hasRetail && !hasWholesale) return "b2c";
  return "any";
}

function normalizeAbVariant(raw: string | null): SearchAbVariant | undefined {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "control") return "control";
  if (value === "treatment") return "treatment";
  return undefined;
}

function normalizeExplainFlag(raw: string | null): boolean {
  const value = String(raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "y";
}

function getClientIpHint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "";
}

function dedupeCompaniesByCanonicalSlug(companies: BiznesinfoCompanySummary[]): BiznesinfoCompanySummary[] {
  const out: BiznesinfoCompanySummary[] = [];
  const indexBySlug = new Map<string, number>();

  for (const company of companies || []) {
    const slug = companySlugForUrl(company.id);
    const key = slug.toLowerCase();
    const existingIndex = indexBySlug.get(key);
    if (existingIndex == null) {
      indexBySlug.set(key, out.length);
      out.push(company);
      continue;
    }

    const existing = out[existingIndex];
    const existingIsCanonical = existing.id === companySlugForUrl(existing.id);
    const currentIsCanonical = company.id === slug;
    if (!existingIsCanonical && currentIsCanonical) {
      out[existingIndex] = company;
    }
  }

  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = normalizeUiLanguage(searchParams.get("lang") || searchParams.get("language"));
  // Support both 'q' (company name) and 'service' (product/service keywords)
  const query = searchParams.get("q") || "";
  const rawService = searchParams.get("service") || "";
  const strictService = normalizeStrictServiceFlag(searchParams.get("strict_service"));
  const serviceCorrection = applySoftServiceCorrection(rawService, { strict: strictService });
  const correctedService = serviceCorrection?.corrected || rawService;
  const keywords = searchParams.get("keywords") || null;
  const rawCityInput = searchParams.get("city") || null;
  const inferredRegionFromCity = resolveRegionSlugFromLocationInput(rawCityInput);
  const region = searchParams.get("region") || inferredRegionFromCity || null;
  const rawCity = inferredRegionFromCity ? null : rawCityInput;
  const supplyType = normalizeSupplyType(searchParams.get("supply_type") || searchParams.get("supplyType"));
  const rawBusinessFormat = searchParams.get("business_format") || searchParams.get("businessFormat");
  const hasExplicitBusinessFormat = String(rawBusinessFormat || "").trim().length > 0;
  const explicitBusinessFormat = normalizeBusinessFormat(rawBusinessFormat);
  const abVariant = normalizeAbVariant(searchParams.get("ab_variant") || searchParams.get("abVariant"));
  const explain = normalizeExplainFlag(searchParams.get("explain"));
  const explicitAbSeed = String(searchParams.get("ab_seed") || searchParams.get("abSeed") || "").trim();
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  const page = parseInt(searchParams.get("page") || "", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "24", 10);
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 24;
  const safePage = Number.isFinite(page) && page > 0 ? page : undefined;
  const safeLat = Number.isFinite(lat) ? lat : undefined;
  const safeLng = Number.isFinite(lng) ? lng : undefined;

  const phoneLikeQuery = extractPhoneLikeQuery(query, rawService);
  if (phoneLikeQuery) {
    try {
      const phoneResult = await biznesinfoSearchCompaniesByPhone({
        phone: phoneLikeQuery,
        offset: safeOffset,
        limit: safeLimit,
      });
      const deduped = dedupeCompaniesByCanonicalSlug(phoneResult.items || []);
      const filtered = await filterOutLiquidatedByKartoteka(deduped);
      const localizedItems = await localizeCompanySummaries(filtered.items, language);
      const [queryDisplay, serviceDisplay] = await Promise.all([
        localizeTextByUiLanguage(phoneLikeQuery, language),
        localizeTextByUiLanguage(correctedService || "", language),
      ]);
      const responsePage = Math.floor(safeOffset / safeLimit) + 1;
      return NextResponse.json({
        items: localizedItems,
        total: Math.max(0, phoneResult.total - filtered.removed),
        page: responsePage,
        limit: safeLimit,
        companies: localizedItems,
        query: phoneLikeQuery,
        query_display: queryDisplay,
        service_display: serviceDisplay,
        ab_test: null,
        ranking_explain: null,
        facets: null,
        applied_filters: null,
        zero_results: null,
        spell_correction: serviceCorrection || null,
      });
    } catch (error) {
      console.error("Phone search request failed:", error);
      return NextResponse.json(
        { error: "search_unavailable", message: "Поиск временно недоступен" },
        { status: 503 },
      );
    }
  }

  const understanding = understandBiznesinfoSearchQuery({
    query,
    service: correctedService,
    keywords,
    region,
    city: rawCity,
  });
  const preserveAddressHouseService = looksLikeAddressHouseService(correctedService);
  const effective = understanding.searchParams;
  const splitAddressService = splitServiceAndCity(correctedService, effective.city || rawCity || null);
  // For address+house queries keep numeric part in service (house number),
  // but still allow city extraction from tail tokens.
  const effectiveService = preserveAddressHouseService
    ? (String(splitAddressService.service || "").trim() || correctedService)
    : effective.service;
  const inferredBusinessFormat = inferBusinessFormatFromText(
    [query, effectiveService, keywords || ""].filter(Boolean).join(" "),
  );
  const businessFormat = hasExplicitBusinessFormat
    ? explicitBusinessFormat
    : inferredBusinessFormat;
  const userAgentHint = String(request.headers.get("user-agent") || "").slice(0, 120);
  const clientIpHint = getClientIpHint(request);
  const derivedAbSeed = explicitAbSeed || [
    clientIpHint,
    userAgentHint,
    effective.query || "",
    effectiveService || "",
    effective.keywords || "",
    effective.city || "",
    effective.region || "",
  ].join("|");

  try {
    const data = await meiliSearch({
      query: effective.query,
      service: effectiveService,
      keywords: effective.keywords,
      region: effective.region,
      city: effective.city,
      supplyType,
      businessFormat,
      lat: safeLat,
      lng: safeLng,
      page: safePage,
      offset: safeOffset,
      limit: safeLimit,
      abVariant: abVariant || null,
      abSeed: derivedAbSeed,
      explain,
    });
    const normalized: BiznesinfoSearchResponse = {
      ...data,
      companies: dedupeCompaniesByCanonicalSlug(data.companies || []),
    };
    const filtered = await filterOutLiquidatedByKartoteka(normalized.companies || []);
    const zeroSampleCandidates = dedupeCompaniesByCanonicalSlug(normalized.zero_results?.sample_companies || []);
    const filteredZeroSamples = zeroSampleCandidates.length > 0
      ? await filterOutLiquidatedByKartoteka(zeroSampleCandidates)
      : { items: [] as BiznesinfoCompanySummary[] };
    const localizedCompanies = await localizeCompanySummaries(filtered.items, language);
    const localizedZeroSamples = await localizeCompanySummaries(filteredZeroSamples.items, language);
    const allowedCompanyIds = new Set(filtered.items.map((item) => item.id));
    const cleanedExplain = (normalized.ranking_explain || [])
      .filter((entry) => allowedCompanyIds.has(entry.id))
      .map((entry, idx) => ({
        ...entry,
        rank: idx + 1,
      }));
    const cleaned: BiznesinfoSearchResponse = {
      ...normalized,
      total: Math.max(0, normalized.total - filtered.removed),
      companies: localizedCompanies,
      spell_correction: serviceCorrection || undefined,
      ranking_explain: cleanedExplain.length > 0 ? cleanedExplain : undefined,
      zero_results: normalized.zero_results
        ? {
          ...normalized.zero_results,
          sample_companies: localizedZeroSamples,
        }
        : undefined,
    };
    const [queryDisplay, serviceDisplay] = await Promise.all([
      localizeTextByUiLanguage(cleaned.query || "", language),
      localizeTextByUiLanguage(effectiveService || "", language),
    ]);

    const responsePage =
      Number.isFinite((data as { page?: number }).page)
        ? Number((data as { page?: number }).page)
        : Math.floor(safeOffset / safeLimit) + 1;
    const responseLimit =
      Number.isFinite((data as { limit?: number }).limit)
        ? Number((data as { limit?: number }).limit)
        : safeLimit;

    return NextResponse.json({
      items: cleaned.companies,
      total: cleaned.total,
      page: responsePage,
      limit: responseLimit,
      // Backward-compatible fields for existing frontend flows.
      companies: cleaned.companies,
      query: cleaned.query,
      query_display: queryDisplay,
      service_display: serviceDisplay,
      ab_test: cleaned.ab_test || null,
      ranking_explain: cleaned.ranking_explain || null,
      facets: cleaned.facets || null,
      applied_filters: cleaned.applied_filters || null,
      zero_results: cleaned.zero_results || null,
      spell_correction: cleaned.spell_correction || null,
      ...(String(process.env.BIZNESINFO_SEARCH_DEBUG || "").trim() === "1"
        ? { understanding }
        : {}),
    });
  } catch (error) {
    console.error("Search index request failed:", error);
    return NextResponse.json(
      { error: "search_unavailable", message: "Поиск временно недоступен" },
      { status: 503 },
    );
  }
}
