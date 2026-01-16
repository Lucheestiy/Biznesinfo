import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import type {
  IbizCatalogResponse,
  IbizCategoryRef,
  IbizCompany,
  IbizCompanyResponse,
  IbizCompanySummary,
  IbizRubricRef,
  IbizRubricResponse,
  IbizSearchResponse,
  IbizSuggestResponse,
} from "./types";

import { IBIZ_CATEGORY_ICONS } from "./icons";

const REGION_ALIAS: Record<string, string[]> = {
  minsk: ["minsk"],
  "minsk-region": ["minsk-region"],
  brest: ["brest"],
  vitebsk: ["vitebsk"],
  gomel: ["gomel"],
  grodno: ["grodno"],
  mogilev: ["mogilev"],
};

const POSTAL_PREFIX_TO_REGION_SLUG: Record<string, string> = {
  // Canonical Belarus postal prefixes
  "210": "vitebsk",
  "211": "vitebsk",
  "212": "mogilev",
  "213": "mogilev",
  "220": "minsk",
  "221": "minsk-region",
  "222": "minsk-region",
  "223": "minsk-region",
  "224": "brest",
  "225": "brest",
  "230": "grodno",
  "231": "grodno",
  "246": "gomel",
  "247": "gomel",

  // Rare “corrupted” prefixes observed in current ibiz dataset exports
  "200": "minsk",
  "201": "vitebsk",
  "202": "minsk-region",
  "215": "minsk",
  "217": "vitebsk",
  "227": "minsk-region",
  "232": "minsk",
  "234": "grodno",
  "236": "gomel",
  "249": "vitebsk",
  "264": "gomel",
  "270": "minsk",
  "274": "gomel",
};

function regionSlugFromPostalCode(address: string): string | null {
  const matches = (address || "").match(/\b2\d{5}\b/g);
  if (!matches) return null;
  for (const code of matches) {
    const prefix = code.slice(0, 3);
    const regionSlug = POSTAL_PREFIX_TO_REGION_SLUG[prefix];
    if (regionSlug) return regionSlug;
  }
  return null;
}

function normalizeRegionSlug(city: string, region: string, address: string): string | null {
  const cityLow = (city || "").toLowerCase();
  const regionLow = (region || "").toLowerCase();
  const addressLow = (address || "").toLowerCase();

  if (regionLow.includes("брест")) return "brest";
  if (regionLow.includes("витеб")) return "vitebsk";
  if (regionLow.includes("гомел")) return "gomel";
  if (regionLow.includes("гродн")) return "grodno";
  if (regionLow.includes("могил")) return "mogilev";

  if (cityLow.includes("брест")) return "brest";
  if (cityLow.includes("витеб")) return "vitebsk";
  if (cityLow.includes("гомел")) return "gomel";
  if (cityLow.includes("гродн")) return "grodno";
  if (cityLow.includes("могил")) return "mogilev";

  const looksLikeDistrict = (s: string): boolean => {
    const v = (s || "").toLowerCase();
    return v.includes("р-н") || v.includes("район") || v.includes("обл") || v.includes("область");
  };

  const minskDistrictRe = /минск(?:ий|ого|ому|ом)?\s*(?:р-н|район)/i;
  const minskOblastRe = /минск(?:ая|ой|ую|ом)?\s*(?:обл\.?|область)/i;

  const isMinskRegion =
    minskDistrictRe.test(cityLow) ||
    minskOblastRe.test(cityLow) ||
    minskDistrictRe.test(regionLow) ||
    minskOblastRe.test(regionLow) ||
    minskDistrictRe.test(addressLow) ||
    minskOblastRe.test(addressLow) ||
    (cityLow.includes("минск") && looksLikeDistrict(cityLow)) ||
    (regionLow.includes("минск") && looksLikeDistrict(regionLow));

  if (isMinskRegion) return "minsk-region";

  const fromPostal = regionSlugFromPostalCode(address || "");
  if (fromPostal) return fromPostal;

  if (cityLow.includes("минск")) return "minsk";

  if (regionLow.includes("минск")) return "minsk";

  return null;
}

function ibizDataPathCandidates(): string[] {
  const env = process.env.IBIZ_COMPANIES_JSONL_PATH?.trim();
  const candidates: string[] = [];
  if (env) candidates.push(env);

  candidates.push(path.join(process.cwd(), "public", "data", "ibiz", "companies.jsonl"));
  candidates.push(path.resolve(process.cwd(), "..", "..", "Info-ibiz", "output", "companies.jsonl"));
  return candidates;
}

function resolveCompaniesJsonlPath(): string {
  for (const p of ibizDataPathCandidates()) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  throw new Error(
    `IBIZ companies.jsonl not found. Set IBIZ_COMPANIES_JSONL_PATH or place it at public/data/ibiz/companies.jsonl. Tried: ${ibizDataPathCandidates().join(
      ", ",
    )}`,
  );
}

function safeLower(s: string): string {
  return (s || "").toLowerCase();
}

function normalizeLogoUrl(raw: string): string {
  const url = (raw || "").trim();
  if (!url) return "";
  const low = url.toLowerCase();
  if (low.endsWith("/images/icons/og-icon.png")) return "";
  if (low.includes("/images/logo/no-logo")) return "";
  if (low.includes("/images/logo/no_logo")) return "";
  return url;
}

function buildCompanySummary(company: IbizCompany, regionSlug: string | null): IbizCompanySummary {
  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;
  return {
    id: company.source_id,
    source: company.source,
    name: company.name || "",
    address: company.address || "",
    city: company.city || "",
    region: regionSlug || "",
    work_hours: company.work_hours || {},
    phones_ext: company.phones_ext || [],
    phones: company.phones || [],
    emails: company.emails || [],
    websites: company.websites || [],
    description: company.description || company.about || "",
    logo_url: company.logo_url || "",
    primary_category_slug: primaryCategory?.slug ?? null,
    primary_category_name: primaryCategory?.name ?? null,
    primary_rubric_slug: primaryRubric?.slug ?? null,
    primary_rubric_name: primaryRubric?.name ?? null,
  };
}

type Store = {
  sourcePath: string;
  updatedAt: string | null;
  companiesById: Map<string, IbizCompany>;
  companySummaryById: Map<string, IbizCompanySummary>;
  companyRegionById: Map<string, string | null>;
  companySearchById: Map<string, string>;

  categoriesBySlug: Map<string, IbizCategoryRef>;
  rubricsBySlug: Map<string, IbizRubricRef>;
  rubricsByCategorySlug: Map<string, string[]>;

  companyIdsByRubricSlug: Map<string, string[]>;

  companyCountAll: number;
  companyCountByRegion: Map<string, number>;
  categoryCountAll: Map<string, number>;
  categoryCountByRegion: Map<string, Map<string, number>>;
  rubricCountAll: Map<string, number>;
  rubricCountByRegion: Map<string, Map<string, number>>;
};

let storeCache: { sourcePath: string; mtimeMs: number; store: Store } | null = null;
let storeLoadPromise: Promise<Store> | null = null;
let storeLoadKey: string | null = null;

function regionAliasKeys(region: string): string[] {
  return Array.from(new Set(REGION_ALIAS[region] || [region]));
}

function sumRegionCount(map: Map<string, number>, region: string): number {
  let total = 0;
  for (const regionKey of regionAliasKeys(region)) {
    total += map.get(regionKey) || 0;
  }
  return total;
}

function sumRegionNestedCount(
  map: Map<string, Map<string, number>>,
  region: string,
  key: string,
): number {
  let total = 0;
  for (const regionKey of regionAliasKeys(region)) {
    total += map.get(regionKey)?.get(key) || 0;
  }
  return total;
}

async function loadStoreFrom(sourcePath: string, stat: fs.Stats): Promise<Store> {
  const updatedAt = stat?.mtime ? new Date(stat.mtime).toISOString() : null;

  const companiesById = new Map<string, IbizCompany>();
  const companySummaryById = new Map<string, IbizCompanySummary>();
  const companyRegionById = new Map<string, string | null>();
  const companySearchById = new Map<string, string>();

  const categoriesBySlug = new Map<string, IbizCategoryRef>();
  const rubricsBySlug = new Map<string, IbizRubricRef>();
  const rubricsByCategorySlug = new Map<string, string[]>();

  const companyIdsByRubricSlug = new Map<string, string[]>();

  const companyCountByRegion = new Map<string, number>();
  const categoryCountAll = new Map<string, number>();
  const categoryCountByRegion = new Map<string, Map<string, number>>();
  const rubricCountAll = new Map<string, number>();
  const rubricCountByRegion = new Map<string, Map<string, number>>();

  const input = fs.createReadStream(sourcePath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    let company: IbizCompany;
    try {
      company = JSON.parse(raw) as IbizCompany;
    } catch {
      continue;
    }

    const id = (company.source_id || "").trim();
    if (!id) continue;

    company.logo_url = normalizeLogoUrl(company.logo_url || "");

    const regionSlug = normalizeRegionSlug(company.city || "", company.region || "", company.address || "");
    companiesById.set(id, company);
    companyRegionById.set(id, regionSlug);

    const summary = buildCompanySummary(company, regionSlug);
    companySummaryById.set(id, summary);

    const searchText = [
      company.name,
      company.description,
      company.about,
      company.address,
      (company.phones || []).join(" "),
      (company.emails || []).join(" "),
      (company.websites || []).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    companySearchById.set(id, safeLower(searchText));

    if (regionSlug) {
      companyCountByRegion.set(regionSlug, (companyCountByRegion.get(regionSlug) || 0) + 1);
    }

    for (const cat of company.categories || []) {
      if (!cat?.slug) continue;
      if (!categoriesBySlug.has(cat.slug)) categoriesBySlug.set(cat.slug, cat);
      categoryCountAll.set(cat.slug, (categoryCountAll.get(cat.slug) || 0) + 1);
      if (regionSlug) {
        let m = categoryCountByRegion.get(regionSlug);
        if (!m) {
          m = new Map<string, number>();
          categoryCountByRegion.set(regionSlug, m);
        }
        m.set(cat.slug, (m.get(cat.slug) || 0) + 1);
      }
    }

    const rubricSlugsForCompany = new Set<string>();
    for (const r of company.rubrics || []) {
      if (!r?.slug || !r.category_slug) continue;
      if (!rubricsBySlug.has(r.slug)) rubricsBySlug.set(r.slug, r);
      rubricCountAll.set(r.slug, (rubricCountAll.get(r.slug) || 0) + 1);
      if (regionSlug) {
        let m = rubricCountByRegion.get(regionSlug);
        if (!m) {
          m = new Map<string, number>();
          rubricCountByRegion.set(regionSlug, m);
        }
        m.set(r.slug, (m.get(r.slug) || 0) + 1);
      }

      if (!rubricsByCategorySlug.has(r.category_slug)) rubricsByCategorySlug.set(r.category_slug, []);
      if (!rubricsByCategorySlug.get(r.category_slug)!.includes(r.slug)) {
        rubricsByCategorySlug.get(r.category_slug)!.push(r.slug);
      }

      rubricSlugsForCompany.add(r.slug);
    }

    for (const rubricSlug of rubricSlugsForCompany) {
      if (!companyIdsByRubricSlug.has(rubricSlug)) companyIdsByRubricSlug.set(rubricSlug, []);
      companyIdsByRubricSlug.get(rubricSlug)!.push(id);
    }
  }

  for (const [catSlug, rubricSlugs] of rubricsByCategorySlug.entries()) {
    rubricSlugs.sort((a, b) => {
      const ra = rubricsBySlug.get(a);
      const rb = rubricsBySlug.get(b);
      return (ra?.name || a).localeCompare(rb?.name || b, "ru", { sensitivity: "base" });
    });
    rubricsByCategorySlug.set(catSlug, rubricSlugs);
  }

  const companyCountAll = companiesById.size;

  return {
    sourcePath,
    updatedAt,
    companiesById,
    companySummaryById,
    companyRegionById,
    companySearchById,
    categoriesBySlug,
    rubricsBySlug,
    rubricsByCategorySlug,
    companyIdsByRubricSlug,
    companyCountAll,
    companyCountByRegion,
    categoryCountAll,
    categoryCountByRegion,
    rubricCountAll,
    rubricCountByRegion,
  };
}

async function getStore(): Promise<Store> {
  const sourcePath = resolveCompaniesJsonlPath();
  const stat = fs.statSync(sourcePath);
  const mtimeMs = stat.mtimeMs || 0;

  if (storeCache && storeCache.sourcePath === sourcePath && storeCache.mtimeMs === mtimeMs) {
    return storeCache.store;
  }

  const key = `${sourcePath}:${mtimeMs}`;
  if (storeLoadPromise && storeLoadKey === key) {
    return storeLoadPromise;
  }

  storeLoadKey = key;
  storeLoadPromise = loadStoreFrom(sourcePath, stat);

  try {
    const store = await storeLoadPromise;
    storeCache = { sourcePath, mtimeMs, store };
    return store;
  } catch (e) {
    if (storeCache) {
      return storeCache.store;
    }
    throw e;
  } finally {
    if (storeLoadKey === key) {
      storeLoadPromise = null;
      storeLoadKey = null;
    }
  }
}

function applyRegionAlias(region: string | null, companyRegionSlug: string | null): boolean {
  if (!region) return true;
  const want = REGION_ALIAS[region] || [region];
  if (!companyRegionSlug) return false;
  return want.includes(companyRegionSlug);
}

export async function ibizGetCatalog(region: string | null): Promise<IbizCatalogResponse> {
  const store = await getStore();
  const categories: IbizCatalogResponse["categories"] = [];

  const cats = Array.from(store.categoriesBySlug.values()).sort((a, b) =>
    (a.name || a.slug).localeCompare(b.name || b.slug, "ru", { sensitivity: "base" }),
  );

  for (const cat of cats) {
    const rubrics: IbizCatalogResponse["categories"][number]["rubrics"] = [];
    const rubricSlugs = store.rubricsByCategorySlug.get(cat.slug) || [];
    for (const rubricSlug of rubricSlugs) {
      const r = store.rubricsBySlug.get(rubricSlug);
      if (!r) continue;
      const count = region ? sumRegionNestedCount(store.rubricCountByRegion, region, r.slug) : store.rubricCountAll.get(r.slug) || 0;
      rubrics.push({ slug: r.slug, name: r.name || r.slug, url: r.url || "", count });
    }

    const company_count = region ? sumRegionNestedCount(store.categoryCountByRegion, region, cat.slug) : store.categoryCountAll.get(cat.slug) || 0;

    categories.push({
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: cat.url || "",
      icon: IBIZ_CATEGORY_ICONS[cat.slug] || null,
      company_count,
      rubrics,
    });
  }

  const companies_total = region ? sumRegionCount(store.companyCountByRegion, region) : store.companyCountAll;
  const rubrics_total = store.rubricsBySlug.size;
  const categories_total = store.categoriesBySlug.size;

  return {
    stats: {
      companies_total,
      categories_total,
      rubrics_total,
      updated_at: store.updatedAt,
      source_path: store.sourcePath,
    },
    categories,
  };
}

export async function ibizGetRubricCompanies(params: {
  slug: string;
  region: string | null;
  query: string | null;
  offset: number;
  limit: number;
}): Promise<IbizRubricResponse> {
  const store = await getStore();
  const r = store.rubricsBySlug.get(params.slug);
  if (!r) {
    throw new Error(`rubric_not_found:${params.slug}`);
  }

  const ids = store.companyIdsByRubricSlug.get(params.slug) || [];
  const q = (params.query || "").trim().toLowerCase();

  const filtered: string[] = [];
  for (const id of ids) {
    const companyRegionSlug = store.companyRegionById.get(id) || null;
    if (!applyRegionAlias(params.region, companyRegionSlug)) continue;
    if (q) {
      const search = store.companySearchById.get(id) || "";
      if (!search.includes(q)) continue;
    }
    filtered.push(id);
  }

  const total = filtered.length;
  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));
  const pageIds = filtered.slice(offset, offset + limit);

  const companies: IbizCompanySummary[] = [];
  for (const id of pageIds) {
    const summary = store.companySummaryById.get(id);
    if (summary) companies.push(summary);
  }

  const count = params.region ? sumRegionNestedCount(store.rubricCountByRegion, params.region, r.slug) : store.rubricCountAll.get(r.slug) || 0;

  return {
    rubric: {
      slug: r.slug,
      name: r.name || r.slug,
      url: r.url || "",
      category_slug: r.category_slug,
      category_name: r.category_name || r.category_slug,
      count,
    },
    companies,
    page: { offset, limit, total },
  };
}

export async function ibizGetCompany(id: string): Promise<IbizCompanyResponse> {
  const store = await getStore();
  const company = store.companiesById.get(id);
  if (!company) {
    throw new Error(`company_not_found:${id}`);
  }
  return {
    company,
    primary: {
      category_slug: company.categories?.[0]?.slug ?? null,
      rubric_slug: company.rubrics?.[0]?.slug ?? null,
    },
  };
}

export async function ibizSuggest(params: {
  query: string;
  region: string | null;
  limit: number;
}): Promise<IbizSuggestResponse> {
  const store = await getStore();
  const q = (params.query || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(20, params.limit || 8));
  if (q.length < 2) return { query: params.query, suggestions: [] };

  const suggestions: IbizSuggestResponse["suggestions"] = [];

  for (const cat of store.categoriesBySlug.values()) {
    if (suggestions.length >= limit) break;
    if (!safeLower(cat.name || "").includes(q)) continue;
    const count = params.region ? sumRegionNestedCount(store.categoryCountByRegion, params.region, cat.slug) : store.categoryCountAll.get(cat.slug) || 0;
    suggestions.push({
      type: "category",
      slug: cat.slug,
      name: cat.name || cat.slug,
      url: `/catalog/${cat.slug}`,
      icon: IBIZ_CATEGORY_ICONS[cat.slug] || null,
      count,
    });
  }

  for (const r of store.rubricsBySlug.values()) {
    if (suggestions.length >= limit) break;
    if (!safeLower(r.name || "").includes(q)) continue;
    const count = params.region ? sumRegionNestedCount(store.rubricCountByRegion, params.region, r.slug) : store.rubricCountAll.get(r.slug) || 0;
    suggestions.push({
      type: "rubric",
      slug: r.slug,
      name: r.name || r.slug,
      url: `/catalog/${r.category_slug}/${r.slug.split("/").slice(1).join("/")}`,
      icon: IBIZ_CATEGORY_ICONS[r.category_slug] || null,
      category_name: r.category_name || r.category_slug,
      count,
    });
  }

  if (suggestions.length < limit) {
    for (const [id, summary] of store.companySummaryById.entries()) {
      if (suggestions.length >= limit) break;
      const companyRegionSlug = store.companyRegionById.get(id) || null;
      if (!applyRegionAlias(params.region, companyRegionSlug)) continue;
      const search = store.companySearchById.get(id) || "";
      if (!search.includes(q)) continue;
      suggestions.push({
        type: "company",
        id,
        name: summary.name,
        url: `/company/${id}`,
        icon: summary.primary_category_slug ? IBIZ_CATEGORY_ICONS[summary.primary_category_slug] || null : null,
        subtitle: summary.address || summary.city || "",
      });
    }
  }

  return { query: params.query, suggestions };
}

export async function ibizSearch(params: {
  query: string;
  region: string | null;
  offset: number;
  limit: number;
}): Promise<IbizSearchResponse> {
  const store = await getStore();
  const q = (params.query || "").trim().toLowerCase();
  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));
  if (!q) return { query: params.query, total: 0, companies: [] };

  const matches: string[] = [];
  for (const [id, search] of store.companySearchById.entries()) {
    const companyRegionSlug = store.companyRegionById.get(id) || null;
    if (!applyRegionAlias(params.region, companyRegionSlug)) continue;
    if (!search.includes(q)) continue;
    matches.push(id);
  }

  const total = matches.length;
  const pageIds = matches.slice(offset, offset + limit);
  const companies: IbizCompanySummary[] = [];
  for (const id of pageIds) {
    const summary = store.companySummaryById.get(id);
    if (summary) companies.push(summary);
  }

  return { query: params.query, total, companies };
}

export async function ibizGetCompaniesSummary(ids: string[]): Promise<IbizCompanySummary[]> {
  const store = await getStore();
  const out: IbizCompanySummary[] = [];
  for (const raw of ids) {
    const id = (raw || "").trim();
    if (!id) continue;
    const summary = store.companySummaryById.get(id);
    if (summary) out.push(summary);
  }
  return out;
}
