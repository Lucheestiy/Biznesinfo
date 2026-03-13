import { getMeiliClient, getCompaniesIndex } from "./client";
import { configureCompaniesIndex } from "./config";
import type { MeiliCompanyDocument } from "./types";

import {
  biznesinfoListCompaniesForSearchIndex,
  biznesinfoListCompaniesForSearchIndexBatch,
} from "../biznesinfo/postgres";
import { canonicalizeSemanticToken, tokenizeSemanticText } from "../search/semantic";
import { normalizeCityForFilter } from "../utils/location";

type IndexableCompany = Awaited<ReturnType<typeof biznesinfoListCompaniesForSearchIndex>>[number];

export type ReindexAllResult = {
  total: number;
  indexed: number;
};

export type IndexCompanyResult = {
  id: string;
  indexed: boolean;
  reason?: "not_found";
};

export type DeleteCompanyResult = {
  id: string;
  deleted: boolean;
};

const REINDEX_DB_PAGE_SIZE = 2000;

function buildKeywordList(company: IndexableCompany): string[] {
  const source = [
    company.description,
    company.servicesText,
    company.region,
    company.city,
    company.address,
    ...(company.serviceTitles || []),
    ...(company.serviceCategories || []),
    ...(company.categoryNames || []),
    ...(company.serviceTokens || []),
    ...(company.categoryTokens || []),
    ...(company.domainTags || []),
  ].filter(Boolean).join(" ");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokenizeSemanticText(source)) {
    const token = canonicalizeSemanticToken(raw);
    if (!token || token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 160) break;
  }
  return out;
}

function toDocument(company: IndexableCompany): MeiliCompanyDocument {
  const categoryNames = (company.categoryNames || []).filter(Boolean);
  const serviceTitles = (company.serviceTitles || []).filter(Boolean);
  const serviceCategories = (company.serviceCategories || []).filter(Boolean);
  const description = company.description || "";
  return {
    id: company.id,
    name: company.name || "",
    normalizedName: company.normalizedName || "",
    description,
    servicesText: company.servicesText || "",
    serviceTitles,
    serviceCategories,
    categoryNames,
    nameTokens: (company.nameTokens || []).filter(Boolean),
    serviceTokens: (company.serviceTokens || []).filter(Boolean),
    categoryTokens: (company.categoryTokens || []).filter(Boolean),
    domainTags: (company.domainTags || []).filter(Boolean),
    data_quality_score: Number.isFinite(company.data_quality_score) ? company.data_quality_score : 0,
    data_quality_tier: company.data_quality_tier || "basic",
    region: company.region || "",
    city: company.city || "",
    address: company.address || "",
    status: company.status || "active",
    logo_url: company.logo_url || "",
    logo_rank: company.logo_rank || 0,
    createdAt: company.createdAt || new Date(0).toISOString(),
    updatedAt: company.updatedAt || company.createdAt || new Date(0).toISOString(),
    _geo: company._geo || null,

    // Legacy compatibility fields used by nearby/AI flows.
    source: "biznesinfo",
    unp: "",
    about: description,
    city_norm: normalizeCityForFilter(company.city || ""),
    phones: [],
    emails: [],
    websites: [],
    contact_person: "",
    category_slugs: [],
    category_names: categoryNames,
    rubric_slugs: [],
    rubric_names: categoryNames,
    primary_category_slug: null,
    primary_category_name: categoryNames[0] || null,
    primary_rubric_slug: null,
    primary_rubric_name: categoryNames[0] || null,
    work_hours_status: null,
    work_hours_time: null,
    phones_ext: [],
    keywords: buildKeywordList(company),
  };
}

async function addDocumentsInBatches(documents: MeiliCompanyDocument[], batchSize = 2000): Promise<number> {
  if (documents.length === 0) return 0;

  const client = getMeiliClient();
  const index = getCompaniesIndex();
  let indexed = 0;

  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = documents.slice(offset, offset + batchSize);
    const task = await index.addDocuments(batch);
    await client.waitForTask(task.taskUid, { timeOutMs: 120000 });
    indexed += batch.length;
  }

  return indexed;
}

export async function reindexAll(): Promise<ReindexAllResult> {
  await configureCompaniesIndex();

  const client = getMeiliClient();
  const index = getCompaniesIndex();

  const removeTask = await index.deleteAllDocuments();
  await client.waitForTask(removeTask.taskUid, { timeOutMs: 120000 });

  let total = 0;
  let indexed = 0;
  let afterId: string | null = null;

  for (;;) {
    const companies = await biznesinfoListCompaniesForSearchIndexBatch({
      afterId,
      limit: REINDEX_DB_PAGE_SIZE,
    });
    if (companies.length === 0) break;

    const documents = companies
      .filter((company) => Boolean(company.id))
      .map((company) => toDocument(company));

    total += documents.length;
    indexed += await addDocumentsInBatches(documents, REINDEX_DB_PAGE_SIZE);
    afterId = companies[companies.length - 1]?.id || null;
  }

  return {
    total,
    indexed,
  };
}

export async function indexCompany(id: string): Promise<IndexCompanyResult> {
  const targetId = String(id || "").trim();
  if (!targetId) {
    throw new Error("Company id is required");
  }

  await configureCompaniesIndex();
  const companyRows = await biznesinfoListCompaniesForSearchIndex([targetId]);
  const company = companyRows[0];

  if (!company) {
    await deleteCompany(targetId);
    return { id: targetId, indexed: false, reason: "not_found" };
  }

  const indexed = await addDocumentsInBatches([toDocument(company)], 1);
  return {
    id: targetId,
    indexed: indexed === 1,
  };
}

export async function deleteCompany(id: string): Promise<DeleteCompanyResult> {
  const targetId = String(id || "").trim();
  if (!targetId) {
    throw new Error("Company id is required");
  }

  await configureCompaniesIndex();
  const client = getMeiliClient();
  const index = getCompaniesIndex();

  const task = await index.deleteDocument(targetId);
  await client.waitForTask(task.taskUid, { timeOutMs: 120000 });
  return {
    id: targetId,
    deleted: true,
  };
}

// Backward-compatible alias.
export async function indexCompanies(): Promise<ReindexAllResult> {
  return reindexAll();
}
