import { NextResponse } from "next/server";
import { meiliSearch, isMeiliHealthy } from "@/lib/meilisearch";
import { biznesinfoSearch } from "@/lib/biznesinfo/store";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import type { BiznesinfoCompanySummary, BiznesinfoSearchResponse } from "@/lib/biznesinfo/types";

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
  const service = searchParams.get("service") || "";
  const keywords = searchParams.get("keywords") || null;
  const region = searchParams.get("region") || null;
  const city = searchParams.get("city") || null;
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "24", 10);

  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 24;
  const hasAnyQuery = Boolean(query.trim() || service.trim() || (keywords || "").trim() || (city || "").trim());

  // Try Meilisearch first
  try {
    if (await isMeiliHealthy()) {
      const data = await meiliSearch({
        query,
        service,  // Pass service for keyword-based search
        keywords,
        region,
        city,
        offset: safeOffset,
        limit: safeLimit,
      });
      const normalized: BiznesinfoSearchResponse = {
        ...data,
        companies: dedupeCompaniesByCanonicalSlug(data.companies || []),
      };
      if (!hasAnyQuery) return NextResponse.json(normalized);
      if ((normalized?.companies || []).length > 0) return NextResponse.json(normalized);
    }
  } catch (error) {
    console.error("Meilisearch error, falling back to in-memory search:", error);
  }

  // Fallback to in-memory search
  const data = await biznesinfoSearch({
    query,
    service,
    region,
    city,
    offset: safeOffset,
    limit: safeLimit,
  });
  const normalized: BiznesinfoSearchResponse = {
    ...data,
    companies: dedupeCompaniesByCanonicalSlug(data.companies || []),
  };
  return NextResponse.json(normalized);
}
