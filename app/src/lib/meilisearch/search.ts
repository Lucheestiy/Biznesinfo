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
  let searchQuery = params.query || "";
  let attributesToSearchOn: string[] | undefined;

  // If keywords provided, search only in keywords field (generated from rubrics)
  if (params.keywords && params.keywords.trim()) {
    if (searchQuery) {
      // Combine both: first search by name, then filter by keywords
      searchQuery = `${searchQuery} ${params.keywords}`;
    } else {
      // Only keywords search - search only in keywords field
      searchQuery = params.keywords;
      attributesToSearchOn = ["keywords"];
    }
  }

  const result = await index.search(searchQuery, {
    offset: params.offset || 0,
    limit: params.limit || 24,
    filter: filter.length > 0 ? filter : undefined,
    attributesToSearchOn,
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
