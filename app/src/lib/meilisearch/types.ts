// Document structure for Meilisearch index
export interface MeiliCompanyDocument {
  id: string;                    // source_id (primary key)
  source: "ibiz" | "belarusinfo";
  name: string;
  description: string;
  about: string;
  address: string;
  city: string;
  city_norm: string;
  region: string;               // normalized slug (minsk, brest, etc.)
  phones: string[];
  emails: string[];
  websites: string[];
  logo_url: string;
  logo_rank: number;            // 2 = has logo, 1 = fallback avatar, 0 = none
  contact_person: string;

  // Categories & Rubrics (denormalized for filtering)
  category_slugs: string[];
  category_names: string[];
  rubric_slugs: string[];
  rubric_names: string[];
  primary_category_slug: string | null;
  primary_category_name: string | null;
  primary_rubric_slug: string | null;
  primary_rubric_name: string | null;

  // Geo (for future geo-search)
  _geo?: { lat: number; lng: number } | null;

  // Work hours (stored but not searched)
  work_hours_status: string | null;
  work_hours_time: string | null;

  // Phone extensions for display
  phones_ext: Array<{ number: string; labels: string[] }>;

  // Keywords for product/service search (generated from rubrics)
  keywords: string[];
}

export interface MeiliSearchParams {
  query: string;
  service?: string;
  keywords?: string | null;
  region?: string | null;
  city?: string | null;
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
