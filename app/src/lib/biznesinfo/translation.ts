import type { BiznesinfoCompany, BiznesinfoCompanyResponse, BiznesinfoCompanySummary } from "./types";

export type BiznesinfoUiLanguage = "ru" | "en" | "be" | "zh";
type TranslateLanguage = Exclude<BiznesinfoUiLanguage, "ru">;

const SUPPORTED_TRANSLATION_LANGUAGES = new Set<TranslateLanguage>(["en", "be", "zh"]);
const CYRILLIC_RE = /[\u0400-\u04FF]/u;
const LATIN_RE = /[A-Za-z]/u;
const CHINESE_RE = /[\u3400-\u9FFF]/u;
const ZH_LATIN_SEGMENT_RE = /\b[A-Za-z][A-Za-z-]{2,}\b/gu;
const ZH_LEGAL_FORM_OVERRIDES: Record<string, string> = {
  LLC: "有限责任公司",
  LTD: "有限公司",
  JSC: "股份公司",
  CJSC: "封闭式股份公司",
  OJSC: "开放式股份公司",
  SOAO: "开放式股份公司",
  ODO: "额外责任公司",
  CHKUP: "私营单一企业",
};
const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const TRANSLATE_TIMEOUT_MS = 8000;
const TRANSLATE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const TRANSLATE_CHUNK_MAX_CHARS = 700;
const TRANSLATE_COMPANY_CONCURRENCY = 4;
const TRANSLATE_CHUNK_CONCURRENCY = 2;

type CacheEntry = {
  value: string;
  expiresAt: number;
};

const translateCache = new Map<string, CacheEntry>();
const inflightTranslations = new Map<string, Promise<string>>();

export function normalizeUiLanguage(raw: string | null | undefined): BiznesinfoUiLanguage {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "en" || value === "be" || value === "zh" || value === "ru") return value;
  return "ru";
}

function toTranslateLanguage(language: BiznesinfoUiLanguage): TranslateLanguage | null {
  if (SUPPORTED_TRANSLATION_LANGUAGES.has(language as TranslateLanguage)) {
    return language as TranslateLanguage;
  }
  return null;
}

function normalizeInput(raw: string): string {
  return String(raw || "").replace(/\s+/gu, " ").trim();
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  const source = normalizeInput(text);
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const parts: string[] = [];
  let rest = source;

  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(". ", maxChars);
    if (cut < Math.floor(maxChars * 0.55)) cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= 0 || cut < Math.floor(maxChars * 0.35)) cut = maxChars;
    else if (cut < maxChars) cut += 1;

    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (_item: T, _index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      out[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return out;
}

function getCache(key: string): string | null {
  const entry = translateCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    translateCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key: string, value: string): void {
  translateCache.set(key, { value, expiresAt: Date.now() + TRANSLATE_CACHE_TTL_MS });
  if (translateCache.size > 6000) {
    const now = Date.now();
    for (const [cacheKey, entry] of translateCache.entries()) {
      if (entry.expiresAt <= now) translateCache.delete(cacheKey);
      if (translateCache.size <= 5000) break;
    }
  }
}

function parseTranslatePayload(payload: unknown): string | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const parts: string[] = [];
  for (const segment of payload[0]) {
    if (!Array.isArray(segment)) continue;
    const piece = typeof segment[0] === "string" ? segment[0] : "";
    if (piece) parts.push(piece);
  }
  const joined = parts.join("").trim();
  return joined || null;
}

function shouldTranslateText(normalized: string, target: TranslateLanguage): boolean {
  if (!normalized) return false;
  if (CYRILLIC_RE.test(normalized)) return true;
  if (target === "zh" && LATIN_RE.test(normalized)) return true;
  return false;
}

async function requestTranslateChunk(
  text: string,
  target: TranslateLanguage,
  sourceLanguage: "ru" | "auto" = "ru",
): Promise<string> {
  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceLanguage,
    tl: target,
    dt: "t",
    q: text,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  try {
    const response = await fetch(`${TRANSLATE_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) return text;
    const payload: unknown = await response.json();
    return parseTranslatePayload(payload) || text;
  } catch {
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateChunkCached(text: string, target: TranslateLanguage): Promise<string> {
  const normalized = normalizeInput(text);
  if (!normalized) return "";
  if (!shouldTranslateText(normalized, target)) return normalized;

  const key = `${target}:${normalized}`;
  const cached = getCache(key);
  if (cached != null) return cached;

  const inflight = inflightTranslations.get(key);
  if (inflight) return inflight;

  const promise = requestTranslateChunk(normalized, target)
    .then((translated) => {
      const normalizedTranslated = normalizeInput(translated) || normalized;
      // Do not persist unchanged Cyrillic text as success: it is usually a timeout/fallback.
      const isUnchangedCyrillic =
        normalizedTranslated === normalized &&
        CYRILLIC_RE.test(normalized);
      if (!isUnchangedCyrillic) {
        setCache(key, normalizedTranslated);
      }
      return normalizedTranslated;
    })
    .catch(() => normalized)
    .finally(() => {
      inflightTranslations.delete(key);
    });

  inflightTranslations.set(key, promise);
  return promise;
}

async function refineZhLatinFragments(raw: string): Promise<string> {
  const normalized = normalizeInput(raw);
  if (!normalized || !LATIN_RE.test(normalized)) return normalized;

  const matches = normalized.match(ZH_LATIN_SEGMENT_RE);
  if (!matches || matches.length === 0) return normalized;

  let out = normalized;
  const seen = new Set<string>();

  for (const token of matches) {
    const value = (token || "").trim();
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const override = ZH_LEGAL_FORM_OVERRIDES[value.toUpperCase()] || "";
    let replacement = normalizeInput(override);

    if (!replacement) {
      const translated = await requestTranslateChunk(value, "zh", "auto");
      const normalizedTranslated = normalizeInput(translated);
      if (normalizedTranslated && normalizedTranslated !== value && CHINESE_RE.test(normalizedTranslated)) {
        replacement = normalizedTranslated;
      }
    }

    if (!replacement || replacement === value) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(value)}\\b`, "g");
    out = out.replace(pattern, replacement);
  }

  return normalizeInput(out);
}

async function translateText(raw: string, target: TranslateLanguage): Promise<string> {
  const normalized = normalizeInput(raw);
  if (!normalized) return "";
  if (!shouldTranslateText(normalized, target)) return normalized;

  const chunks = splitIntoChunks(normalized, TRANSLATE_CHUNK_MAX_CHARS);
  if (chunks.length === 0) return normalized;
  const translatedChunks = await mapWithConcurrency(
    chunks,
    TRANSLATE_CHUNK_CONCURRENCY,
    (chunk) => translateChunkCached(chunk, target),
  );
  const translated = normalizeInput(translatedChunks.join(" "));
  if (target !== "zh") return translated;
  return refineZhLatinFragments(translated);
}

async function translateCompanyName(raw: string, target: TranslateLanguage): Promise<string> {
  return translateText(raw, target);
}

async function translateOptionalNullableText(
  raw: string | null,
  target: TranslateLanguage,
): Promise<string | null> {
  if (raw == null) return null;
  const normalized = normalizeInput(raw);
  if (!normalized) return normalized;
  return translateText(normalized, target);
}

async function translateOptionalText(raw: string | undefined, target: TranslateLanguage): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  const normalized = normalizeInput(raw);
  if (!normalized) return normalized;
  return translateText(normalized, target);
}

async function translateCompanySummary(
  company: BiznesinfoCompanySummary,
  target: TranslateLanguage,
): Promise<BiznesinfoCompanySummary> {
  const [
    name,
    description,
    about,
    address,
    city,
    region,
    primaryCategoryName,
    primaryRubricName,
    workTime,
    breakTime,
    phonesExt,
  ] = await Promise.all([
    translateCompanyName(company.name || "", target),
    translateText(company.description || "", target),
    translateText(company.about || "", target),
    translateText(company.address || "", target),
    translateText(company.city || "", target),
    translateText(company.region || "", target),
    translateOptionalNullableText(company.primary_category_name, target),
    translateOptionalNullableText(company.primary_rubric_name, target),
    translateOptionalText(company.work_hours?.work_time, target),
    translateOptionalText(company.work_hours?.break_time, target),
    mapWithConcurrency(company.phones_ext || [], 2, async (entry) => ({
      ...entry,
      labels: await mapWithConcurrency(entry.labels || [], 2, (label) => translateText(label || "", target)),
    })),
  ]);

  const workHoursChanged =
    workTime !== company.work_hours?.work_time ||
    breakTime !== company.work_hours?.break_time;

  return {
    ...company,
    name: name || company.name,
    description,
    about,
    address,
    city,
    region,
    phones_ext: phonesExt,
    primary_category_name: primaryCategoryName,
    primary_rubric_name: primaryRubricName,
    work_hours: workHoursChanged
      ? {
        ...company.work_hours,
        work_time: workTime,
        break_time: breakTime,
      }
      : company.work_hours,
  };
}

async function translateCompanyDetails(
  company: BiznesinfoCompany,
  target: TranslateLanguage,
): Promise<BiznesinfoCompany> {
  const [
    name,
    country,
    region,
    city,
    address,
    description,
    about,
    contactPerson,
    workTime,
    breakTime,
    workStatus,
    categories,
    rubrics,
    phonesExt,
    products,
    servicesList,
    reviews,
  ] = await Promise.all([
    translateCompanyName(company.name || "", target),
    translateText(company.country || "", target),
    translateText(company.region || "", target),
    translateText(company.city || "", target),
    translateText(company.address || "", target),
    translateText(company.description || "", target),
    translateText(company.about || "", target),
    translateText(company.contact_person || "", target),
    translateOptionalText(company.work_hours?.work_time, target),
    translateOptionalText(company.work_hours?.break_time, target),
    translateOptionalText(company.work_hours?.status, target),
    mapWithConcurrency(company.categories || [], 3, async (entry) => ({
      ...entry,
      name: await translateText(entry.name || "", target),
    })),
    mapWithConcurrency(company.rubrics || [], 3, async (entry) => ({
      ...entry,
      name: await translateText(entry.name || "", target),
      category_name: await translateText(entry.category_name || "", target),
    })),
    mapWithConcurrency(company.phones_ext || [], 2, async (entry) => ({
      ...entry,
      labels: await mapWithConcurrency(entry.labels || [], 2, (label) => translateText(label || "", target)),
    })),
    company.products
      ? mapWithConcurrency(company.products, 3, async (entry) => ({
        ...entry,
        name: await translateText(entry.name || "", target),
        description: entry.description ? await translateText(entry.description, target) : entry.description,
      }))
      : Promise.resolve(undefined),
    company.services_list
      ? mapWithConcurrency(company.services_list, 3, async (entry) => ({
        ...entry,
        name: await translateText(entry.name || "", target),
        description: entry.description ? await translateText(entry.description, target) : entry.description,
      }))
      : Promise.resolve(undefined),
    company.reviews
      ? mapWithConcurrency(company.reviews, 3, async (entry) => ({
        ...entry,
        text: await translateText(entry.text || "", target),
      }))
      : Promise.resolve(undefined),
  ]);

  return {
    ...company,
    name: name || company.name,
    country,
    region,
    city,
    address,
    description,
    about,
    contact_person: contactPerson,
    work_hours: {
      ...company.work_hours,
      work_time: workTime,
      break_time: breakTime,
      status: workStatus,
    },
    categories,
    rubrics,
    phones_ext: phonesExt,
    products,
    services_list: servicesList,
    reviews,
  };
}

export async function localizeCompanySummaries(
  companies: BiznesinfoCompanySummary[],
  language: BiznesinfoUiLanguage,
): Promise<BiznesinfoCompanySummary[]> {
  if (!Array.isArray(companies) || companies.length === 0) return companies;
  const target = toTranslateLanguage(language);
  if (!target) return companies;
  return mapWithConcurrency(companies, TRANSLATE_COMPANY_CONCURRENCY, (company) =>
    translateCompanySummary(company, target),
  );
}

export async function localizeCompanyResponse(
  data: BiznesinfoCompanyResponse,
  language: BiznesinfoUiLanguage,
): Promise<BiznesinfoCompanyResponse> {
  const target = toTranslateLanguage(language);
  if (!target) return data;

  const [company, generatedKeywords] = await Promise.all([
    translateCompanyDetails(data.company, target),
    data.generated_keywords
      ? mapWithConcurrency(data.generated_keywords, 3, (keyword) => translateText(keyword || "", target))
      : Promise.resolve(undefined),
  ]);

  return {
    ...data,
    company,
    generated_keywords: generatedKeywords,
  };
}

export async function localizeTextByUiLanguage(
  raw: string,
  language: BiznesinfoUiLanguage,
): Promise<string> {
  const normalized = normalizeInput(raw);
  if (!normalized) return normalized;
  const target = toTranslateLanguage(language);
  if (!target) return normalized;
  return translateText(normalized, target);
}
