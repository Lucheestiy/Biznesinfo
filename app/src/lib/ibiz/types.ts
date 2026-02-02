export interface IbizPhoneExt {
  number: string;
  labels: string[];
}

export interface IbizCategoryRef {
  slug: string;
  name: string;
  url: string;
}

export interface IbizRubricRef {
  slug: string;
  name: string;
  url: string;
  category_slug: string;
  category_name: string;
}

export interface IbizWorkHours {
  work_time?: string;
  break_time?: string;
  status?: string;
}

export interface IbizCompanyExtra {
  lat: number | null;
  lng: number | null;
}

export interface IbizPhoto {
  url: string;
  alt?: string;
}

export interface IbizProduct {
  name: string;
  description?: string;
  image_url?: string;
  price?: string;
}

export interface IbizService {
  name: string;
  description?: string;
  image_url?: string;
}

export interface IbizReview {
  author: string;
  date?: string;
  rating?: number;
  text: string;
}

export interface IbizCompany {
  source: "ibiz" | "belarusinfo";
  source_id: string; // company subdomain
  source_url: string;
  name: string;
  unp: string;
  country: string;
  region: string;
  city: string;
  address: string;
  phones: string[];
  phones_ext: IbizPhoneExt[];
  emails: string[];
  websites: string[];
  description: string;
  about: string;
  contact_person: string;
  logo_url: string;
  work_hours: IbizWorkHours;
  categories: IbizCategoryRef[];
  rubrics: IbizRubricRef[];
  extra: IbizCompanyExtra;
  // Optional extended fields
  hero_image?: string;
  photos?: IbizPhoto[];
  products?: IbizProduct[];
  services_list?: IbizService[];
  reviews?: IbizReview[];
}

export interface IbizCompanySummary {
  id: string;
  source: "ibiz" | "belarusinfo";
  name: string;
  address: string;
  city: string;
  region: string;
  work_hours: IbizWorkHours;
  phones_ext: IbizPhoneExt[];
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

export interface IbizCatalogRubric {
  slug: string; // full slug: "<top>/<rubric>"
  name: string;
  url: string;
  count: number;
}

export interface IbizCatalogCategory {
  slug: string;
  name: string;
  url: string;
  icon: string | null;
  company_count: number;
  rubrics: IbizCatalogRubric[];
}

export interface IbizCatalogResponse {
  stats: {
    companies_total: number;
    categories_total: number;
    rubrics_total: number;
    updated_at: string | null;
    source_path: string | null;
  };
  categories: IbizCatalogCategory[];
}

export interface IbizCategoryResponse {
  category: IbizCatalogCategory;
}

export interface IbizRubricResponse {
  rubric: {
    slug: string;
    name: string;
    url: string;
    category_slug: string;
    category_name: string;
    count: number;
  };
  companies: IbizCompanySummary[];
  page: {
    offset: number;
    limit: number;
    total: number;
  };
}

export interface IbizCompanyResponse {
  id: string;
  company: IbizCompany;
  primary: {
    category_slug: string | null;
    rubric_slug: string | null;
  };
}

export interface IbizSuggestResponse {
  query: string;
  suggestions: Array<
    | { type: "category"; slug: string; name: string; url: string; icon: string | null; count: number }
    | { type: "rubric"; slug: string; name: string; url: string; icon: string | null; category_name: string; count: number }
    | { type: "company"; id: string; name: string; url: string; icon: string | null; subtitle: string }
  >;
}

export interface IbizSearchResponse {
  query: string;
  total: number;
  companies: IbizCompanySummary[];
}
