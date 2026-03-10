import { meiliSearch } from "@/lib/meilisearch";

import type {
  BiznesinfoCatalogResponse,
  BiznesinfoCompanyResponse,
  BiznesinfoCompanySummary,
  BiznesinfoRubricResponse,
  BiznesinfoSearchResponse,
  BiznesinfoSuggestResponse,
} from "./types";

import {
  type BiznesinfoRubricHint,
  biznesinfoDetectRubricHintsFromPg,
  biznesinfoGetCatalogFromPg,
  biznesinfoGetCompaniesSummaryByIds,
  biznesinfoGetCompanyById,
  biznesinfoGetRubricCompaniesFromPg,
  biznesinfoSuggestFromPg,
  ensureBiznesinfoPgSchema,
} from "./postgres";

let warmupPromise: Promise<void> | null = null;

export function biznesinfoWarmStore(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  warmupPromise = ensureBiznesinfoPgSchema()
    .then(() => undefined)
    .catch((error) => {
      warmupPromise = null;
      throw error;
    });

  return warmupPromise;
}

export async function biznesinfoGetCatalog(region: string | null): Promise<BiznesinfoCatalogResponse> {
  return biznesinfoGetCatalogFromPg(region);
}

export async function biznesinfoGetRubricCompanies(params: {
  slug: string;
  region: string | null;
  query: string | null;
  offset: number;
  limit: number;
}): Promise<BiznesinfoRubricResponse> {
  return biznesinfoGetRubricCompaniesFromPg(params);
}

export async function biznesinfoGetCompany(id: string): Promise<BiznesinfoCompanyResponse> {
  return biznesinfoGetCompanyById(id);
}

export async function biznesinfoSuggest(params: {
  query: string;
  region: string | null;
  limit: number;
}): Promise<BiznesinfoSuggestResponse> {
  return biznesinfoSuggestFromPg(params);
}

export type { BiznesinfoRubricHint };

export async function biznesinfoDetectRubricHints(params: {
  text: string;
  limit: number;
}): Promise<BiznesinfoRubricHint[]> {
  return biznesinfoDetectRubricHintsFromPg(params);
}

export async function biznesinfoSearch(params: {
  query: string;
  service?: string;
  city?: string | null;
  region: string | null;
  offset: number;
  limit: number;
}): Promise<BiznesinfoSearchResponse> {
  return meiliSearch({
    query: params.query,
    service: params.service,
    region: params.region,
    city: params.city,
    offset: params.offset,
    limit: params.limit,
  });
}

export async function biznesinfoGetCompaniesSummary(ids: string[]): Promise<BiznesinfoCompanySummary[]> {
  return biznesinfoGetCompaniesSummaryByIds(ids);
}
