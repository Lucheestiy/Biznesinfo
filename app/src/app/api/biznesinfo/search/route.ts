import { NextResponse } from "next/server";
import { meiliSearch } from "@/lib/meilisearch";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import { filterOutLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";
import type { BiznesinfoCompanySummary, BiznesinfoSearchResponse } from "@/lib/biznesinfo/types";
import { understandBiznesinfoSearchQuery } from "@/lib/search/queryUnderstanding";

export const runtime = "nodejs";

type SearchAbVariant = "control" | "treatment";

const EXPLICIT_WHOLESALE_FORMAT_RE =
  /(^|[^\p{L}\p{N}])(опт\p{L}*|оптов\p{L}*|крупн\p{L}*\s+опт|паллет\p{L}*|контейнер\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const EXPLICIT_RETAIL_FORMAT_RE =
  /(^|[^\p{L}\p{N}])(розниц\p{L}*|в\s+розницу|поштуч\p{L}*|штучн\p{L}*|для\s+себя)(?=$|[^\p{L}\p{N}])/iu;

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
  // Support both 'q' (company name) and 'service' (product/service keywords)
  const query = searchParams.get("q") || "";
  const rawService = searchParams.get("service") || "";
  const keywords = searchParams.get("keywords") || null;
  const region = searchParams.get("region") || null;
  const rawCity = searchParams.get("city") || null;
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
  const understanding = understandBiznesinfoSearchQuery({
    query,
    service: rawService,
    keywords,
    region,
    city: rawCity,
  });
  const inferredBusinessFormat = inferBusinessFormatFromText(
    [query, rawService, keywords || ""].filter(Boolean).join(" "),
  );
  const businessFormat = hasExplicitBusinessFormat
    ? explicitBusinessFormat
    : inferredBusinessFormat;
  const effective = understanding.searchParams;

  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 24;
  const safePage = Number.isFinite(page) && page > 0 ? page : undefined;
  const safeLat = Number.isFinite(lat) ? lat : undefined;
  const safeLng = Number.isFinite(lng) ? lng : undefined;
  const userAgentHint = String(request.headers.get("user-agent") || "").slice(0, 120);
  const clientIpHint = getClientIpHint(request);
  const derivedAbSeed = explicitAbSeed || [
    clientIpHint,
    userAgentHint,
    effective.query || "",
    effective.service || "",
    effective.keywords || "",
    effective.city || "",
    effective.region || "",
  ].join("|");

  try {
    const data = await meiliSearch({
      query: effective.query,
      service: effective.service,
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
      companies: filtered.items,
      ranking_explain: cleanedExplain.length > 0 ? cleanedExplain : undefined,
      zero_results: normalized.zero_results
        ? {
          ...normalized.zero_results,
          sample_companies: filteredZeroSamples.items,
        }
        : undefined,
    };

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
      ab_test: cleaned.ab_test || null,
      ranking_explain: cleaned.ranking_explain || null,
      facets: cleaned.facets || null,
      applied_filters: cleaned.applied_filters || null,
      zero_results: cleaned.zero_results || null,
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
