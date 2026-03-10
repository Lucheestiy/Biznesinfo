import { splitServiceAndCity } from "@/lib/utils/location";

import {
  canonicalizeSemanticTokens,
  expandSemanticTokens,
  tokenizeSemanticText,
} from "./semantic";

export type BiznesinfoSearchIntent =
  | "company_lookup"
  | "product_lookup"
  | "service_lookup"
  | "mixed_lookup"
  | "generic_lookup";

export type BiznesinfoSearchQueryUnderstanding = {
  intent: BiznesinfoSearchIntent;
  entities: {
    city: string | null;
    region: string | null;
    format: "wholesale" | "retail" | "unspecified";
    quantity: string | null;
    focusTokens: string[];
  };
  searchParams: {
    query: string;
    service: string;
    keywords: string | null;
    city: string | null;
    region: string | null;
  };
};

export type BiznesinfoSearchQueryInput = {
  query?: string | null;
  service?: string | null;
  keywords?: string | null;
  city?: string | null;
  region?: string | null;
};

const PRODUCT_QUERY_TOKEN_RE =
  /(^|[^\p{L}\p{N}])(молок\p{L}*|сыр\p{L}*|рыб\p{L}*|хлеб\p{L}*|сахар\p{L}*|лук\p{L}*|мяс\p{L}*|овощ\p{L}*|фрукт\p{L}*|картоф\p{L}*|круп\p{L}*|мук\p{L}*|яйц\p{L}*|масл\p{L}*|бакале\p{L}*|напит\p{L}*|поставщик\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const SERVICE_QUERY_CUE_RE =
  /(^|[^\p{L}\p{N}])(услуг\p{L}*|сервис\p{L}*|ремонт\p{L}*|монтаж\p{L}*|установ\p{L}*|разработ\p{L}*|маркет\p{L}*|реклам\p{L}*|дизайн\p{L}*|smm|seo|консалт\p{L}*|аудит\p{L}*|обучен\p{L}*|курс\p{L}*|тур\p{L}*|гостиниц\p{L}*|отел\p{L}*|кафе|ресторан\p{L}*|парикмах\p{L}*|перевоз\p{L}*|логист\p{L}*|аренд\p{L}*|пекар\p{L}*|ветеринар\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const REQUEST_QUERY_CUE_RE =
  /(^|[^\p{L}\p{N}])(где|кто|как|по\s*чем|почему|нужен\p{L}*|нужна\p{L}*|нужны|ищу|ищем|подскаж\p{L}*|посовет\p{L}*|заказать\p{L}*|купить\p{L}*|продаж\p{L}*|поставщик\p{L}*|поставьте|нужно\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const COMPANY_LEGAL_FORM_RE =
  /(^|[^\p{L}\p{N}])(ооо|оао|зао|ао|одо|ип|чуп|уп|руп|куп|сооо|llc|inc|ltd)(?=$|[^\p{L}\p{N}])/iu;
const WHOLESALE_CUE_RE =
  /(^|[^\p{L}\p{N}])(опт\p{L}*|крупн\p{L}*\s+опт|паллет\p{L}*|контейнер\p{L}*|поставка\p{L}*\s+парт\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const RETAIL_CUE_RE =
  /(^|[^\p{L}\p{N}])(розниц\p{L}*|в\s+розницу|поштуч\p{L}*|штучн\p{L}*|для\s+себя|в\s+магазин\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
const QUANTITY_RE =
  /(\d+(?:[.,]\d+)?)\s*(кг|килограмм\p{L}*|грамм\p{L}*|гр|тон(?:н(?:а|ы|у)?|а|ы|у)?|тн|т|л|литр\p{L}*|мл|шт|штук\p{L}*|упак\p{L}*|паллет\p{L}*|ящик\p{L}*|м2|м²|м3|м³)/iu;

const REQUEST_STOP_TOKENS = new Set([
  "где",
  "кто",
  "как",
  "какой",
  "какая",
  "какие",
  "можно",
  "нужно",
  "нужен",
  "нужна",
  "нужны",
  "ищу",
  "ищем",
  "подскажите",
  "посоветуйте",
  "пожалуйста",
  "заказать",
  "закажу",
  "купить",
  "куплю",
  "взять",
  "сделать",
  "делает",
  "ребята",
  "найти",
  "поиск",
  "продажа",
  "цена",
  "по",
  "чем",
  "сегодня",
  "завтра",
  "в",
  "во",
  "на",
  "для",
  "и",
  "или",
  "мне",
  "нам",
]);

const FORMAT_STOP_TOKENS = new Set([
  "опт",
  "оптом",
  "розница",
  "розницу",
  "розничный",
  "розничная",
  "поштучно",
  "штучно",
  "кг",
  "гр",
  "т",
  "тн",
  "л",
  "мл",
  "шт",
  "м2",
  "м3",
]);

const KEYWORD_NOISE_TOKENS = new Set([
  "товар",
  "товары",
  "услуга",
  "услуги",
  "компания",
  "компании",
  "купить",
  "заказать",
  "поиск",
  "цена",
]);

const DOMAIN_FOCUS_HINTS = new Set<string>([
  "молочная",
  "сыр",
  "рыба",
  "хлеб",
  "сахар",
  "мясо",
  "овощи",
  "фрукты",
  "доставка",
  "парикмахерская",
  "ветклиника",
  "гостиница",
  "ресторан",
  "кинотеатр",
  "автошкола",
  "туроператор",
  "ремонт",
  "монтаж",
]);

const COLLOQUIAL_REWRITE_RULES: Array<{
  pattern: RegExp;
  terms: string[];
}> = [
  {
    pattern: /(^|[^\p{L}\p{N}])(зелень|салат|укроп|петрушк\p{L}*|кинз\p{L}*|шпинат\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
    terms: ["овощи", "продукты питания", "поставщик", "оптовая торговля", "продовольствие"],
  },
  {
    pattern: /(^|[^\p{L}\p{N}])(вывеск\p{L}*|наружн\p{L}*\s+реклам\p{L}*|лайтбокс\p{L}*|lightbox)(?=$|[^\p{L}\p{N}])/iu,
    terms: ["наружная реклама", "рекламные услуги", "производство вывесок", "полиграфические услуги"],
  },
  {
    pattern: /(^|[^\p{L}\p{N}])(крыш\p{L}*|кровл\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
    terms: ["кровельные работы", "ремонт кровли", "монтаж кровли", "строительные работы"],
  },
];

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenize(raw: string): string[] {
  return tokenizeSemanticText(normalizeText(raw)).filter(Boolean);
}

function canonicalTokens(raw: string): string[] {
  return canonicalizeSemanticTokens(tokenize(raw).filter((token) => token.length >= 2));
}

function isLikelyRequestText(raw: string): boolean {
  const text = normalizeText(raw);
  if (!text) return false;
  if (REQUEST_QUERY_CUE_RE.test(text)) return true;
  return text.split(/\s+/u).filter(Boolean).length >= 5;
}

function isLikelyCompanyQuery(raw: string): boolean {
  const text = normalizeText(raw);
  if (!text) return false;
  if (COMPANY_LEGAL_FORM_RE.test(text)) return true;
  if (REQUEST_QUERY_CUE_RE.test(text)) return false;
  if (PRODUCT_QUERY_TOKEN_RE.test(text)) return false;
  if (SERVICE_QUERY_CUE_RE.test(text)) return false;

  const tokens = tokenize(text);
  if (tokens.length === 0) return false;
  if (tokens.length > 4) return false;

  const hasLatin = /[A-Za-z]/u.test(text);
  if (hasLatin) return true;

  const canonical = canonicalTokens(text);
  if (canonical.length === 1 && DOMAIN_FOCUS_HINTS.has(canonical[0])) return false;
  return tokens.length <= 3;
}

function shouldShiftQueryIntoService(rawQuery: string, rawService: string): boolean {
  if (normalizeText(rawService)) return false;
  const query = normalizeText(rawQuery);
  if (!query) return false;
  if (isLikelyCompanyQuery(query)) return false;
  if (isLikelyRequestText(query)) return true;
  if (PRODUCT_QUERY_TOKEN_RE.test(query) || SERVICE_QUERY_CUE_RE.test(query)) return true;

  const canonical = canonicalTokens(query);
  return canonical.length === 1 && DOMAIN_FOCUS_HINTS.has(canonical[0]);
}

function detectFormat(raw: string): "wholesale" | "retail" | "unspecified" {
  if (!raw) return "unspecified";
  const hasWholesale = WHOLESALE_CUE_RE.test(raw);
  const hasRetail = RETAIL_CUE_RE.test(raw);
  if (hasWholesale && !hasRetail) return "wholesale";
  if (hasRetail && !hasWholesale) return "retail";
  return "unspecified";
}

function detectQuantity(raw: string): string | null {
  const match = normalizeText(raw).match(QUANTITY_RE);
  if (!match) return null;
  const amount = String(match[1] || "").trim();
  const unit = String(match[2] || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!amount || !unit) return null;
  return `${amount} ${unit}`;
}

function dedupeTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const normalized = String(token || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeServiceFocus(raw: string): string {
  const tokens = tokenize(raw)
    .map((token) => token.trim().toLowerCase().replace(/ё/gu, "е"))
    .filter(Boolean)
    .filter((token) => !REQUEST_STOP_TOKENS.has(token))
    .filter((token) => !FORMAT_STOP_TOKENS.has(token))
    .filter((token) => !/^\d+(?:[.,]\d+)?$/u.test(token))
    .filter((token) => token.length >= 2);
  return dedupeTokens(tokens).slice(0, 12).join(" ").trim();
}

function collectColloquialBoostTerms(raw: string): string[] {
  const source = normalizeText(raw);
  if (!source) return [];
  const out: string[] = [];
  for (const rule of COLLOQUIAL_REWRITE_RULES) {
    if (!rule.pattern.test(source)) continue;
    out.push(...rule.terms);
  }
  return dedupeTokens(out).slice(0, 12);
}

function buildKeywords(service: string, rawKeywords: string, extraTerms: string[] = []): string | null {
  const existing = canonicalTokens(rawKeywords).filter((token) => !KEYWORD_NOISE_TOKENS.has(token));
  const serviceCanonical = canonicalTokens(service).filter((token) => !KEYWORD_NOISE_TOKENS.has(token));
  const boostCanonical = canonicalTokens(extraTerms.join(" ")).filter((token) => !KEYWORD_NOISE_TOKENS.has(token));
  const serviceSet = new Set(serviceCanonical);

  const expanded = expandSemanticTokens(serviceCanonical, {
    includeOriginal: false,
    maxPerToken: 4,
  })
    .map((token) => token.trim().toLowerCase().replace(/ё/gu, "е"))
    .filter(Boolean)
    .filter((token) => !KEYWORD_NOISE_TOKENS.has(token))
    .filter((token) => !serviceSet.has(token));

  const merged = dedupeTokens([...existing, ...expanded]).slice(0, 12);
  if (boostCanonical.length > 0) {
    return dedupeTokens([...merged, ...boostCanonical]).slice(0, 12).join(" ") || null;
  }
  if (merged.length === 0) return null;
  return merged.join(" ");
}

function detectIntent(params: {
  query: string;
  service: string;
  keywords: string;
  format: "wholesale" | "retail" | "unspecified";
}): BiznesinfoSearchIntent {
  const query = normalizeText(params.query);
  const service = normalizeText(params.service);
  const text = [query, service, normalizeText(params.keywords)].filter(Boolean).join(" ").trim();

  if (query && !service && isLikelyCompanyQuery(query)) return "company_lookup";

  let productScore = 0;
  let serviceScore = 0;
  if (PRODUCT_QUERY_TOKEN_RE.test(text)) productScore += 2;
  if (SERVICE_QUERY_CUE_RE.test(text)) serviceScore += 2;
  if (params.format !== "unspecified") productScore += 1;

  if (productScore > 0 && serviceScore > 0) return "mixed_lookup";
  if (productScore > serviceScore && productScore > 0) return "product_lookup";
  if (serviceScore > productScore && serviceScore > 0) return "service_lookup";
  if (serviceScore > 0 && productScore > 0) return "mixed_lookup";
  return "generic_lookup";
}

function buildFocusTokens(query: string, service: string, keywords: string): string[] {
  const tokens = canonicalizeSemanticTokens(
    [...tokenize(query), ...tokenize(service), ...tokenize(keywords)].filter((token) => token.length >= 2),
  );
  return tokens
    .filter((token) => !REQUEST_STOP_TOKENS.has(token))
    .filter((token) => !KEYWORD_NOISE_TOKENS.has(token))
    .slice(0, 12);
}

export function understandBiznesinfoSearchQuery(
  input: BiznesinfoSearchQueryInput,
): BiznesinfoSearchQueryUnderstanding {
  let query = normalizeText(input.query);
  let service = normalizeText(input.service);
  const rawKeywords = normalizeText(input.keywords);
  let city = normalizeText(input.city);
  const region = normalizeText(input.region);

  const initialSplit = splitServiceAndCity(service, city || null);
  service = normalizeText(initialSplit.service);
  city = normalizeText(initialSplit.city);

  if (shouldShiftQueryIntoService(query, service)) {
    const shifted = splitServiceAndCity(query, city || null);
    service = normalizeText(shifted.service);
    city = normalizeText(shifted.city);
    query = "";
  }

  const rawIntentSeedText = [query, service, rawKeywords].filter(Boolean).join(" ").trim();
  const colloquialBoostTerms = collectColloquialBoostTerms(rawIntentSeedText);
  const format = detectFormat(rawIntentSeedText);
  const quantity = detectQuantity(rawIntentSeedText);

  const normalizedService = normalizeServiceFocus(service);
  if (normalizedService) service = normalizedService;
  if (!service && colloquialBoostTerms.length > 0) {
    service = normalizeServiceFocus(colloquialBoostTerms[0] || "");
  }

  const keywords = buildKeywords(service, rawKeywords, colloquialBoostTerms) || "";
  const intent = detectIntent({
    query,
    service,
    keywords,
    format,
  });

  const effectiveCity = city || null;
  const effectiveRegion = effectiveCity ? null : (region || null);

  return {
    intent,
    entities: {
      city: effectiveCity,
      region: effectiveRegion,
      format,
      quantity,
      focusTokens: buildFocusTokens(query, service, keywords),
    },
    searchParams: {
      query,
      service,
      keywords: keywords || null,
      city: effectiveCity,
      region: effectiveRegion,
    },
  };
}
