import { getCompaniesIndex, isMeiliHealthy } from "./client";
import type { MeiliSearchParams, MeiliCompanyDocument } from "./types";
import type { IbizCompanySummary, IbizSearchResponse, IbizSuggestResponse } from "../ibiz/types";
import { IBIZ_CATEGORY_ICONS } from "../ibiz/icons";

function documentToSummary(doc: MeiliCompanyDocument): IbizCompanySummary {
  return {
    id: doc.id,
    source: doc.source,
    name: doc.name,
    address: doc.address,
    city: doc.city,
    region: doc.region,
    work_hours: {
      status: doc.work_hours_status || undefined,
      work_time: doc.work_hours_time || undefined,
    },
    phones_ext: doc.phones_ext || [],
    phones: doc.phones,
    emails: doc.emails,
    websites: doc.websites,
    description: doc.description,
    about: doc.about || "",
    logo_url: doc.logo_url,
    primary_category_slug: doc.primary_category_slug,
    primary_category_name: doc.primary_category_name,
    primary_rubric_slug: doc.primary_rubric_slug,
    primary_rubric_name: doc.primary_rubric_name,
  };
}

export async function meiliSearch(params: MeiliSearchParams): Promise<IbizSearchResponse> {
  const index = getCompaniesIndex();

  const filter: string[] = [];

  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }
  if (params.categorySlug) {
    filter.push(`category_slugs = "${params.categorySlug}"`);
  }
  if (params.rubricSlug) {
    filter.push(`rubric_slugs = "${params.rubricSlug}"`);
  }

  // Determine search query and attributes to search on
  const query = (params.query || "").trim();
  const keywords = (params.keywords || "").trim();
  let searchQuery = query;
  let attributesToSearchOn: string[] | undefined;
  let matchingStrategy: "all" | "last" | "frequency" | undefined;

  // If keywords provided, search only in keywords field (generated from rubrics)
  if (keywords) {
    if (searchQuery) {
      // Combine both: prioritize company name + additionally match keywords
      searchQuery = `${searchQuery} ${keywords}`;
      attributesToSearchOn = ["name", "keywords"];
      matchingStrategy = "all";
    } else {
      // Only keywords search - search only in keywords field
      searchQuery = keywords;
      attributesToSearchOn = ["keywords"];
      matchingStrategy = "all";
    }
  } else if (searchQuery) {
    // Company name search should be strict (do not match by description/other fields)
    attributesToSearchOn = ["name"];
    matchingStrategy = "all";
  }

  const result = await index.search(searchQuery, {
    offset: params.offset || 0,
    limit: params.limit || 24,
    filter: filter.length > 0 ? filter : undefined,
    attributesToSearchOn,
    matchingStrategy,
    attributesToRetrieve: [
      "id", "source", "name", "description", "about", "address", "city", "region",
      "phones", "phones_ext", "emails", "websites", "logo_url",
      "primary_category_slug", "primary_category_name",
      "primary_rubric_slug", "primary_rubric_name",
      "work_hours_status", "work_hours_time",
    ],
  });

  return {
    query: params.query,
    total: result.estimatedTotalHits || 0,
    companies: result.hits.map(documentToSummary),
  };
}

export async function meiliSuggest(params: {
  query: string;
  region?: string | null;
  limit?: number;
}): Promise<IbizSuggestResponse> {
  const index = getCompaniesIndex();

  const filter: string[] = [];
  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }

  const result = await index.search(params.query, {
    limit: params.limit || 8,
    filter: filter.length > 0 ? filter : undefined,
    attributesToSearchOn: ["name"],
    matchingStrategy: "all",
    attributesToRetrieve: [
      "id", "name", "address", "city",
      "primary_category_slug", "primary_category_name",
    ],
  });

  const suggestions: IbizSuggestResponse["suggestions"] = result.hits.map(hit => ({
    type: "company" as const,
    id: hit.id,
    name: hit.name,
    url: `/company/${hit.id}`,
    icon: hit.primary_category_slug ? IBIZ_CATEGORY_ICONS[hit.primary_category_slug] || null : null,
    subtitle: hit.address || hit.city || "",
  }));

  return {
    query: params.query,
    suggestions,
  };
}

export { isMeiliHealthy };
