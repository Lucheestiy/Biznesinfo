import fs from "node:fs";
import { createInterface } from "node:readline";
import { getMeiliClient, COMPANIES_INDEX } from "./client";
import { configureCompaniesIndex } from "./config";
import type { MeiliCompanyDocument } from "./types";
import type { BiznesinfoCompany } from "../biznesinfo/types";
import { generateCompanyKeywords } from "../biznesinfo/keywords";
import { getServerKeywordGenerationOptions } from "../biznesinfo/keywordRuntime";
import { BIZNESINFO_MAP_OVERRIDES } from "../biznesinfo/mapOverrides";
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function applyMapOverride(company: BiznesinfoCompany): BiznesinfoCompany {
  const raw = (company.source_id || "").trim();
  if (!raw) return company;
  const key = raw.toLowerCase();
  const override = BIZNESINFO_MAP_OVERRIDES[raw] ?? BIZNESINFO_MAP_OVERRIDES[key];
  if (!override) return company;

  const address = String(override.address || "").trim();
  const nextAddress = address || company.address || "";
  const currentExtra = company.extra || { lat: null, lng: null };
  const nextLat = isFiniteNumber(override.lat) ? override.lat : currentExtra.lat;
  const nextLng = isFiniteNumber(override.lng) ? override.lng : currentExtra.lng;

  return {
    ...company,
    address: nextAddress,
    extra: { lat: nextLat, lng: nextLng },
  };
}

function companyToDocument(
  company: BiznesinfoCompany,
  keywordOptions = getServerKeywordGenerationOptions(),
): MeiliCompanyDocument {
  const normalizedCompany = applyMapOverride(company);
  const regionSlug = normalizeRegionSlug(normalizedCompany.city, normalizedCompany.region, normalizedCompany.address);
  const primaryCategory = normalizedCompany.categories?.[0] ?? null;
  const primaryRubric = normalizedCompany.rubrics?.[0] ?? null;

  return {
    id: normalizedCompany.source_id,
    source: normalizedCompany.source,
    unp: normalizeBiznesinfoUnp(normalizedCompany.unp || ""),
    name: normalizedCompany.name || "",
    description: normalizedCompany.description || "",
    about: normalizedCompany.about || "",
    address: normalizedCompany.address || "",
    city: normalizedCompany.city || "",
    city_norm: normalizeCityForFilter(normalizedCompany.city || ""),
    region: regionSlug || "",
    phones: normalizedCompany.phones || [],
    emails: normalizedCompany.emails || [],
    websites: applyWebsiteOverride(normalizedCompany.source_id, normalizedCompany.websites || []),
    logo_url: normalizeLogoUrl(normalizedCompany.logo_url || ""),
    logo_rank: computeLogoRank(normalizedCompany),
    contact_person: normalizedCompany.contact_person || "",

    category_slugs: (normalizedCompany.categories || []).map(c => c.slug),
    category_names: (normalizedCompany.categories || []).map(c => c.name),
    rubric_slugs: (normalizedCompany.rubrics || []).map(r => r.slug),
    rubric_names: (normalizedCompany.rubrics || []).map(r => r.name),
    primary_category_slug: primaryCategory?.slug ?? null,
    primary_category_name: primaryCategory?.name ?? null,
    primary_rubric_slug: primaryRubric?.slug ?? null,
    primary_rubric_name: primaryRubric?.name ?? null,

    _geo: (normalizedCompany.extra?.lat && normalizedCompany.extra?.lng)
      ? { lat: normalizedCompany.extra.lat, lng: normalizedCompany.extra.lng }
      : null,

    work_hours_status: normalizedCompany.work_hours?.status ?? null,
    work_hours_time: normalizedCompany.work_hours?.work_time ?? null,

    phones_ext: normalizedCompany.phones_ext || [],

    keywords: generateCompanyKeywords(normalizedCompany, keywordOptions),
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
