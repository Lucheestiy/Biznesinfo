export interface BiznesinfoPhoneExt {
  number: string;
  labels: string[];
}

export interface BiznesinfoCategoryRef {
  slug: string;
  name: string;
  url: string;
}

export interface BiznesinfoRubricRef {
  slug: string;
  name: string;
  url: string;
  category_slug: string;
  category_name: string;
}

export interface BiznesinfoWorkHours {
  work_time?: string;
  break_time?: string;
  status?: string;
}

export interface BiznesinfoCompanyExtra {
  lat: number | null;
  lng: number | null;
}

export interface BiznesinfoPhoto {
  url: string;
  alt?: string;
}

export interface BiznesinfoProduct {
  name: string;
  description?: string;
  image_url?: string;
  price?: string;
}

export interface BiznesinfoService {
  name: string;
  description?: string;
  image_url?: string;
}

export interface BiznesinfoReview {
  author: string;
  date?: string;
  rating?: number;
  text: string;
}

export interface BiznesinfoCompany {
  source: "biznesinfo";
  source_id: string; // company subdomain
  source_url: string;
  name: string;
  unp: string;
  country: string;
  region: string;
  city: string;
  address: string;
  phones: string[];
  phones_ext: BiznesinfoPhoneExt[];
  emails: string[];
  websites: string[];
  description: string;
  about: string;
  contact_person: string;
  logo_url: string;
  work_hours: BiznesinfoWorkHours;
  categories: BiznesinfoCategoryRef[];
  rubrics: BiznesinfoRubricRef[];
  extra: BiznesinfoCompanyExtra;
  // Optional extended fields
  hero_image?: string;
  photos?: BiznesinfoPhoto[];
  products?: BiznesinfoProduct[];
  services_list?: BiznesinfoService[];
  reviews?: BiznesinfoReview[];
}

export interface BiznesinfoCompanySummary {
  id: string;
  source: "biznesinfo";
  name: string;
  address: string;
  city: string;
  region: string;
  work_hours: BiznesinfoWorkHours;
  phones_ext: BiznesinfoPhoneExt[];
  phones: string[];
  emails: string[];
  websites: string[];
  description: string;
  about: string;
  logo_url: string;
  primary_category_slug: string | null;
  primary_category_name: string | null;
  primary_rubric_slug: string | null;
  primary_rubric_name: string | null;
}

export interface BiznesinfoCatalogRubric {
  slug: string; // full slug: "<top>/<rubric>"
  name: string;
  url: string;
  count: number;
}

export interface BiznesinfoCatalogCategory {
  slug: string;
  name: string;
  url: string;
  icon: string | null;
  company_count: number;
  rubrics: BiznesinfoCatalogRubric[];
}

export interface BiznesinfoCatalogResponse {
  stats: {
    companies_total: number;
    categories_total: number;
    rubrics_total: number;
    updated_at: string | null;
    source_path: string | null;
  };
  categories: BiznesinfoCatalogCategory[];
}

export interface BiznesinfoCategoryResponse {
  category: BiznesinfoCatalogCategory;
}

export interface BiznesinfoRubricResponse {
  rubric: {
    slug: string;
    name: string;
    url: string;
    category_slug: string;
    category_name: string;
    count: number;
  };
  companies: BiznesinfoCompanySummary[];
  page: {
    offset: number;
    limit: number;
    total: number;
  };
}

export interface BiznesinfoCompanyResponse {
  id: string;
  company: BiznesinfoCompany;
  primary: {
    category_slug: string | null;
    rubric_slug: string | null;
  };
}

export interface BiznesinfoSuggestResponse {
  query: string;
  suggestions: Array<
    | { type: "category"; slug: string; name: string; url: string; icon: string | null; count: number }
    | { type: "rubric"; slug: string; name: string; url: string; icon: string | null; category_name: string; count: number }
    | { type: "company"; id: string; name: string; url: string; icon: string | null; subtitle: string }
  >;
}

export interface BiznesinfoSearchResponse {
  query: string;
  total: number;
  companies: BiznesinfoCompanySummary[];
}
