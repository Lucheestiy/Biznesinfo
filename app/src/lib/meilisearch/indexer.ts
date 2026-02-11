import fs from "node:fs";
import { createInterface } from "node:readline";
import { getMeiliClient, COMPANIES_INDEX } from "./client";
import { configureCompaniesIndex } from "./config";
import type { MeiliCompanyDocument } from "./types";
import type { BiznesinfoCompany } from "../biznesinfo/types";
import { generateCompanyKeywords } from "../biznesinfo/keywords";
import { getServerKeywordGenerationOptions } from "../biznesinfo/keywordRuntime";
import { BIZNESINFO_WEBSITE_OVERRIDES } from "../biznesinfo/websiteOverrides";
import { isExcludedBiznesinfoCompany, normalizeBiznesinfoUnp } from "../biznesinfo/exclusions";
import { normalizeCityForFilter } from "../utils/location";

// Region normalization logic (reused from store.ts)
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

  const minskDistrictRe = /минск(?:ий|ого|ому|ом)?\s*(?:р-н|район)/i;
  const minskOblastRe = /минск(?:ая|ой|ую|ом)?\s*(?:обл\.?|область)/i;

  const isMinskRegion =
    minskDistrictRe.test(cityLow) ||
    minskOblastRe.test(cityLow) ||
    minskDistrictRe.test(regionLow) ||
    minskOblastRe.test(regionLow) ||
    minskDistrictRe.test(addressLow) ||
    minskOblastRe.test(addressLow);

  if (isMinskRegion) return "minsk-region";

  if (cityLow.includes("минск")) return "minsk";
  if (regionLow.includes("минск")) return "minsk";

  return null;
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

function computeLogoRank(company: BiznesinfoCompany): number {
  if (normalizeLogoUrl(company.logo_url || "")) return 2;
  if ((company.name || "").trim()) return 1;
  return 0;
}

function applyWebsiteOverride(companyId: string, websites: string[]): string[] {
  const raw = (companyId || "").trim();
  if (!raw) return websites;
  const key = raw.toLowerCase();

  const hasOverride =
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, raw) ||
    Object.prototype.hasOwnProperty.call(BIZNESINFO_WEBSITE_OVERRIDES, key);
  if (!hasOverride) return websites;

  return BIZNESINFO_WEBSITE_OVERRIDES[raw] ?? BIZNESINFO_WEBSITE_OVERRIDES[key] ?? websites;
}

function companyToDocument(
  company: BiznesinfoCompany,
  keywordOptions = getServerKeywordGenerationOptions(),
): MeiliCompanyDocument {
  const regionSlug = normalizeRegionSlug(company.city, company.region, company.address);
  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;

  return {
    id: company.source_id,
    source: company.source,
    unp: normalizeBiznesinfoUnp(company.unp || ""),
    name: company.name || "",
    description: company.description || "",
    about: company.about || "",
    address: company.address || "",
    city: company.city || "",
    city_norm: normalizeCityForFilter(company.city || ""),
    region: regionSlug || "",
    phones: company.phones || [],
    emails: company.emails || [],
    websites: applyWebsiteOverride(company.source_id, company.websites || []),
    logo_url: normalizeLogoUrl(company.logo_url || ""),
    logo_rank: computeLogoRank(company),
    contact_person: company.contact_person || "",

    category_slugs: (company.categories || []).map(c => c.slug),
    category_names: (company.categories || []).map(c => c.name),
    rubric_slugs: (company.rubrics || []).map(r => r.slug),
    rubric_names: (company.rubrics || []).map(r => r.name),
    primary_category_slug: primaryCategory?.slug ?? null,
    primary_category_name: primaryCategory?.name ?? null,
    primary_rubric_slug: primaryRubric?.slug ?? null,
    primary_rubric_name: primaryRubric?.name ?? null,

    _geo: (company.extra?.lat && company.extra?.lng)
      ? { lat: company.extra.lat, lng: company.extra.lng }
      : null,

    work_hours_status: company.work_hours?.status ?? null,
    work_hours_time: company.work_hours?.work_time ?? null,

    phones_ext: company.phones_ext || [],

    keywords: generateCompanyKeywords(company, keywordOptions),
  };
}

export async function indexCompanies(jsonlPath: string): Promise<{ total: number; indexed: number }> {
  console.log(`Starting Meilisearch indexing from: ${jsonlPath}`);
  const keywordOptions = getServerKeywordGenerationOptions();

  // Configure index first
  await configureCompaniesIndex();

  const client = getMeiliClient();
  const index = client.index<MeiliCompanyDocument>(COMPANIES_INDEX);

  // Clear existing documents
  console.log("Clearing existing documents...");
  const deleteTask = await index.deleteAllDocuments();
  await client.waitForTask(deleteTask.taskUid, { timeOutMs: 60000 });

  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  const documents: MeiliCompanyDocument[] = [];
  const BATCH_SIZE = 5000;
  let total = 0;
  let indexed = 0;

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    try {
      const company = JSON.parse(raw) as BiznesinfoCompany;
      if (!company.source_id) continue;
      if (isExcludedBiznesinfoCompany(company)) continue;

      documents.push(companyToDocument(company, keywordOptions));
      total++;

      if (documents.length >= BATCH_SIZE) {
        console.log(`Indexing batch of ${documents.length} documents...`);
        const task = await index.addDocuments(documents);
        await client.waitForTask(task.taskUid, { timeOutMs: 120000 });
        indexed += documents.length;
        console.log(`Indexed ${indexed} documents so far...`);
        documents.length = 0;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Index remaining documents
  if (documents.length > 0) {
    console.log(`Indexing final batch of ${documents.length} documents...`);
    const task = await index.addDocuments(documents);
    await client.waitForTask(task.taskUid, { timeOutMs: 120000 });
    indexed += documents.length;
  }

  console.log(`Indexing complete: ${indexed}/${total} documents`);
  return { total, indexed };
}
