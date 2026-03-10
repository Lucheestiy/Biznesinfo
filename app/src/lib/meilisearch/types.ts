// Document structure for Meilisearch index
export interface MeiliCompanyDocument {
  id: string; // primary key
  name: string;
  normalizedName: string;
  description: string;
  servicesText: string;
  serviceTitles: string[];
  serviceCategories: string[];
  categoryNames: string[];
  nameTokens: string[];
  serviceTokens: string[];
  categoryTokens: string[];
  domainTags: string[];
  data_quality_score: number;
  data_quality_tier: "high" | "medium" | "basic";
  region: string;
  city: string;
  status: string;
  logo_url: string;
  logo_rank: number;
  createdAt: string;
  updatedAt: string;
  _geo?: { lat: number; lng: number } | null;

  // Legacy compatibility fields used by existing routes/components.
  source?: "biznesinfo";
  unp?: string;
  about?: string;
  address?: string;
  city_norm?: string;
  phones?: string[];
  emails?: string[];
  websites?: string[];
  contact_person?: string;
  category_slugs?: string[];
  category_names?: string[];
  rubric_slugs?: string[];
  rubric_names?: string[];
  primary_category_slug?: string | null;
  primary_category_name?: string | null;
  primary_rubric_slug?: string | null;
  primary_rubric_name?: string | null;
  work_hours_status?: string | null;
  work_hours_time?: string | null;
  phones_ext?: Array<{ number: string; labels: string[] }>;
  keywords?: string[];
}

export interface MeiliSearchParams {
  query?: string;
  service?: string;
  keywords?: string | null;
  region?: string | null;
  city?: string | null;
  supplyType?: "any" | "delivery" | "pickup";
  businessFormat?: "any" | "b2b" | "b2c";
  abVariant?: "control" | "treatment" | null;
  abSeed?: string | null;
  explain?: boolean;
  lat?: number | null;
  lng?: number | null;
  page?: number | null;
  categorySlug?: string | null;
  rubricSlug?: string | null;
  offset?: number;
  limit?: number;
}

export interface MeiliSearchResult {
  hits: MeiliCompanyDocument[];
  query: string;
  processingTimeMs: number;
  limit: number;
  offset: number;
  estimatedTotalHits: number;
}
