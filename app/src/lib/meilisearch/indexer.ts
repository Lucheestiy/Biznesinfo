import fs from "node:fs";
import { createInterface } from "node:readline";
import { getMeiliClient, COMPANIES_INDEX } from "./client";
import { configureCompaniesIndex } from "./config";
import type { MeiliCompanyDocument } from "./types";
import type { IbizCompany } from "../ibiz/types";

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

// Stop words to filter out from keywords
const STOP_WORDS = new Set([
  "и", "в", "на", "с", "по", "для", "из", "к", "от", "до", "о", "об", "при",
  "за", "под", "над", "без", "через", "между", "а", "но", "или", "либо",
  "то", "как", "что", "это", "так", "же", "бы", "ли", "не", "ни", "да", "нет",
  "все", "вся", "всё", "его", "её", "их", "ее", "другие", "другое", "прочие", "прочее",
  "оао", "ооо", "зао", "чуп", "уп", "ип", "тел", "факс", "email", "www", "http",
  "беларусь", "республика", "область", "район", "город", "минск", "брест", "гомель",
  "витебск", "гродно", "могилев", "могилёв", "улица", "проспект", "переулок",
  "компания", "предприятие", "организация", "фирма", "завод", "филиал",
  "продукция", "производство", "изготовление", "выпуск", "услуги", "работы", "деятельность",
  "продажа", "оптовая", "розничная", "торговля", "поставка", "реализация",
  "сырье", "сырьё", "вторичное", "материалы", "комплектующие",
]);

// Words that indicate product/service keywords in description
const PRODUCT_INDICATORS = [
  "производство", "выпуск", "изготовление", "продажа", "оптовая", "розничная",
  "поставка", "реализация", "торговля", "ассортимент", "продукция",
];

function extractCompanyNameTokens(companyName: string): Set<string> {
  const raw = (companyName || "").trim();
  if (!raw) return new Set();

  const tokens = raw
    .toLowerCase()
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(tokens);
}

// Extract meaningful product keywords from text
function extractProductKeywords(text: string, excludeTokens?: Set<string>): string[] {
  if (!text) return [];

  const words: string[] = [];
  const lower = text.toLowerCase();

  // Split into sentences and look for product-related phrases
  const sentences = lower.split(/[.;:!?]/);

  for (const sentence of sentences) {
    // Check if sentence contains product indicators
    const hasIndicator = PRODUCT_INDICATORS.some(ind => sentence.includes(ind));
    if (!hasIndicator) continue;

    // Extract nouns (words that likely describe products)
    const sentenceWords = sentence
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !excludeTokens?.has(w));

    words.push(...sentenceWords);
  }

  return words;
}

// Generate keywords from rubrics, categories and description
function generateKeywords(company: IbizCompany): string[] {
  const keywordsSet = new Set<string>();
  const companyNameTokens = extractCompanyNameTokens(company.name || "");

  // Extract from rubric names
  for (const rubric of company.rubrics || []) {
    const words = rubric.name
      .toLowerCase()
      .replace(/[^\wа-яё\s-]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    words.forEach(w => keywordsSet.add(w));
  }

  // Extract from category names
  for (const cat of company.categories || []) {
    const words = cat.name
      .toLowerCase()
      .replace(/[^\wа-яё\s-]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    words.forEach(w => keywordsSet.add(w));
  }

  // Extract product keywords from description
  const descKeywords = extractProductKeywords(company.description || "", companyNameTokens);
  descKeywords.forEach(w => keywordsSet.add(w));

  // Also extract from "about" field
  const aboutKeywords = extractProductKeywords(company.about || "", companyNameTokens);
  aboutKeywords.forEach(w => keywordsSet.add(w));

  return Array.from(keywordsSet);
}

function companyToDocument(company: IbizCompany): MeiliCompanyDocument {
  const regionSlug = normalizeRegionSlug(company.city, company.region, company.address);
  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;

  return {
    id: company.source_id,
    source: company.source,
    name: company.name || "",
    description: company.description || "",
    about: company.about || "",
    address: company.address || "",
    city: company.city || "",
    region: regionSlug || "",
    phones: company.phones || [],
    emails: company.emails || [],
    websites: company.websites || [],
    logo_url: normalizeLogoUrl(company.logo_url || ""),
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

    keywords: generateKeywords(company),
  };
}

export async function indexCompanies(jsonlPath: string): Promise<{ total: number; indexed: number }> {
  console.log(`Starting Meilisearch indexing from: ${jsonlPath}`);

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
      const company = JSON.parse(raw) as IbizCompany;
      if (!company.source_id) continue;

      documents.push(companyToDocument(company));
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
