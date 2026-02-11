import { NextResponse } from "next/server";
import { meiliSuggest, isMeiliHealthy } from "@/lib/meilisearch";
import { biznesinfoSuggest } from "@/lib/biznesinfo/store";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import type { BiznesinfoSuggestResponse } from "@/lib/biznesinfo/types";

function looksLikeCompanyAbbreviationQuery(query: string): boolean {
  const q = (query || "").trim();
  if (!q) return false;
  if (q.length > 12) return false;
  if (!/\p{L}/u.test(q)) return false;
  if (!/\d/u.test(q)) return false;
  // Avoid treating phone numbers as abbreviations.
  if (/^\+?\d[\d\s()-]{6,}$/u.test(q)) return false;
  return true;
}

function scoreCompanySuggestion(s: Extract<BiznesinfoSuggestResponse["suggestions"][number], { type: "company" }>): number {
  const canonicalId = companySlugForUrl(s.id);
  let score = 0;
  if (s.id === canonicalId) score += 10;
  if (s.icon) score += 1;
  if ((s.subtitle || "").trim()) score += 1;
  return score;
}

function dedupeCompanySuggestions(data: BiznesinfoSuggestResponse, limit: number): BiznesinfoSuggestResponse {
  const out: BiznesinfoSuggestResponse["suggestions"] = [];
  const companyIndexByUrl = new Map<string, number>();

  for (const suggestion of data.suggestions || []) {
    if (suggestion.type !== "company") {
      out.push(suggestion);
      continue;
    }

    const canonicalUrl = `/company/${encodeURIComponent(companySlugForUrl(suggestion.id))}`;
    const normalized: typeof suggestion = { ...suggestion, url: canonicalUrl };
    const key = canonicalUrl.toLowerCase();

    const existingIndex = companyIndexByUrl.get(key);
    if (existingIndex == null) {
      companyIndexByUrl.set(key, out.length);
      out.push(normalized);
      continue;
    }

    const existing = out[existingIndex];
    if (existing?.type !== "company") continue;
    if (scoreCompanySuggestion(normalized) > scoreCompanySuggestion(existing)) {
      out[existingIndex] = normalized;
    }
  }

  return {
    ...data,
    suggestions: out.slice(0, Math.max(1, limit || 8)),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const region = searchParams.get("region") || null;
  const limit = parseInt(searchParams.get("limit") || "8", 10);

  const safeLimit = Number.isFinite(limit) ? limit : 8;
  const hasAnyQuery = Boolean(query.trim());
  const isAbbrevQuery = looksLikeCompanyAbbreviationQuery(query);

  // Abbreviation-like queries (e.g. "мсу23") are better handled by in-memory logic
  // because Meilisearch suggest searches only by "name".
  if (isAbbrevQuery) {
    const data = await biznesinfoSuggest({ query, region, limit: safeLimit });
    return NextResponse.json(dedupeCompanySuggestions(data, safeLimit));
  }

  // Try Meilisearch first
  try {
    if (await isMeiliHealthy()) {
      const data = await meiliSuggest({
        query,
        region,
        limit: safeLimit,
      });
      const normalized = dedupeCompanySuggestions(data, safeLimit);
      if (!hasAnyQuery) return NextResponse.json(normalized);
      if ((normalized?.suggestions || []).length > 0) return NextResponse.json(normalized);
    }
  } catch (error) {
    console.error("Meilisearch error, falling back to in-memory suggest:", error);
  }

  // Fallback to in-memory suggest
  const data = await biznesinfoSuggest({
    query,
    region,
    limit: safeLimit,
  });
  return NextResponse.json(dedupeCompanySuggestions(data, safeLimit));
}
