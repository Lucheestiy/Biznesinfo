import { getCompaniesIndex, isMeiliHealthy } from "./client";
import type { MeiliCompanyDocument, MeiliSearchParams } from "./types";

import type {
  BiznesinfoCompanySummary,
  BiznesinfoSearchResponse,
  BiznesinfoSuggestResponse,
} from "../biznesinfo/types";
import {
  biznesinfoCountCompaniesByLocation,
  biznesinfoGetCompaniesSummaryByIds,
  biznesinfoGetSearchItemsByIds,
  type BiznesinfoSearchItem,
} from "../biznesinfo/postgres";
import { companySlugForUrl } from "../biznesinfo/slug";
import {
  buildSemanticExpansionQuery,
  canonicalizeSemanticTokens,
  semanticOverlapScore,
  tokenizeSemanticText,
} from "../search/semantic";
import {
  buildCompanySuggestSubtitle,
  isAddressLikeLocationQuery,
  normalizeLocationQueryForSearch,
} from "../utils/location";

type BiznesinfoSearchFlowResponse = BiznesinfoSearchResponse & {
  items: BiznesinfoCompanySummary[];
  page: number;
  limit: number;
};

type SearchSupplyType = "any" | "delivery" | "pickup";
type SearchBusinessFormat = "any" | "b2b" | "b2c";
type SearchSupplyFacetValue = Exclude<SearchSupplyType, "any">;
type SearchBusinessFacetValue = Exclude<SearchBusinessFormat, "any">;
type SearchRankingVariant = "control" | "treatment";

type SearchAbResolution = {
  enabled: boolean;
  variant: SearchRankingVariant;
  splitPercent: number;
  bucket: number;
  forced: boolean;
  seedHash: string;
};

type SearchRerankExplainItem = {
  id: string;
  name: string;
  rankBefore: number;
  rankAfter: number;
  score: number;
  reasons: string[];
  signals: {
    business: number;
    quality: number;
    freshness: number;
    geo: number;
    rankPrior: number;
    penalty: number;
    structuredOverlap: number;
    descriptionScore: number;
  };
};

const DB_TARGET_MS = 50;
const MEILI_TARGET_MS = 100;
const POST_FILTER_FETCH_MULTIPLIER = 6;
const POST_FILTER_FETCH_MAX = 200;
// For commodity-like queries we need a wider retrieval window, otherwise
// strict relevance guards can under-sample candidates on page size=10.
const COMMODITY_POST_FILTER_FETCH_FLOOR = 200;
const HYBRID_FETCH_MAX = 280;
const HYBRID_RRF_K = 50;
const COMMODITY_MIN_STRUCTURED_SCORE_SINGLE = 16;
const COMMODITY_MIN_STRUCTURED_SCORE_MULTI = 18;
const COMMODITY_MIN_SUMMARY_SCORE_SINGLE = 8;
const COMMODITY_MIN_SUMMARY_SCORE_MULTI = 12;
const PRODUCT_QUERY_TOKEN_RE =
  /(^|[^\p{L}\p{N}])(молок\p{L}*|сыр\p{L}*|рыб\p{L}*|хлеб\p{L}*|сахар\p{L}*|лук\p{L}*|мяс\p{L}*|овощ\p{L}*|фрукт\p{L}*|картоф\p{L}*|круп\p{L}*|мук\p{L}*|яйц\p{L}*|масл\p{L}*|бакале\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const SERVICE_QUERY_CUE_RE =
  /(^|[^\p{L}\p{N}])(услуг\p{L}*|сервис\p{L}*|ремонт\p{L}*|монтаж\p{L}*|установ\p{L}*|разработ\p{L}*|маркет\p{L}*|реклам\p{L}*|дизайн\p{L}*|smm|seo|консалт\p{L}*|аудит\p{L}*|обучен\p{L}*|курс\p{L}*|тур\p{L}*|гостиниц\p{L}*|отел\p{L}*|кафе|ресторан\p{L}*|парикмах\p{L}*|перевоз\p{L}*|логист\p{L}*|аренд\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const NON_PRODUCT_MEDIA_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(реклам\p{L}*|сми|маркет\p{L}*|бренд\p{L}*|полиграф\p{L}*|типограф\p{L}*|дизайн\p{L}*|креатив\p{L}*|медиа\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const NON_PRODUCT_INDUSTRIAL_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(сад\p{L}*|инвентар\p{L}*|бензопил\p{L}*|газонокос\p{L}*|мотоблок\p{L}*|триммер\p{L}*|кусторез\p{L}*|строит\p{L}*|бетон\p{L}*|кирпич\p{L}*|металлопрокат\p{L}*|металл\p{L}*|металлообработ\p{L}*|арматур\p{L}*|сварк\p{L}*|электроинструмент\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const NON_FOOD_PACKAGING_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(тара\p{L}*|упаков\p{L}*|полимер\p{L}*|пластик\p{L}*|полиэтилен\p{L}*|пленк\p{L}*|контейнер\p{L}*|канистр\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const RAW_MATERIAL_TOKEN_RE = /(^|[^\p{L}\p{N}])(сырь\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const CHEMICAL_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(хими\p{L}*|энергетик\p{L}*|нефт\p{L}*|полимер\p{L}*|пластмасс\p{L}*|растворител\p{L}*|лакокрас\p{L}*|сырь\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const FOOD_CHEESE_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(пищев\p{L}*|молоч\p{L}*|продукт\p{L}*\s+питан|сыр(?!ь)\p{L}*|продовольств\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const FOOD_COMMODITY_TOKEN_RE =
  /^(молок\p{L}*|молоч\p{L}*|сыр\p{L}*|рыб\p{L}*|хлеб\p{L}*|сахар\p{L}*|зелен\p{L}*|овощ\p{L}*|фрукт\p{L}*|мяс\p{L}*|яйц\p{L}*|круп\p{L}*|мук\p{L}*|масл\p{L}*|бакале\p{L}*|напит\p{L}*)$/iu;
const FOOD_LARD_TOKEN_RE = /^(сало|сала|салу|салом|сале|сальц\p{L}*|шпик\p{L}*)$/iu;
const FOOD_PRODUCT_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(пищ\p{L}*|продукт\p{L}*|продоволь\p{L}*|бакале\p{L}*|агро\p{L}*|ферм\p{L}*|молоч\p{L}*|мяс\p{L}*|рыб\p{L}*|сахар\p{L}*|хлеб\p{L}*|овощ\p{L}*|фрукт\p{L}*|зерн\p{L}*|круп\p{L}*|мук\p{L}*|масл\p{L}*|напит\p{L}*|кондитер\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const FOOD_SUPPLY_CHAIN_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(опт\p{L}*|оптов\p{L}*|постав\p{L}*|торгов\p{L}*|дистриб\p{L}*|закуп\p{L}*|склад\p{L}*|комбинат\p{L}*|производ\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const PROCUREMENT_CUE_RE =
  /(^|[^\p{L}\p{N}])(купить|где|взять|поставщик\p{L}*|поставка\p{L}*|опт\p{L}*|заказать\p{L}*|закуп\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const FOOD_MILK_CATEGORY_RE =
  /(^|[^\p{L}\p{N}])(молоч\p{L}*|пищев\p{L}*|продукт\p{L}*\s+питан|молок\p{L}*|сыродель\p{L}*|молочно-консерв\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const PRODUCE_FRUIT_ITEM_TOKEN_RE =
  /^(груш\p{L}*|яблок\p{L}*|банан\p{L}*|цитрус\p{L}*|апельсин\p{L}*|мандарин\p{L}*|лимон\p{L}*|киви|персик\p{L}*|абрикос\p{L}*|слив\p{L}*|виноград\p{L}*|черешн\p{L}*|вишн\p{L}*|ягод\p{L}*|клубник\p{L}*|малин\p{L}*|голубик\p{L}*|ежевик\p{L}*|смородин\p{L}*)$/iu;
const PRODUCE_VEGETABLE_ITEM_TOKEN_RE =
  /^(лук\p{L}*|картоф\p{L}*|морков\p{L}*|капуст\p{L}*|свекл\p{L}*|огур\p{L}*|томат\p{L}*|помидор\p{L}*|перец\p{L}*|баклаж\p{L}*|кабач\p{L}*|тыкв\p{L}*|чеснок\p{L}*|редис\p{L}*|салат\p{L}*|зел[её]н\p{L}*)$/iu;
const COMMODITY_DOMAIN_DISTRACTOR_RE =
  /(^|[^\p{L}\p{N}])(спорт\p{L}*|красот\p{L}*|салон\p{L}*|туризм\p{L}*|досуг\p{L}*|сауна\p{L}*|образован\p{L}*|медицин\p{L}*|авто\p{L}*|строит\p{L}*|недвижим\p{L}*|финанс\p{L}*|юрид\p{L}*|реклам\p{L}*|полиграф\p{L}*|машиностро\p{L}*|оборудован\p{L}*|станк\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const FOOD_EQUIPMENT_DISTRACTOR_RE =
  /(^|[^\p{L}\p{N}])(оборудован\p{L}*|станк\p{L}*|техник\p{L}*|машин\p{L}*|аппарат\p{L}*|линия|агрегат\p{L}*|инструмент\p{L}*|запчаст\p{L}*|монтаж\p{L}*|сервис\p{L}*|ремонт\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const EQUIPMENT_QUERY_CUE_RE =
  /(^|[^\p{L}\p{N}])(оборудован\p{L}*|станк\p{L}*|техник\p{L}*|машин\p{L}*|аппарат\p{L}*|линия|агрегат\p{L}*|арматур\p{L}*|фитинг\p{L}*|клапан\p{L}*|трубопровод\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const PACKAGING_QUERY_CUE_RE =
  /(^|[^\p{L}\p{N}])(тара\p{L}*|упаков\p{L}*|пленк\p{L}*|полимер\p{L}*|пластик\p{L}*|полиэтилен\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const COMMODITY_CANONICAL_TOKENS = new Set<string>([
  "молочная",
  "сыр",
  "рыба",
  "хлеб",
]);
const COMMODITY_ENTITY_TOKEN_RE = /^(комбинат|завод|фабрик\p{L}*|ферма|агрокомбинат\p{L}*)$/iu;
const EMPTY_LOGO_HINTS = [
  "/images/logo/no-logo",
  "/images/logo/no_logo",
  "/images/logo/noimage",
  "/images/logo/no-image",
];
const COMPANY_NAME_QUERY_STOP_TOKENS = new Set<string>([
  "ооо",
  "оао",
  "зао",
  "ао",
  "одо",
  "сооо",
  "ип",
  "чуп",
  "уп",
  "пуп",
  "куп",
  "руп",
  "филиал",
  "компания",
  "компании",
  "предприятие",
  "предприятия",
  "группа",
  "центр",
  "сервис",
]);
const HYBRID_BUSINESS_ATTRIBUTES = [
  "serviceTitles",
  "serviceCategories",
  "serviceTokens",
  "servicesText",
  "keywords",
  "categoryNames",
  "category_names",
  "rubric_names",
  "categoryTokens",
  "domainTags",
  "name",
  "normalizedName",
];
const HYBRID_DESCRIPTION_BACKFILL_ATTRIBUTES = ["description", "about"];
const SUPPLY_DELIVERY_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(достав\p{L}*|логист\p{L}*|courier|delivery|last[-\s]?mile|грузоперевоз\p{L}*|перевоз\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const SUPPLY_PICKUP_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(самовывоз|сам\s*вывоз|пункт\p{L}*\s+выдач\p{L}*|склад\p{L}*|склада|pickup)(?=$|[^\p{L}\p{N}])/iu;
const BUSINESS_B2B_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(опт\p{L}*|оптов\p{L}*|постав\p{L}*|дистриб\p{L}*|производ\p{L}*|b2b|horeca|для\s+бизнес\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const BUSINESS_B2C_SIGNAL_RE =
  /(^|[^\p{L}\p{N}])(розниц\p{L}*|магазин\p{L}*|интернет[-\s]?магазин\p{L}*|витрин\p{L}*|для\s+дом\p{L}*|для\s+себя|b2c|retail)(?=$|[^\p{L}\p{N}])/iu;

type HybridRetrievalPlan = {
  key: string;
  query: string;
  weight: number;
  attributesToSearchOn?: string[];
};

type HybridRetrievalPlanResult = {
  plan: HybridRetrievalPlan;
  hits: MeiliCompanyDocument[];
  estimatedTotalHits: number;
};

function shouldLogSearchPerf(): boolean {
  return String(process.env.BIZNESINFO_SEARCH_PERF_LOG || "").trim() === "1";
}

function shouldLogSearchExplainability(): boolean {
  return String(process.env.BIZNESINFO_SEARCH_EXPLAIN_LOG || "").trim() === "1";
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function hashStringFNV1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveSearchAbResolution(params: MeiliSearchParams, queryText: string): SearchAbResolution {
  const enabled = String(process.env.BIZNESINFO_SEARCH_AB_ENABLED || "1").trim() !== "0";
  const splitRaw = Number.parseInt(String(process.env.BIZNESINFO_SEARCH_AB_TREATMENT_PERCENT || "50"), 10);
  const splitPercent = Number.isFinite(splitRaw)
    ? Math.max(0, Math.min(100, Math.trunc(splitRaw)))
    : 50;

  const forcedVariant = params.abVariant === "control" || params.abVariant === "treatment"
    ? params.abVariant
    : null;
  const seedSource = normalizeText(params.abSeed || "") || [
    normalizeText(queryText),
    normalizeText(params.city || ""),
    normalizeText(params.region || ""),
  ].filter(Boolean).join("|");
  const hash = hashStringFNV1a(seedSource || "biznesinfo-search");
  const bucket = hash % 100;
  const derivedVariant: SearchRankingVariant = bucket < splitPercent ? "treatment" : "control";
  const variant = forcedVariant || (enabled ? derivedVariant : "control");

  return {
    enabled,
    variant,
    splitPercent,
    bucket,
    forced: Boolean(forcedVariant),
    seedHash: hash.toString(16).padStart(8, "0"),
  };
}

function composeSearchQuery(params: MeiliSearchParams): string {
  const parts: string[] = [];
  const q = normalizeText(params.query || "");
  const service = normalizeText(params.service || "");
  const keywords = normalizeText(params.keywords || "");

  if (q) parts.push(q);
  if (service) parts.push(service);
  if (keywords) parts.push(keywords);

  return parts.join(" ").trim();
}

function buildProductQueryText(params: MeiliSearchParams): string {
  const service = normalizeText(params.service || "");
  const keywords = normalizeText(params.keywords || "");
  return [service, keywords].filter(Boolean).join(" ").trim();
}

function isCompanyNameOnlyQuery(params: MeiliSearchParams): boolean {
  const query = normalizeText(params.query || "");
  const service = normalizeText(params.service || "");
  const keywords = normalizeText(params.keywords || "");
  return Boolean(query) && !service && !keywords;
}

function buildCompanyNameQueryTokens(raw: string): string[] {
  if (!raw) return [];
  return canonicalizeSemanticTokens(
    tokenizeSemanticText(raw)
      .filter((token) => token.length >= 2)
      .filter((token) => !COMPANY_NAME_QUERY_STOP_TOKENS.has(token)),
  );
}

function expandProduceFamilyQueryTokens(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens;
  const expanded = [...tokens];
  for (const token of tokens) {
    if (PRODUCE_FRUIT_ITEM_TOKEN_RE.test(token)) expanded.push("фрукт");
    if (PRODUCE_VEGETABLE_ITEM_TOKEN_RE.test(token)) expanded.push("овощ");
  }
  return canonicalizeSemanticTokens(expanded);
}

function buildProductQueryTokens(raw: string): string[] {
  if (!raw) return [];
  const tokens = canonicalizeSemanticTokens(
    tokenizeSemanticText(raw).filter((token) => token.length >= 2),
  );
  return expandProduceFamilyQueryTokens(tokens);
}

function buildHybridProductQuery(raw: string): string {
  if (!raw) return "";
  const baseTokens = canonicalizeSemanticTokens(
    tokenizeSemanticText(raw).filter((token) => token.length >= 2),
  );
  const expandedTokens = buildProductQueryTokens(raw);
  const missing = expandedTokens.filter((token) => !baseTokens.includes(token));
  if (missing.length === 0) return raw;
  return `${raw} ${missing.join(" ")}`.trim();
}

function looksLikeCommodityIntent(raw: string, tokens: string[]): boolean {
  if (!raw) return false;
  if (PRODUCT_QUERY_TOKEN_RE.test(raw)) return true;
  if (tokens.some((token) => COMMODITY_CANONICAL_TOKENS.has(token))) return true;
  if (SERVICE_QUERY_CUE_RE.test(raw)) return false;
  return tokenizeSemanticText(raw).length <= 3;
}

function looksLikeFoodCommodityIntent(raw: string, tokens: string[]): boolean {
  if (!raw) return false;
  if (tokens.some((token) => isFoodCommodityIntentToken(token))) return true;
  return FOOD_PRODUCT_SIGNAL_RE.test(raw);
}

function isFoodCommodityIntentToken(raw: string): boolean {
  const token = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!token) return false;
  if (FOOD_COMMODITY_TOKEN_RE.test(token)) return true;
  return FOOD_LARD_TOKEN_RE.test(token);
}

function isStrictFoodCommodityIntentToken(raw: string): boolean {
  const token = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!token) return false;
  return FOOD_LARD_TOKEN_RE.test(token);
}

function resolveCommodityStructuredMinScore(queryTokens: string[]): number {
  return queryTokens.length <= 1
    ? COMMODITY_MIN_STRUCTURED_SCORE_SINGLE
    : COMMODITY_MIN_STRUCTURED_SCORE_MULTI;
}

function resolveCommoditySummaryMinScore(queryTokens: string[]): number {
  return queryTokens.length <= 1
    ? COMMODITY_MIN_SUMMARY_SCORE_SINGLE
    : COMMODITY_MIN_SUMMARY_SCORE_MULTI;
}

function isCheeseIntentToken(raw: string): boolean {
  const token = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!token) return false;
  if (!token.startsWith("сыр")) return false;
  if (token.startsWith("сырь")) return false; // сырье / сырьевой
  if (/^сыр(о|ой|ая|ое|ые|ого|ому|ым|ых|ую)$/u.test(token)) return false; // сырой / сырые ...
  if (token.startsWith("сырост")) return false; // сырость
  if (token.startsWith("сырокопч")) return false; // сырокопченый
  if (token.startsWith("сыровялен") || token.startsWith("сыровял")) return false; // сыровяленый
  return true;
}

function looksLikeCheeseCommodityIntent(raw: string): boolean {
  const tokens = tokenizeSemanticText(raw);
  return tokens.some((token) => isCheeseIntentToken(token));
}

function isFoodCategoryContext(raw: string): boolean {
  if (!raw) return false;
  return (
    FOOD_PRODUCT_SIGNAL_RE.test(raw) ||
    FOOD_CHEESE_CATEGORY_RE.test(raw) ||
    FOOD_MILK_CATEGORY_RE.test(raw)
  );
}

function parsePagination(params: MeiliSearchParams): { page: number; limit: number; offset: number } {
  const rawLimit = Number.isFinite(params.limit) ? Number(params.limit) : 24;
  const limit = Math.max(1, Math.min(200, Math.trunc(rawLimit)));

  const pageFromParams = Number.isFinite(params.page) ? Number(params.page) : null;
  if (pageFromParams && pageFromParams >= 1) {
    const page = Math.trunc(pageFromParams);
    return {
      page,
      limit,
      offset: (page - 1) * limit,
    };
  }

  const offsetFromParams = Number.isFinite(params.offset) ? Number(params.offset) : 0;
  const offset = Math.max(0, Math.trunc(offsetFromParams));
  const page = Math.floor(offset / limit) + 1;
  return { page, limit, offset };
}

function buildSearchFilter(params: MeiliSearchParams): string[] {
  const filter: string[] = [];
  const region = normalizeText(params.region || "");
  const city = normalizeText(params.city || "");

  if (region) {
    const safeRegion = region.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    filter.push(`region = "${safeRegion}"`);
  }
  if (city) {
    const safeCity = city.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    filter.push(`city = "${safeCity}"`);
  }

  return filter;
}

function hasCompanyLogo(logoUrl: string): boolean {
  const normalized = normalizeText(logoUrl).toLowerCase();
  if (!normalized) return false;
  return !EMPTY_LOGO_HINTS.some((hint) => normalized.includes(hint));
}

function prioritizeCompaniesWithLogos(companies: BiznesinfoCompanySummary[]): BiznesinfoCompanySummary[] {
  const ranked = (companies || []).map((company, index) => ({
    company,
    index,
    hasLogo: hasCompanyLogo(company.logo_url || ""),
  }));

  ranked.sort((a, b) => {
    if (a.hasLogo !== b.hasLogo) return a.hasLogo ? -1 : 1;
    return a.index - b.index;
  });

  return ranked.map((item) => item.company);
}

function buildSort(params: MeiliSearchParams): string[] {
  const lat = Number(params.lat);
  const lng = Number(params.lng);

  const sort: string[] = [];
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    sort.push(`_geoPoint(${lat}, ${lng}):asc`);
  }
  sort.push("logo_rank:desc");
  sort.push("createdAt:desc");
  return sort;
}

function normalizeSupplyType(raw: unknown): SearchSupplyType {
  const value = normalizeText(String(raw || "")).toLowerCase();
  if (value === "delivery") return "delivery";
  if (value === "pickup") return "pickup";
  return "any";
}

function normalizeBusinessFormat(raw: unknown): SearchBusinessFormat {
  const value = normalizeText(String(raw || "")).toLowerCase();
  if (value === "b2b") return "b2b";
  if (value === "b2c") return "b2c";
  return "any";
}

function buildCompanyFacetContextText(company: BiznesinfoCompanySummary): string {
  return normalizeText([
    company.name || "",
    company.description || "",
    company.about || "",
    company.primary_category_name || "",
    company.primary_rubric_name || "",
  ].join(" "));
}

function inferCompanySupplyTypes(company: BiznesinfoCompanySummary): Set<SearchSupplyFacetValue> {
  const context = buildCompanyFacetContextText(company);
  const out = new Set<SearchSupplyFacetValue>();
  if (SUPPLY_DELIVERY_SIGNAL_RE.test(context)) out.add("delivery");
  if (SUPPLY_PICKUP_SIGNAL_RE.test(context)) out.add("pickup");
  return out;
}

function inferCompanyBusinessFormats(company: BiznesinfoCompanySummary): Set<SearchBusinessFacetValue> {
  const context = buildCompanyFacetContextText(company);
  const out = new Set<SearchBusinessFacetValue>();
  if (BUSINESS_B2B_SIGNAL_RE.test(context)) out.add("b2b");
  if (BUSINESS_B2C_SIGNAL_RE.test(context)) out.add("b2c");
  return out;
}

function applyUxCompanyFilters(
  companies: BiznesinfoCompanySummary[],
  options: {
    supplyType: SearchSupplyType;
    businessFormat: SearchBusinessFormat;
  },
): BiznesinfoCompanySummary[] {
  const { supplyType, businessFormat } = options;
  if (supplyType === "any" && businessFormat === "any") return companies;

  return companies.filter((company) => {
    if (supplyType !== "any") {
      const supply = inferCompanySupplyTypes(company);
      if (!supply.has(supplyType)) return false;
    }
    if (businessFormat !== "any") {
      const format = inferCompanyBusinessFormats(company);
      if (!format.has(businessFormat)) return false;
    }
    return true;
  });
}

function buildUxFacets(companies: BiznesinfoCompanySummary[]): NonNullable<BiznesinfoSearchFlowResponse["facets"]> {
  const regionCount = new Map<string, number>();
  let deliveryCount = 0;
  let pickupCount = 0;
  let b2bCount = 0;
  let b2cCount = 0;

  for (const company of companies) {
    const region = normalizeText(company.region || "");
    if (region) regionCount.set(region, (regionCount.get(region) || 0) + 1);

    const supply = inferCompanySupplyTypes(company);
    if (supply.has("delivery")) deliveryCount += 1;
    if (supply.has("pickup")) pickupCount += 1;

    const format = inferCompanyBusinessFormats(company);
    if (format.has("b2b")) b2bCount += 1;
    if (format.has("b2c")) b2cCount += 1;
  }

  const regions = Array.from(regionCount.entries())
    .map(([value, count]) => ({
      value,
      label: value,
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "ru");
    })
    .slice(0, 12);

  return {
    regions,
    supply_types: [
      { value: "delivery", label: "Доставка", count: deliveryCount },
      { value: "pickup", label: "Самовывоз", count: pickupCount },
    ],
    business_formats: [
      { value: "b2b", label: "B2B", count: b2bCount },
      { value: "b2c", label: "B2C", count: b2cCount },
    ],
  };
}

function buildCloseQueryVariants(raw: string): string[] {
  const text = normalizeText(raw);
  if (!text) return [];

  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const key = normalized.toLowerCase().replace(/ё/gu, "е");
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(normalized);
  };

  const expanded = buildSemanticExpansionQuery(text, {
    maxTokens: 10,
    maxPerToken: 5,
  });
  if (expanded && expanded !== text) push(expanded);

  const baseTokens = canonicalizeSemanticTokens(
    tokenizeSemanticText(text).filter((token) => token.length >= 2),
  );
  if (baseTokens.length >= 2) push(baseTokens.slice(0, baseTokens.length - 1).join(" "));

  return variants.slice(0, 3);
}

function buildZeroResultsPayload(params: {
  filteredCompanies: BiznesinfoCompanySummary[];
  baseCompanies: BiznesinfoCompanySummary[];
  queryText: string;
  queryFieldValue: string;
  serviceFieldValue: string;
  city: string;
  region: string;
  supplyType: SearchSupplyType;
  businessFormat: SearchBusinessFormat;
}): BiznesinfoSearchFlowResponse["zero_results"] {
  if (params.filteredCompanies.length > 0) return undefined;

  const closeVariants: NonNullable<BiznesinfoSearchFlowResponse["zero_results"]>["close_variants"] = [];
  const seen = new Set<string>();
  const addVariant = (
    label: string,
    patch: NonNullable<BiznesinfoSearchFlowResponse["zero_results"]>["close_variants"][number]["params"],
  ) => {
    const key = `${label}::${JSON.stringify(patch)}`;
    if (seen.has(key)) return;
    seen.add(key);
    closeVariants.push({ label, params: patch });
  };

  if (params.supplyType !== "any") {
    addVariant("Снять фильтр по типу поставки", { supply_type: "any" });
  }
  if (params.businessFormat !== "any") {
    addVariant("Снять фильтр B2B/B2C", { business_format: "any" });
  }
  if (params.city) {
    addVariant(`Искать без города «${params.city}»`, { city: "" });
  }
  if (params.region && !params.city) {
    addVariant("Искать во всех регионах", { region: "" });
  }

  for (const variant of buildCloseQueryVariants(params.queryText)) {
    if (params.serviceFieldValue) addVariant(`Попробовать: «${variant}»`, { service: variant });
    else if (params.queryFieldValue) addVariant(`Попробовать: «${variant}»`, { q: variant });
  }

  const strictFiltersActive =
    params.supplyType !== "any" ||
    params.businessFormat !== "any" ||
    Boolean(params.city) ||
    Boolean(params.region);
  const hasBaseMatches = params.baseCompanies.length > 0;
  const reason =
    strictFiltersActive && hasBaseMatches
      ? "filters_too_strict"
      : "no_matches";
  const message = reason === "filters_too_strict"
    ? "По текущим фильтрам совпадений нет. Ниже — близкие варианты, чтобы не терять релевантные компании."
    : "Точных совпадений не найдено. Ниже — близкие варианты запроса и снятия ограничений.";

  return {
    reason,
    message,
    close_variants: closeVariants.slice(0, 6),
    sample_companies: params.baseCompanies.slice(0, 5),
  };
}

function isHybridSearchEnabled(): boolean {
  return String(process.env.BIZNESINFO_HYBRID_SEARCH || "1").trim() !== "0";
}

function addHybridPlan(
  plans: HybridRetrievalPlan[],
  seen: Set<string>,
  plan: HybridRetrievalPlan,
): void {
  const query = normalizeText(plan.query);
  if (!query && plan.key !== "fallback-empty") return;
  const key = `${plan.key}::${query}::${(plan.attributesToSearchOn || []).join("|")}`;
  if (seen.has(key)) return;
  seen.add(key);
  plans.push({
    ...plan,
    query,
    weight: Number.isFinite(plan.weight) ? plan.weight : 1,
  });
}

function buildHybridRetrievalPlans(params: {
  query: string;
  productQuery: string;
  companyNameOnlyQuery: boolean;
}): HybridRetrievalPlan[] {
  const query = normalizeText(params.query);
  const productQuery = normalizeText(params.productQuery);
  const companyNameOnlyQuery = Boolean(params.companyNameOnlyQuery);

  const plans: HybridRetrievalPlan[] = [];
  const seen = new Set<string>();

  if (companyNameOnlyQuery) {
    addHybridPlan(plans, seen, {
      key: "name-exact",
      query,
      weight: 1.4,
      attributesToSearchOn: ["name", "normalizedName", "nameTokens"],
    });
    addHybridPlan(plans, seen, {
      key: "name-lexical",
      query,
      weight: 0.9,
      attributesToSearchOn: ["name", "description", "categoryNames", "keywords"],
    });
  } else if (productQuery) {
    addHybridPlan(plans, seen, {
      key: "service-exact",
      query: productQuery,
      weight: 1.35,
      attributesToSearchOn: HYBRID_BUSINESS_ATTRIBUTES,
    });
    const expanded = buildSemanticExpansionQuery(productQuery, {
      maxTokens: 12,
      maxPerToken: 6,
    });
    addHybridPlan(plans, seen, {
      key: "service-expanded",
      query: expanded,
      weight: 0.95,
      attributesToSearchOn: HYBRID_BUSINESS_ATTRIBUTES,
    });
    addHybridPlan(plans, seen, {
      key: "rubric-focus",
      query: productQuery,
      weight: 0.85,
      attributesToSearchOn: ["categoryNames", "category_names", "rubric_names", "domainTags"],
    });
    addHybridPlan(plans, seen, {
      key: "lexical-main",
      query,
      weight: 1.0,
      attributesToSearchOn: HYBRID_BUSINESS_ATTRIBUTES,
    });
    addHybridPlan(plans, seen, {
      key: "description-backfill",
      query: productQuery,
      weight: 0.28,
      attributesToSearchOn: HYBRID_DESCRIPTION_BACKFILL_ATTRIBUTES,
    });
  } else {
    addHybridPlan(plans, seen, {
      key: "lexical-main",
      query,
      weight: 1.0,
    });
    const expanded = buildSemanticExpansionQuery(query, {
      maxTokens: 10,
      maxPerToken: 5,
    });
    addHybridPlan(plans, seen, {
      key: "semantic-expanded",
      query: expanded,
      weight: 0.8,
    });
  }

  if (plans.length === 0) {
    plans.push({
      key: "fallback-empty",
      query: "",
      weight: 1,
    });
  }

  return plans;
}

function fuseHybridPlanResults(
  planResults: HybridRetrievalPlanResult[],
  maxHits: number,
): {
  hits: MeiliCompanyDocument[];
  estimatedTotalHits: number;
} {
  const scoreById = new Map<string, number>();
  const bestRankById = new Map<string, number>();
  const hitById = new Map<string, MeiliCompanyDocument>();
  let estimatedTotalHits = 0;

  for (const planResult of planResults) {
    estimatedTotalHits = Math.max(estimatedTotalHits, Number(planResult.estimatedTotalHits || 0));
    const planWeight = Number.isFinite(planResult.plan.weight) ? planResult.plan.weight : 1;
    for (let index = 0; index < planResult.hits.length; index += 1) {
      const hit = planResult.hits[index];
      const id = normalizeText(hit.id || "");
      if (!id) continue;

      hitById.set(id, hit);
      const rank = index + 1;
      const contribution = planWeight / (HYBRID_RRF_K + rank);
      scoreById.set(id, (scoreById.get(id) || 0) + contribution);

      const prevBestRank = bestRankById.get(id);
      if (!prevBestRank || rank < prevBestRank) {
        bestRankById.set(id, rank);
      }
    }
  }

  const rankedIds = Array.from(scoreById.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const leftRank = bestRankById.get(a[0]) || Number.MAX_SAFE_INTEGER;
      const rightRank = bestRankById.get(b[0]) || Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return a[0].localeCompare(b[0], "ru");
    })
    .slice(0, Math.max(1, maxHits))
    .map(([id]) => id);

  const hits = rankedIds
    .map((id) => hitById.get(id))
    .filter((hit): hit is MeiliCompanyDocument => Boolean(hit));

  return {
    hits,
    estimatedTotalHits: Math.max(estimatedTotalHits, hits.length),
  };
}

function hydrateCompaniesInOrder(ids: string[], items: BiznesinfoCompanySummary[]): BiznesinfoCompanySummary[] {
  const byId = new Map<string, BiznesinfoCompanySummary>();
  for (const item of items) {
    byId.set(item.id, item);
  }

  const out: BiznesinfoCompanySummary[] = [];
  for (const id of ids) {
    const company = byId.get(id);
    if (company) out.push(company);
  }
  return out;
}

function overlapCount(tokens: string[], queryTokens: string[]): number {
  if (tokens.length === 0 || queryTokens.length === 0) return 0;
  const tokenSet = new Set(tokens);
  let count = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    if (tokenSet.has(token)) {
      count += 1;
      continue;
    }
    if (tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) {
      count += 1;
    }
  }
  return count;
}

function overlapCountBounded(
  tokens: string[],
  queryTokens: string[],
  maxSuffixChars: number,
): number {
  if (tokens.length === 0 || queryTokens.length === 0) return 0;
  const tokenSet = new Set(tokens);
  let count = 0;

  for (const token of queryTokens) {
    if (!token) continue;
    if (tokenSet.has(token)) {
      count += 1;
      continue;
    }
    if (tokens.some((candidate) => {
      if (candidate.startsWith(token)) {
        return candidate.length - token.length <= maxSuffixChars;
      }
      if (token.startsWith(candidate)) {
        return token.length - candidate.length <= maxSuffixChars;
      }
      return false;
    })) {
      count += 1;
    }
  }

  return count;
}

function applyCompanyNameRelevanceGuard(
  companies: BiznesinfoCompanySummary[],
  rawQuery: string,
): BiznesinfoCompanySummary[] {
  const queryTokens = buildCompanyNameQueryTokens(rawQuery);
  if (queryTokens.length === 0) return companies;

  const requiredOverlap = queryTokens.length >= 2 ? 2 : 1;
  const ranked = companies.map((company, index) => {
    const nameText = company.name || "";
    const categoryText = `${company.primary_category_name || ""} ${company.primary_rubric_name || ""}`.trim();
    const nameTokens = canonicalizeSemanticTokens(
      tokenizeSemanticText(nameText)
        .filter((token) => token.length >= 2)
        .filter((token) => !COMPANY_NAME_QUERY_STOP_TOKENS.has(token)),
    );
    const categoryTokens = canonicalizeSemanticTokens(
      tokenizeSemanticText(categoryText).filter((token) => token.length >= 2),
    );

    const nameOverlap = overlapCount(nameTokens, queryTokens);
    const categoryOverlap = overlapCount(categoryTokens, queryTokens);
    const nameScore = semanticOverlapScore(nameText, queryTokens);
    const categoryScore = semanticOverlapScore(categoryText, queryTokens);
    const keep = requiredOverlap === 1
      ? nameOverlap >= 1 || nameScore >= 2 || categoryOverlap >= 1 || categoryScore >= 3
      : nameOverlap >= requiredOverlap ||
          nameScore >= 4 ||
          (nameOverlap >= 1 && (categoryOverlap >= 1 || categoryScore >= 3));
    const score = (nameOverlap * 120) + (nameScore * 20) + (categoryOverlap * 10) + categoryScore;

    return { company, index, score, keep };
  });

  const filtered = ranked.filter((item) => item.keep);
  if (filtered.length === 0) return [];

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return filtered.map((item) => item.company);
}

function normalizeCompanySuggestText(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function countNearStemMatches(nameTokens: string[], queryTokens: string[]): number {
  if (nameTokens.length === 0 || queryTokens.length === 0) return 0;
  let count = 0;
  for (const token of queryTokens) {
    if (token.length < 5) continue;
    const stem = token.slice(0, 5);
    if (!stem) continue;
    if (nameTokens.some((candidate) => candidate.startsWith(stem))) {
      count += 1;
    }
  }
  return count;
}

function buildCompanySuggestTokens(hit: MeiliCompanyDocument): string[] {
  const fromName = tokenizeSemanticText(hit.name || "")
    .filter((token) => token.length >= 2)
    .filter((token) => !COMPANY_NAME_QUERY_STOP_TOKENS.has(token));
  const fromIndex = (hit.nameTokens || [])
    .filter((token) => token.length >= 2)
    .filter((token) => !COMPANY_NAME_QUERY_STOP_TOKENS.has(token));
  return canonicalizeSemanticTokens([...fromName, ...fromIndex]);
}

function applyCompanySuggestHitGuard(
  hits: MeiliCompanyDocument[],
  rawQuery: string,
): MeiliCompanyDocument[] {
  const queryTokens = buildCompanyNameQueryTokens(rawQuery);
  if (queryTokens.length === 0) return hits;

  const normalizedQuery = normalizeCompanySuggestText(rawQuery);
  const requiredOverlap = queryTokens.length >= 2 ? 2 : 1;

  const ranked = hits.map((hit, index) => {
    const nameTokens = buildCompanySuggestTokens(hit);
    const nameText = `${hit.name || ""} ${hit.normalizedName || ""}`.trim();
    const normalizedName = normalizeCompanySuggestText(nameText);
    const nameOverlap = overlapCount(nameTokens, queryTokens);
    const nameScore = semanticOverlapScore(nameText, queryTokens);
    const nearStemMatches = countNearStemMatches(nameTokens, queryTokens);
    const phrasePrefixMatch =
      Boolean(normalizedQuery) &&
      Boolean(normalizedName) &&
      (normalizedName.startsWith(normalizedQuery) || normalizedName.includes(` ${normalizedQuery}`));
    const keep = requiredOverlap === 1
      ? nameOverlap >= 1 || nameScore >= 2 || nearStemMatches >= 1 || phrasePrefixMatch
      : nameOverlap >= requiredOverlap ||
          nameScore >= queryTokens.length * 2 ||
          (nameOverlap >= 1 && nearStemMatches >= 1) ||
          phrasePrefixMatch;

    const score =
      (phrasePrefixMatch ? 500 : 0) +
      (nameOverlap * 120) +
      (nearStemMatches * 60) +
      (nameScore * 20);

    return { hit, index, keep, score };
  });

  const filtered = ranked.filter((item) => item.keep);
  if (filtered.length === 0) return [];

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return filtered.map((item) => item.hit);
}

function buildStructuredHitTokens(hit: MeiliCompanyDocument): string[] {
  return buildCommodityCoreTokens(hit);
}

function buildCommodityCoreTextParts(hit: MeiliCompanyDocument): string[] {
  return [
    hit.servicesText || "",
    ...(hit.serviceTitles || []),
    ...(hit.serviceCategories || []),
    ...(hit.categoryNames || []),
    ...(hit.keywords || []),
    ...(hit.serviceTokens || []),
    ...(hit.categoryTokens || []),
  ];
}

function buildCommodityCoreTokens(hit: MeiliCompanyDocument): string[] {
  return canonicalizeSemanticTokens(
    [
      ...buildCommodityCoreTextParts(hit).flatMap((part) => tokenizeSemanticText(part)),
    ].filter((token) => token.length >= 2),
  );
}

function clampScore(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeGeoText(value: string | null | undefined): string {
  return normalizeText(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е");
}

function haversineDistanceKm(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function computeFreshnessScore(hit: MeiliCompanyDocument): number {
  const dateText = normalizeText(hit.updatedAt || hit.createdAt || "");
  if (!dateText) return 0;

  const parsed = Date.parse(dateText);
  if (!Number.isFinite(parsed)) return 0;

  const ageDays = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24));
  if (ageDays <= 30) return 1;
  if (ageDays <= 120) return 0.82;
  if (ageDays <= 365) return 0.6;
  if (ageDays <= 730) return 0.35;
  return 0.15;
}

type SearchBusinessRerankContext = {
  queryText: string;
  region?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
};

function computeGeoRelevanceScore(
  hit: MeiliCompanyDocument,
  context: SearchBusinessRerankContext,
): number {
  let score = 0;

  const requestCity = normalizeGeoText(context.city || "");
  const requestRegion = normalizeGeoText(context.region || "");
  const hitCity = normalizeGeoText(hit.city || "");
  const hitRegion = normalizeGeoText(hit.region || "");

  if (requestCity && hitCity) {
    if (requestCity === hitCity) score += 1.1;
    else if (hitCity.includes(requestCity) || requestCity.includes(hitCity)) score += 0.45;
  }

  if (requestRegion && hitRegion) {
    if (requestRegion === hitRegion) score += 0.75;
    else if (hitRegion.includes(requestRegion) || requestRegion.includes(hitRegion)) score += 0.3;
  }

  const lat = Number(context.lat);
  const lng = Number(context.lng);
  const geo = hit._geo || null;
  if (Number.isFinite(lat) && Number.isFinite(lng) && geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
    const distanceKm = haversineDistanceKm(lat, lng, Number(geo.lat), Number(geo.lng));
    if (distanceKm <= 3) score += 1.2;
    else if (distanceKm <= 10) score += 0.9;
    else if (distanceKm <= 30) score += 0.55;
    else if (distanceKm <= 80) score += 0.2;
  }

  return score;
}

function computeBusinessFieldScore(
  hit: MeiliCompanyDocument,
  queryTokens: string[],
): {
  total: number;
  structuredScore: number;
  semanticScore: number;
  keywordScore: number;
  nameScore: number;
  descriptionWeightedScore: number;
  structuredOverlap: number;
  descriptionScore: number;
} {
  const structuredTokens = buildStructuredHitTokens(hit);
  const structuredText = buildCommodityCoreTextParts(hit).join(" ");
  const keywordText = (hit.keywords || []).join(" ");
  const descriptionText = `${hit.description || ""} ${hit.about || ""}`.trim();
  const nameText = hit.name || "";

  const structuredOverlap = overlapCount(structuredTokens, queryTokens);
  const structuredSemanticScore = semanticOverlapScore(structuredText, queryTokens);
  const keywordSemanticScore = semanticOverlapScore(keywordText, queryTokens);
  const nameScore = semanticOverlapScore(nameText, queryTokens);
  const descriptionScore = semanticOverlapScore(descriptionText, queryTokens);
  const structuredScore = structuredOverlap * 16;
  const semanticScore = structuredSemanticScore * 12;
  const keywordScore = keywordSemanticScore * 7;
  const nameWeightedScore = nameScore * 2;
  const descriptionWeightedScore = descriptionScore * 0.6;

  return {
    total:
      structuredScore +
      semanticScore +
      keywordScore +
      nameWeightedScore +
      descriptionWeightedScore,
    structuredScore,
    semanticScore,
    keywordScore,
    nameScore: nameWeightedScore,
    descriptionWeightedScore,
    structuredOverlap,
    descriptionScore,
  };
}

function buildRerankReasons(input: {
  businessFieldScore: ReturnType<typeof computeBusinessFieldScore>;
  qualityScore: number;
  freshnessScore: number;
  geoScore: number;
  penalty: number;
  variant: SearchRankingVariant;
}): string[] {
  const reasons: string[] = [];
  if (input.businessFieldScore.structuredOverlap >= 2) reasons.push("strong_structured_match");
  else if (input.businessFieldScore.structuredOverlap >= 1) reasons.push("structured_match");
  if (input.businessFieldScore.semanticScore >= 20 || input.businessFieldScore.keywordScore >= 10) {
    reasons.push("semantic_service_match");
  }
  if (input.geoScore >= 0.9) reasons.push("geo_relevant");
  if (input.qualityScore >= 0.8) reasons.push("full_profile");
  if (input.freshnessScore >= 0.8) reasons.push("fresh_profile");
  if (input.penalty > 0) reasons.push("description_only_penalty");
  reasons.push(`ranker_${input.variant}`);
  if (reasons.length === 1) reasons.unshift("retrieval_match");
  return reasons;
}

function rerankHitsByBusinessSignals(
  hits: MeiliCompanyDocument[],
  context: SearchBusinessRerankContext,
  options: {
    variant: SearchRankingVariant;
  },
): {
  hits: MeiliCompanyDocument[];
  explainById: Map<string, SearchRerankExplainItem>;
} {
  if (hits.length <= 1) {
    return {
      hits,
      explainById: new Map<string, SearchRerankExplainItem>(),
    };
  }

  const queryTokens = buildProductQueryTokens(context.queryText);
  if (queryTokens.length === 0) {
    return {
      hits,
      explainById: new Map<string, SearchRerankExplainItem>(),
    };
  }

  const isCommodityQuery = looksLikeCommodityIntent(context.queryText, queryTokens);
  const variant = options.variant;
  const weights = variant === "treatment"
    ? {
      quality: 9.5,
      freshness: 6,
      geo: 7,
      rankPrior: 1.2,
      descOnlyPenalty: 16,
    }
    : {
      quality: 8,
      freshness: 5,
      geo: 6,
      rankPrior: 1,
      descOnlyPenalty: 14,
    };
  const totalHits = Math.max(1, hits.length);
  const ranked = hits.map((hit, index) => {
    const businessField = computeBusinessFieldScore(hit, queryTokens);
    const qualityScore = clampScore(Number(hit.data_quality_score || 0), 0, 100) / 100;
    const freshnessScore = computeFreshnessScore(hit);
    const geoScore = computeGeoRelevanceScore(hit, context);
    const rankPrior = (totalHits - index) / totalHits;

    let penalty = 0;
    if (isCommodityQuery && businessField.structuredOverlap === 0 && businessField.descriptionScore > 0) {
      penalty += weights.descOnlyPenalty;
    }

    const totalScore =
      businessField.total +
      (qualityScore * weights.quality) +
      (freshnessScore * weights.freshness) +
      (geoScore * weights.geo) +
      (rankPrior * weights.rankPrior) -
      penalty;

    const reasons = buildRerankReasons({
      businessFieldScore: businessField,
      qualityScore,
      freshnessScore,
      geoScore,
      penalty,
      variant,
    });

    return {
      hit,
      index,
      totalScore,
      reasons,
      signals: {
        business: businessField.total,
        quality: qualityScore,
        freshness: freshnessScore,
        geo: geoScore,
        rankPrior,
        penalty,
        structuredOverlap: businessField.structuredOverlap,
        descriptionScore: businessField.descriptionScore,
      },
    };
  });

  ranked.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.index - b.index;
  });

  const explainById = new Map<string, SearchRerankExplainItem>();
  for (let idx = 0; idx < ranked.length; idx += 1) {
    const item = ranked[idx];
    const id = normalizeText(item.hit.id || "");
    if (!id || explainById.has(id)) continue;
    explainById.set(id, {
      id,
      name: item.hit.name || "",
      rankBefore: item.index + 1,
      rankAfter: idx + 1,
      score: item.totalScore,
      reasons: item.reasons,
      signals: item.signals,
    });
  }

  return {
    hits: ranked.map((item) => item.hit),
    explainById,
  };
}

function hasCommodityMustMatch(
  hit: MeiliCompanyDocument,
  queryTokens: string[],
): boolean {
  if (queryTokens.length === 0) return true;
  const foodCommodityIntent = queryTokens.some((token) => isFoodCommodityIntentToken(token));
  const strictFoodCommodityIntent = queryTokens.some((token) => isStrictFoodCommodityIntentToken(token));
  const coreTokens = buildCommodityCoreTokens(hit);
  if (coreTokens.length > 0 && overlapCountBounded(coreTokens, queryTokens, strictFoodCommodityIntent ? 0 : 1) >= 1) {
    return true;
  }

  const coreText = buildCommodityCoreTextParts(hit).join(" ");
  if (strictFoodCommodityIntent) {
    const strictFoodContext = `${coreText} ${(hit.keywords || []).join(" ")}`.trim();
    const strictFoodMatch =
      isFoodCategoryContext(strictFoodContext) ||
      FOOD_PRODUCT_SIGNAL_RE.test(strictFoodContext) ||
      (hit.domainTags || []).includes("food");
    if (!strictFoodMatch) return false;
  }
  if (coreText && semanticOverlapScore(coreText, queryTokens) >= 2) return true;

  if (foodCommodityIntent && (hit.domainTags || []).includes("food")) {
    const commodityNameScore = semanticOverlapScore(hit.name || "", queryTokens);
    if (commodityNameScore >= 2) return true;
  }

  return false;
}

function hasCommodityDomainDistractor(
  categoryContextText: string,
  detailsContextText: string,
  options: {
    foodCommodityIntent: boolean;
    packagingQuery: boolean;
    rawMaterialQuery: boolean;
    equipmentQuery: boolean;
  },
): boolean {
  const categoryText = categoryContextText.trim();
  const detailsText = detailsContextText.trim();
  const contextText = `${categoryText} ${detailsText}`.trim();
  const strictFoodCategory = isFoodCategoryContext(categoryText);
  const detailsFoodCategory = isFoodCategoryContext(detailsText);
  const packagingCategory = NON_FOOD_PACKAGING_CATEGORY_RE.test(contextText);
  const chemicalCategory = CHEMICAL_CATEGORY_RE.test(contextText);
  const hasRawMaterialCue = RAW_MATERIAL_TOKEN_RE.test(contextText);
  const industrialDistractor = NON_PRODUCT_INDUSTRIAL_CATEGORY_RE.test(contextText);
  const commodityDomainDistractor = COMMODITY_DOMAIN_DISTRACTOR_RE.test(contextText);
  const equipmentDistractor = FOOD_EQUIPMENT_DISTRACTOR_RE.test(contextText);
  const hasFoodSupplySignal = FOOD_SUPPLY_CHAIN_SIGNAL_RE.test(contextText);
  // Prevent false positives like "молочная арматура": food adjective + generic "производители"
  // should not override clear industrial category signals.
  const strongFoodCategory = strictFoodCategory || (
    detailsFoodCategory &&
    hasFoodSupplySignal &&
    !industrialDistractor &&
    !equipmentDistractor &&
    !packagingCategory &&
    !chemicalCategory &&
    !hasRawMaterialCue
  );

  const foodPackagingDistractor =
    options.foodCommodityIntent &&
    !options.packagingQuery &&
    packagingCategory &&
    !strongFoodCategory;
  const foodRawMaterialDistractor =
    options.foodCommodityIntent &&
    !options.rawMaterialQuery &&
    (chemicalCategory || hasRawMaterialCue) &&
    !strongFoodCategory;
  const foodDomainDistractor =
    options.foodCommodityIntent &&
    !strongFoodCategory &&
    (industrialDistractor || commodityDomainDistractor);
  const foodEquipmentDistractor =
    options.foodCommodityIntent &&
    !options.equipmentQuery &&
    equipmentDistractor &&
    !strictFoodCategory;

  return (
    foodPackagingDistractor ||
    foodRawMaterialDistractor ||
    foodDomainDistractor ||
    foodEquipmentDistractor
  );
}

function applyCommodityStructuredHitGuard(
  hits: MeiliCompanyDocument[],
  rawProductQuery: string,
): MeiliCompanyDocument[] {
  if (!rawProductQuery) return hits;

  const queryTokens = buildProductQueryTokens(rawProductQuery);
  if (!looksLikeCommodityIntent(rawProductQuery, queryTokens)) return hits;
  if (queryTokens.length === 0) return hits;
  const foodCommodityIntent = looksLikeFoodCommodityIntent(rawProductQuery, queryTokens);
  const strictFoodCommodityIntent = queryTokens.some((token) => isStrictFoodCommodityIntentToken(token));
  const procurementIntent = PROCUREMENT_CUE_RE.test(rawProductQuery);
  const packagingQuery = PACKAGING_QUERY_CUE_RE.test(rawProductQuery);
  const rawMaterialQuery = RAW_MATERIAL_TOKEN_RE.test(rawProductQuery);
  const equipmentQuery = EQUIPMENT_QUERY_CUE_RE.test(rawProductQuery);

  const ranked = hits.map((hit, index) => {
    const structuredTokens = buildStructuredHitTokens(hit);
    const categoryContextText = [
      ...(hit.serviceCategories || []),
      ...(hit.categoryNames || []),
      ...(hit.category_names || []),
      ...(hit.rubric_names || []),
    ].join(" ");
    const structuredText = buildCommodityCoreTextParts(hit).join(" ");
    const keywordText = (hit.keywords || []).join(" ");
    const descriptionText = `${hit.description || ""} ${hit.about || ""}`.trim();
    const structuredTextScore = semanticOverlapScore(structuredText, queryTokens);
    const tokenScore = overlapCount(structuredTokens, queryTokens);
    const keywordScore = semanticOverlapScore(keywordText, queryTokens);
    const nameScore = semanticOverlapScore(hit.name || "", queryTokens);
    const descriptionScore = semanticOverlapScore(descriptionText, queryTokens);
    const qualityScore = Number(hit.data_quality_score || 0);
    const freshnessScore = computeFreshnessScore(hit);
    const foodContextText = [
      structuredText,
      keywordText,
      hit.region || "",
      hit.city || "",
    ].join(" ");
    const hasFoodProductSignal = FOOD_PRODUCT_SIGNAL_RE.test(foodContextText);
    const hasFoodSupplyChainSignal = FOOD_SUPPLY_CHAIN_SIGNAL_RE.test(foodContextText);
    const hasCommodityNameSignal = !strictFoodCommodityIntent && semanticOverlapScore(hit.name || "", queryTokens) >= 2;
    const hasFoodSupplySignal = procurementIntent
      ? hasFoodProductSignal && hasFoodSupplyChainSignal
      : (hasFoodProductSignal || hasCommodityNameSignal);
    const nonFoodCommodityDistractor = hasCommodityDomainDistractor(
      categoryContextText,
      `${structuredText} ${keywordText}`,
      {
        foodCommodityIntent,
        packagingQuery,
        rawMaterialQuery,
        equipmentQuery,
      },
    );
    const hasStructuredProfile = structuredTokens.length > 0;
    const score =
      (structuredTextScore * 16) +
      (tokenScore * 12) +
      (keywordScore * 8) +
      (nameScore * 6) +
      (descriptionScore * 0.7) +
      (Math.min(qualityScore, 100) / 12) +
      (freshnessScore * 3);
    const mustMatch = hasCommodityMustMatch(hit, queryTokens);
    const noisyDescriptionOnly = tokenScore === 0 && structuredTextScore === 0 && descriptionScore > 0;
    const weakFoodRelevance = foodCommodityIntent && !hasFoodSupplySignal;
    const missingStructuredProfile = foodCommodityIntent && !hasStructuredProfile;
    return {
      hit,
      index,
      score,
      mustMatch,
      noisyDescriptionOnly,
      weakFoodRelevance,
      missingStructuredProfile,
      nonFoodCommodityDistractor,
    };
  });

  const minScore = resolveCommodityStructuredMinScore(queryTokens);
  const filtered = ranked.filter(
    (item) =>
      item.mustMatch &&
      item.score >= minScore &&
      !item.noisyDescriptionOnly &&
      !item.weakFoodRelevance &&
      !item.missingStructuredProfile &&
      !item.nonFoodCommodityDistractor,
  );
  if (filtered.length === 0) return [];

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return filtered.map((item) => item.hit);
}

function applyCommodityRelevanceGuard(
  companies: BiznesinfoCompanySummary[],
  rawProductQuery: string,
): BiznesinfoCompanySummary[] {
  if (!rawProductQuery) return companies;

  const queryTokens = buildProductQueryTokens(rawProductQuery);
  if (!looksLikeCommodityIntent(rawProductQuery, queryTokens)) return companies;
  if (queryTokens.length === 0) return companies;
  const foodCommodityIntent = looksLikeFoodCommodityIntent(rawProductQuery, queryTokens);
  const strictFoodCommodityIntent = queryTokens.some((token) => isStrictFoodCommodityIntentToken(token));
  const cheeseIntent = looksLikeCheeseCommodityIntent(rawProductQuery);
  const packagingQuery = PACKAGING_QUERY_CUE_RE.test(rawProductQuery);
  const rawMaterialQuery = RAW_MATERIAL_TOKEN_RE.test(rawProductQuery);
  const equipmentQuery = EQUIPMENT_QUERY_CUE_RE.test(rawProductQuery);
  const requiredNameEntityTokens = queryTokens.filter((token) => COMMODITY_ENTITY_TOKEN_RE.test(token));

  const ranked = companies.map((company, index) => {
    const categoryText = `${company.primary_category_name || ""} ${company.primary_rubric_name || ""}`.trim();
    const detailsText = `${company.description || ""} ${company.about || ""}`.trim();
    const nameText = company.name || "";
    const nameTokens = canonicalizeSemanticTokens(
      tokenizeSemanticText(nameText).filter((token) => token.length >= 2),
    );
    const categoryScore = semanticOverlapScore(categoryText, queryTokens);
    const detailsScore = semanticOverlapScore(detailsText, queryTokens);
    const nameScore = semanticOverlapScore(nameText, queryTokens);
    const strictFoodContextText = `${categoryText} ${detailsText}`.trim();
    const strictFoodMismatch =
      strictFoodCommodityIntent &&
      !isFoodCategoryContext(strictFoodContextText) &&
      !FOOD_PRODUCT_SIGNAL_RE.test(strictFoodContextText);
    const entityNameOverlap = requiredNameEntityTokens.length > 0
      ? overlapCount(nameTokens, requiredNameEntityTokens)
      : 0;
    const entityNameMatch = requiredNameEntityTokens.length === 0 || entityNameOverlap >= requiredNameEntityTokens.length;
    const mediaCategory = NON_PRODUCT_MEDIA_CATEGORY_RE.test(categoryText);
    const industrialCategory = NON_PRODUCT_INDUSTRIAL_CATEGORY_RE.test(categoryText);
    const joinedText = `${nameText} ${categoryText} ${detailsText}`.trim();
    const hasRawMaterialCue = RAW_MATERIAL_TOKEN_RE.test(joinedText);
    const chemicalCategory = CHEMICAL_CATEGORY_RE.test(categoryText);
    const foodCheeseCategory = FOOD_CHEESE_CATEGORY_RE.test(categoryText);
    const cheeseRawMaterialDistractor = cheeseIntent && (chemicalCategory || hasRawMaterialCue) && !foodCheeseCategory;
    const nonFoodCommodityDistractor = hasCommodityDomainDistractor(
      categoryText,
      detailsText,
      {
        foodCommodityIntent,
        packagingQuery,
        rawMaterialQuery,
        equipmentQuery,
      },
    );
    const summaryMustMatch = categoryScore >= 3 || detailsScore >= 3 || nameScore >= 3;
    const hardDistractor =
      ((mediaCategory || industrialCategory) && categoryScore === 0 && detailsScore === 0) ||
      cheeseRawMaterialDistractor ||
      nonFoodCommodityDistractor ||
      strictFoodMismatch;
    const score =
      (categoryScore * 100) +
      (detailsScore * 6) +
      nameScore +
      (entityNameOverlap * 40) -
      (hardDistractor ? 1000 : 0);
    const minScorePass = score >= resolveCommoditySummaryMinScore(queryTokens);
    return {
      company,
      index,
      score,
      hardDistractor,
      strictFoodMismatch,
      entityNameMatch,
      minScorePass,
      summaryMustMatch,
    };
  });

  if (requiredNameEntityTokens.length > 0) {
    const entityMatched = ranked.filter((item) => item.entityNameMatch && item.minScorePass && item.summaryMustMatch);
    if (entityMatched.length === 0) return [];

    const withoutHardDistractors = entityMatched.filter((item) => !item.hardDistractor);
    if (strictFoodCommodityIntent && withoutHardDistractors.length === 0) return [];
    const base = withoutHardDistractors.length > 0 ? withoutHardDistractors : entityMatched;
    base.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return base.map((item) => item.company);
  }

  const withoutHardDistractors = ranked.filter(
    (item) => !item.hardDistractor && item.minScorePass && item.summaryMustMatch,
  );
  if (strictFoodCommodityIntent && withoutHardDistractors.length === 0) return [];
  const base = withoutHardDistractors.length > 0 ? withoutHardDistractors : ranked;

  base.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return base.map((item) => item.company);
}

type AddressHouseIntent = {
  raw: string;
  normalized: string;
  streetTokens: string[];
  houseTokens: string[];
};

function tokenizeAddressComparable(raw: string): string[] {
  const cleaned = normalizeText(raw)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}/-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(" ")
    .map((token) => token.replace(/^[-/]+|[-/]+$/gu, "").trim())
    .filter(Boolean);
}

function normalizeAddressToken(token: string): string {
  return String(token || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, "")
    .replace(/[^\p{L}\p{N}/-]+/gu, "")
    .trim();
}

function matchesStreetAddressToken(addressToken: string, queryToken: string): boolean {
  if (!addressToken || !queryToken) return false;
  if (addressToken === queryToken) return true;
  if (queryToken.length >= 4 && addressToken.startsWith(queryToken)) return true;
  if (addressToken.length >= 5 && queryToken.startsWith(addressToken)) return true;
  return false;
}

function matchesHouseAddressToken(addressToken: string, queryToken: string): boolean {
  if (!addressToken || !queryToken) return false;
  if (addressToken === queryToken) return true;

  const queryDigits = queryToken.replace(/[^\d]+/gu, "");
  if (!queryDigits) return false;
  const escapedDigits = queryDigits.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (queryToken === queryDigits) {
    // Accept "14", "14а", "14a", "14-1", "14/1", but not "140".
    return new RegExp(`^${escapedDigits}(?:[a-zа-я]|[-/]\\d+[a-zа-я]?)?$`, "iu").test(addressToken);
  }

  return false;
}

function extractHouseCandidatesAfterStreet(
  rawAddress: string,
  streetTokens: string[],
): string[] {
  const address = normalizeText(rawAddress)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
  if (!address) return [];
  if (streetTokens.length === 0) return [];

  const out: string[] = [];
  for (const streetToken of streetTokens) {
    if (!streetToken) continue;
    let cursor = 0;
    while (cursor < address.length) {
      const idx = address.indexOf(streetToken, cursor);
      if (idx < 0) break;
      const tail = address.slice(idx + streetToken.length, idx + streetToken.length + 80);
      const match = tail.match(/(?:дом|д\.?)?\s*[,/-]*\s*(\d+[a-zа-я]?(?:[-/]\d+[a-zа-я]?)?)/iu);
      if (match?.[1]) {
        const normalized = normalizeAddressToken(match[1]);
        if (normalized) out.push(normalized);
      }
      cursor = idx + streetToken.length;
    }
  }

  return Array.from(new Set(out));
}

function buildAddressHouseIntentFromParams(params: MeiliSearchParams): AddressHouseIntent | null {
  const candidates = [
    normalizeText(params.service || ""),
    normalizeText(params.query || ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isAddressLikeLocationQuery(candidate)) continue;
    const normalized = normalizeLocationQueryForSearch(candidate);
    if (!normalized) continue;
    const tokens = tokenizeAddressComparable(normalized).map((token) => normalizeAddressToken(token)).filter(Boolean);
    if (tokens.length === 0) continue;

    const houseTokens = tokens.filter((token) => /\d/u.test(token));
    if (houseTokens.length === 0) continue;

    const streetTokens = tokens.filter((token) => !/\d/u.test(token) && token.length >= 3);
    return {
      raw: candidate,
      normalized,
      streetTokens,
      houseTokens,
    };
  }

  return null;
}

function buildAddressIntentFromCity(rawCity: string): AddressHouseIntent | null {
  const candidate = normalizeText(rawCity || "");
  if (!candidate) return null;
  if (!isAddressLikeLocationQuery(candidate)) return null;

  const normalized = normalizeLocationQueryForSearch(candidate);
  if (!normalized) return null;

  const tokens = tokenizeAddressComparable(normalized).map((token) => normalizeAddressToken(token)).filter(Boolean);
  if (tokens.length === 0) return null;

  const streetTokens = tokens.filter((token) => !/\d/u.test(token) && token.length >= 3);
  if (streetTokens.length === 0) return null;

  const houseTokens = tokens.filter((token) => /\d/u.test(token));
  return {
    raw: candidate,
    normalized,
    streetTokens,
    houseTokens,
  };
}

function applyAddressHouseRelevanceGuard(
  companies: BiznesinfoCompanySummary[],
  intent: AddressHouseIntent | null,
): BiznesinfoCompanySummary[] {
  if (!intent) return companies;

  return companies.filter((company) => {
    const addressTokens = tokenizeAddressComparable(company.address || "").map((token) => normalizeAddressToken(token));
    if (addressTokens.length === 0) return false;

    const streetMatches = intent.streetTokens.filter((streetToken) =>
      addressTokens.some((addressToken) => matchesStreetAddressToken(addressToken, streetToken)),
    ).length;
    if (intent.streetTokens.length > 0 && streetMatches < Math.min(intent.streetTokens.length, 2)) {
      return false;
    }

    if (intent.houseTokens.length === 0) {
      return intent.streetTokens.length > 0;
    }

    if (intent.streetTokens.length > 0) {
      const houseAfterStreet = extractHouseCandidatesAfterStreet(company.address || "", intent.streetTokens);
      if (houseAfterStreet.length > 0) {
        return intent.houseTokens.every((houseToken) =>
          houseAfterStreet.some((candidate) => matchesHouseAddressToken(candidate, houseToken)),
        );
      }
    }

    // Fallback for uncommon address formats without obvious "street -> house" sequence.
    return intent.houseTokens.every((houseToken) =>
      addressTokens.some((addressToken) => matchesHouseAddressToken(addressToken, houseToken)),
    );
  });
}

export async function meiliSearch(params: MeiliSearchParams): Promise<BiznesinfoSearchFlowResponse> {
  const index = getCompaniesIndex();
  const { page, limit, offset } = parsePagination(params);
  const cityFilter = normalizeText(params.city || "");
  const cityLooksLikeAddress = isAddressLikeLocationQuery(cityFilter);
  const locationQuery = cityLooksLikeAddress ? normalizeLocationQueryForSearch(cityFilter) : "";
  const query = [composeSearchQuery(params), locationQuery].filter(Boolean).join(" ").trim();
  const queryFieldValue = normalizeText(params.query || "");
  const serviceFieldValue = normalizeText(params.service || "");
  const strictCityFilter = cityLooksLikeAddress ? "" : cityFilter;
  const regionFilter = normalizeText(params.region || "");
  const supplyType = normalizeSupplyType(params.supplyType);
  const businessFormat = normalizeBusinessFormat(params.businessFormat);
  const hasUxPostFilters = supplyType !== "any" || businessFormat !== "any";
  const productQuery = buildProductQueryText(params);
  const productQueryForRetrieval = buildHybridProductQuery(productQuery);
  const productQueryTokens = buildProductQueryTokens(productQueryForRetrieval || productQuery);
  const commodityIntentQuery = looksLikeCommodityIntent(
    productQueryForRetrieval || productQuery,
    productQueryTokens,
  );
  const cityAddressIntent = buildAddressIntentFromCity(cityFilter);
  const addressHouseIntent = buildAddressHouseIntentFromParams(params);
  const companyNameOnlyQuery = isCompanyNameOnlyQuery(params) && !cityLooksLikeAddress;
  const filter = buildSearchFilter({ ...params, city: strictCityFilter || null });
  const sort = buildSort(params);
  const shouldUsePostFilterWindow = Boolean(productQuery) || companyNameOnlyQuery || hasUxPostFilters;
  const useHybridRetrieval =
    isHybridSearchEnabled() &&
    Boolean(normalizeText(query) || normalizeText(productQuery) || normalizeText(params.query || ""));
  const abResolution = resolveSearchAbResolution(params, productQuery || query || queryFieldValue || serviceFieldValue);
  const shouldExplainInResponse = Boolean(params.explain);
  const shouldEmitExplainLog = shouldLogSearchExplainability() || shouldExplainInResponse;
  const windowOffset = useHybridRetrieval ? 0 : offset;
  const postFilterFetchFloor = commodityIntentQuery ? COMMODITY_POST_FILTER_FETCH_FLOOR : 0;
  const baseFetchLimit = shouldUsePostFilterWindow
    ? Math.min(
      POST_FILTER_FETCH_MAX,
      Math.max(limit, limit * POST_FILTER_FETCH_MULTIPLIER, postFilterFetchFloor),
    )
    : limit;
  const fetchLimit = useHybridRetrieval
    ? Math.min(HYBRID_FETCH_MAX, Math.max(baseFetchLimit, offset + Math.max(limit * 2, 40)))
    : baseFetchLimit;
  const attributesToRetrieve: string[] = shouldUsePostFilterWindow
    ? [
      "id",
      "name",
      "description",
      "servicesText",
      "serviceTitles",
      "serviceCategories",
      "categoryNames",
      "category_names",
      "rubric_names",
      "nameTokens",
      "serviceTokens",
      "categoryTokens",
      "domainTags",
      "data_quality_score",
      "createdAt",
      "updatedAt",
      "region",
      "city",
      "_geo",
      "logo_rank",
      "keywords",
    ]
    : ["id"];
  const meiliFilter = filter.length > 0 ? filter : undefined;
  const plans = useHybridRetrieval
    ? buildHybridRetrievalPlans({ query, productQuery: productQueryForRetrieval, companyNameOnlyQuery })
    : [
      {
        key: "single-pass",
        query,
        weight: 1,
        attributesToSearchOn: companyNameOnlyQuery
          ? ["name", "normalizedName", "nameTokens"]
          : undefined,
      } satisfies HybridRetrievalPlan,
    ];

  const meiliStartedAt = Date.now();
  const planResults = await Promise.all(
    plans.map(async (plan): Promise<HybridRetrievalPlanResult> => {
      const result = await index.search(plan.query, {
        offset: windowOffset,
        limit: fetchLimit,
        filter: meiliFilter,
        sort,
        attributesToRetrieve,
        attributesToSearchOn: plan.attributesToSearchOn,
      });
      return {
        plan,
        hits: result.hits as MeiliCompanyDocument[],
        estimatedTotalHits: Number(result.estimatedTotalHits || 0),
      };
    }),
  );
  const meiliDurationMs = Date.now() - meiliStartedAt;
  const fused = fuseHybridPlanResults(planResults, fetchLimit);

  const rawHits = fused.hits;
  const structuredHits = shouldUsePostFilterWindow
    ? applyCommodityStructuredHitGuard(rawHits, productQuery)
    : rawHits;
  const rerankResult =
    shouldUsePostFilterWindow && !companyNameOnlyQuery
      ? rerankHitsByBusinessSignals(structuredHits, {
        queryText: productQuery || query,
        region: params.region || null,
        city: params.city || null,
        lat: Number.isFinite(params.lat) ? Number(params.lat) : null,
        lng: Number.isFinite(params.lng) ? Number(params.lng) : null,
      }, {
        variant: abResolution.variant,
      })
      : {
        hits: structuredHits,
        explainById: new Map<string, SearchRerankExplainItem>(),
      };
  const rerankedHits = rerankResult.hits;
  const rerankExplainById = rerankResult.explainById;

  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const hit of rerankedHits) {
    const id = normalizeText(hit.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
  }

  const isLocationOnlySearch =
    !queryFieldValue &&
    !serviceFieldValue &&
    !productQuery &&
    !companyNameOnlyQuery &&
    !hasUxPostFilters &&
    !addressHouseIntent &&
    !cityAddressIntent &&
    Boolean(cityFilter || regionFilter);

  if (ids.length === 0) {
    let total = 0;
    if (rawHits.length === 0) {
      const estimatedTotalHits = Number(fused.estimatedTotalHits || 0);
      let exactLocationTotal: number | null = null;
      if (isLocationOnlySearch) {
        try {
          exactLocationTotal = await biznesinfoCountCompaniesByLocation({
            city: cityFilter || null,
            region: regionFilter || null,
          });
        } catch {
          exactLocationTotal = null;
        }
      }

      total = exactLocationTotal != null
        ? Math.max(estimatedTotalHits, exactLocationTotal)
        : estimatedTotalHits;
    }

    const zeroResults = buildZeroResultsPayload({
      filteredCompanies: [],
      baseCompanies: [],
      queryText: productQuery || query || serviceFieldValue || queryFieldValue,
      queryFieldValue,
      serviceFieldValue,
      city: cityFilter,
      region: regionFilter,
      supplyType,
      businessFormat,
    });
    return {
      query: queryFieldValue,
      total: Math.max(0, total),
      companies: [],
      items: [],
      page,
      limit,
      ab_test: {
        enabled: abResolution.enabled,
        variant: abResolution.variant,
        split_percent: abResolution.splitPercent,
        bucket: abResolution.bucket,
        forced: abResolution.forced,
        seed_hash: abResolution.seedHash,
      },
      ranking_explain: shouldExplainInResponse ? [] : undefined,
      facets: buildUxFacets([]),
      applied_filters: {
        region: regionFilter || null,
        city: cityFilter || null,
        supply_type: supplyType,
        business_format: businessFormat,
      },
      zero_results: zeroResults,
    };
  }

  // Hydrate meili ids with full company payload so cards keep contacts/logo/metadata.
  const dbStartedAt = Date.now();
  const summaries = await biznesinfoGetCompaniesSummaryByIds(ids);
  const dbDurationMs = Date.now() - dbStartedAt;
  const hydrated = hydrateCompaniesInOrder(ids, summaries);
  const nameGuarded = companyNameOnlyQuery
    ? applyCompanyNameRelevanceGuard(hydrated, params.query || "")
    : hydrated;
  const guarded = applyCommodityRelevanceGuard(nameGuarded, productQuery);
  const addressHouseGuarded = applyAddressHouseRelevanceGuard(guarded, addressHouseIntent);
  const addressGuarded = applyAddressHouseRelevanceGuard(addressHouseGuarded, cityAddressIntent);
  const facets = buildUxFacets(addressGuarded);
  const uxFiltered = applyUxCompanyFilters(addressGuarded, {
    supplyType,
    businessFormat,
  });
  const logoPrioritized = prioritizeCompaniesWithLogos(uxFiltered);
  const zeroResults = buildZeroResultsPayload({
    filteredCompanies: logoPrioritized,
    baseCompanies: addressGuarded,
    queryText: productQuery || query || serviceFieldValue || queryFieldValue,
    queryFieldValue,
    serviceFieldValue,
    city: cityFilter,
    region: regionFilter,
    supplyType,
    businessFormat,
  });
  const start = Math.max(0, offset - windowOffset);
  const end = start + limit;
  const companies = logoPrioritized.slice(start, end);
  const rankingExplain = companies.slice(0, 10).map((company, idx) => {
    const explainItem = rerankExplainById.get(company.id);
    const reasons =
      explainItem?.reasons?.length
        ? explainItem.reasons
        : [
          "retrieval_match",
          company.primary_category_name ? "category_match" : "",
          company.primary_rubric_name ? "rubric_match" : "",
          "passed_guardrails",
          "post_filters_passed",
          `ranker_${abResolution.variant}`,
        ].filter(Boolean);
    return {
      id: company.id,
      name: company.name || explainItem?.name || "",
      rank: start + idx + 1,
      score: Number(explainItem?.score || 0),
      reasons,
      signals: explainItem
        ? {
          business: explainItem.signals.business,
          quality: explainItem.signals.quality,
          freshness: explainItem.signals.freshness,
          geo: explainItem.signals.geo,
          rank_prior: explainItem.signals.rankPrior,
          penalty: explainItem.signals.penalty,
          structured_overlap: explainItem.signals.structuredOverlap,
          description_score: explainItem.signals.descriptionScore,
        }
        : undefined,
    };
  });
  const observedReachableTotal = windowOffset + uxFiltered.length;
  const estimatedTotalHits = Number(fused.estimatedTotalHits || 0);
  const estimatedOrObservedTotal = estimatedTotalHits > 0 ? estimatedTotalHits : observedReachableTotal;
  let exactLocationTotal: number | null = null;
  if (isLocationOnlySearch) {
    try {
      exactLocationTotal = await biznesinfoCountCompaniesByLocation({
        city: cityFilter || null,
        region: regionFilter || null,
      });
    } catch {
      exactLocationTotal = null;
    }
  }

  const total = exactLocationTotal != null
    ? Math.max(offset + companies.length, exactLocationTotal)
    : isLocationOnlySearch
      ? Math.max(offset + companies.length, estimatedOrObservedTotal)
      : Math.max(
        offset + companies.length,
        Math.min(estimatedOrObservedTotal, observedReachableTotal),
      );

  if (shouldLogSearchPerf() || meiliDurationMs > MEILI_TARGET_MS || dbDurationMs > DB_TARGET_MS) {
    const status =
      meiliDurationMs <= MEILI_TARGET_MS && dbDurationMs <= DB_TARGET_MS
        ? "ok"
        : "slow";
    const planKeys = plans.map((plan) => plan.key).join(",");
    console.log(
      `[biznesinfo.search.perf] status=${status} mode=${useHybridRetrieval ? "hybrid" : "single"} plans=${planKeys} meiliMs=${meiliDurationMs} dbMs=${dbDurationMs} ids=${ids.length} limit=${limit} offset=${offset}`,
    );
  }

  if (shouldEmitExplainLog) {
    console.log(
      `[biznesinfo.search.explain] ${JSON.stringify({
        variant: abResolution.variant,
        forced: abResolution.forced,
        query: queryFieldValue || serviceFieldValue || query,
        service: serviceFieldValue || null,
        city: cityFilter || null,
        region: regionFilter || null,
        total,
        top: rankingExplain,
      })}`,
    );
  }

  return {
    query: queryFieldValue,
    total,
    companies,
    items: companies,
    page,
    limit,
    ab_test: {
      enabled: abResolution.enabled,
      variant: abResolution.variant,
      split_percent: abResolution.splitPercent,
      bucket: abResolution.bucket,
      forced: abResolution.forced,
      seed_hash: abResolution.seedHash,
    },
    ranking_explain: shouldExplainInResponse ? rankingExplain : undefined,
    facets,
    applied_filters: {
      region: regionFilter || null,
      city: cityFilter || null,
      supply_type: supplyType,
      business_format: businessFormat,
    },
    zero_results: zeroResults,
  };
}

export async function meiliSuggest(params: {
  query: string;
  region?: string | null;
  limit?: number;
}): Promise<BiznesinfoSuggestResponse> {
  const index = getCompaniesIndex();
  const query = normalizeText(params.query || "");
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(params.limit || 8)));
  const fetchLimit = Math.max(safeLimit, Math.min(60, safeLimit * 6));
  const filter = buildSearchFilter({
    query,
    region: params.region || null,
  });

  const result = await index.search(query, {
    limit: fetchLimit,
    filter: filter.length > 0 ? filter : undefined,
    sort: ["logo_rank:desc", "createdAt:desc"],
    attributesToSearchOn: ["name", "normalizedName", "nameTokens"],
    matchingStrategy: "all",
    attributesToRetrieve: ["id", "name", "normalizedName", "nameTokens"],
  });

  const guardedHits = applyCompanySuggestHitGuard(
    result.hits as MeiliCompanyDocument[],
    query,
  ).slice(0, safeLimit);

  const ids = guardedHits
    .map((hit) => normalizeText((hit as MeiliCompanyDocument).id))
    .filter(Boolean);
  const items = await biznesinfoGetSearchItemsByIds(ids);
  const byId = new Map<string, BiznesinfoSearchItem>();
  for (const item of items) byId.set(item.id, item);

  const suggestions: BiznesinfoSuggestResponse["suggestions"] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const logoUrl = (item.logo_url || "").trim();
    suggestions.push({
      type: "company",
      id: item.id,
      name: item.name,
      url: `/company/${companySlugForUrl(item.id)}`,
      icon: hasCompanyLogo(logoUrl) ? logoUrl : "🏢",
      subtitle: buildCompanySuggestSubtitle(item.city || "", item.address || ""),
    });
  }

  return {
    query,
    suggestions,
  };
}

export { isMeiliHealthy };
