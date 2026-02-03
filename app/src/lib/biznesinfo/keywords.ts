import type { BiznesinfoCompany } from "./types";

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

const DISALLOWED_KEYWORDS = new Set([
  // Per spec: never include price bait words.
  "цена",
  "недорого",
  "дешево",
  "дёшево",
]);

const TRANSACTIONAL_PREFIXES_SERVICE = [
  "заказать",
];

const TRANSACTIONAL_PREFIXES_PRODUCT = [
  "купить",
  "продажа",
];

// 2-3 synonyms per common services/products (extensible)
const SYNONYM_RULES: Array<{ pattern: RegExp; synonyms: string[] }> = [
  {
    pattern: /(прочистк|чистк).*(канализац|труб)|устранен.*засор/iu,
    synonyms: ["прочистка канализации", "чистка труб", "устранение засора"],
  },
  {
    pattern: /(замен|установк).*(смесител|кран)|поменят.*кран/iu,
    synonyms: ["замена смесителя", "установка крана", "поменять кран"],
  },
  {
    pattern: /(ремонт|замен).*(стояк)|ремонт.*труб/iu,
    synonyms: ["ремонт стояков", "замена стояка", "ремонт труб"],
  },
  {
    pattern: /(отоплен|батаре|радиатор|кот[её]л|обогрев)/iu,
    synonyms: ["отопление дома", "замена батарей", "ремонт отопления"],
  },
  {
    pattern: /(кондицион|вентиляц|климатическ)/iu,
    synonyms: ["установка кондиционера", "монтаж вентиляции", "обслуживание кондиционеров"],
  },
  {
    pattern: /(канцтовар|канцеляр)/iu,
    synonyms: ["канцтовары", "офисные принадлежности", "школьные принадлежности"],
  },
];

const SEASON_WINTER_RE = /(отоплен|батаре|радиатор|кот[её]л|обогрев|тепл(ый|ые)\s+пол)/iu;
const SEASON_SUMMER_RE = /(кондицион|вентиляц|охлажден|сплит[- ]?систем)/iu;

const PRODUCT_INDICATORS = [
  // Production / sales
  "производств", "выпуск", "изготовлен", "продаж", "оптов", "рознич",
  "поставк", "реализац", "торгов", "ассортимент", "продукц",
  // Services / works (common wording in dataset descriptions)
  "услуг", "работ", "выполнен", "монтаж", "демонтаж", "ремонт", "строитель",
  "проектир", "обслуживан", "установк", "пусконалад", "наладк",
];

function extractCompanyNameTokens(companyName: string): Set<string> {
  const raw = (companyName || "").trim();
  if (!raw) return new Set();

  const tokens = raw
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(tokens);
}

function normalizeToken(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
}

function normalizePhrase(raw: string): string {
  return normalizeToken(raw)
    .replace(/\s+/gu, " ")
    .replace(/[«»"'“”„]/gu, "")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitToPhrases(raw: string): string[] {
  const cleaned = (raw || "")
    .replace(/\r/gu, "\n")
    .replace(/[•●·]/gu, "\n")
    .replace(/\s*\/\s*/gu, ", ");

  return cleaned
    .split(/[\n,;]+/gu)
    .map((p) => p.trim())
    .filter(Boolean);
}

function tokenizeText(raw: string): string[] {
  const cleaned = normalizeToken(raw)
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return [];

  const out: string[] = [];
  for (const token of cleaned.split(" ").filter(Boolean)) {
    out.push(token);
    if (token.includes("-")) {
      const parts = token.split("-").filter(Boolean);
      for (const part of parts) out.push(part);
    }
  }
  return out;
}

function shouldKeepToken(token: string, opts: { minLen: number; excludeTokens?: Set<string> }): boolean {
  if (!token) return false;
  if (token.length < opts.minLen) return false;
  if (STOP_WORDS.has(token)) return false;
  if (opts.excludeTokens?.has(token)) return false;
  return true;
}

function addTokens(
  target: Set<string>,
  tokens: string[],
  opts: { minLen: number; excludeTokens?: Set<string>; maxNewTokens?: number },
): void {
  let added = 0;
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (!shouldKeepToken(token, opts)) continue;
    const before = target.size;
    target.add(token);
    if (target.size > before) {
      added += 1;
      if (opts.maxNewTokens && added >= opts.maxNewTokens) return;
    }
  }
}

function extractProductKeywords(text: string, excludeTokens?: Set<string>): string[] {
  if (!text) return [];

  const words: string[] = [];
  const lower = normalizeToken(text);

  const sentences = lower.split(/[.;:!?]/);

  for (const sentence of sentences) {
    const hasIndicator = PRODUCT_INDICATORS.some((ind) => sentence.includes(ind));
    if (!hasIndicator) continue;

    const sentenceWords = tokenizeText(sentence)
      .map((w) => normalizeToken(w))
      .filter((w) => shouldKeepToken(w, { minLen: 3, excludeTokens }));

    words.push(...sentenceWords);
  }

  return words;
}

function isAllowedKeywordPhrase(phrase: string): boolean {
  if (!phrase) return false;
  if (phrase.length < 3) return false;
  if (phrase.length > 64) return false;
  for (const banned of DISALLOWED_KEYWORDS) {
    if (phrase.includes(banned)) return false;
  }
  return true;
}

function wordsCount(phrase: string): number {
  return phrase.split(/\s+/u).filter(Boolean).length;
}

function seasonBoost(phrase: string, now: Date): number {
  const month = now.getMonth(); // 0-11
  const isWinter = month === 11 || month === 0 || month === 1 || month === 2;
  const isSummer = month === 5 || month === 6 || month === 7;

  if (SEASON_WINTER_RE.test(phrase)) {
    if (isWinter) return 3;
    if (isSummer) return -2;
    return 0;
  }

  if (SEASON_SUMMER_RE.test(phrase)) {
    if (isSummer) return 3;
    if (isWinter) return -2;
    return 0;
  }

  return 0;
}

function expandSynonyms(phrase: string): string[] {
  const out = new Set<string>();
  const normalized = normalizePhrase(phrase);
  if (!normalized) return [];

  for (const rule of SYNONYM_RULES) {
    if (rule.pattern.test(normalized)) {
      for (const syn of rule.synonyms) out.add(normalizePhrase(syn));
    }
  }

  // Generic verb-based synonyms
  if (normalized.startsWith("монтаж ")) {
    out.add(`установка ${normalized.slice("монтаж ".length)}`.trim());
  }
  if (normalized.startsWith("установка ")) {
    out.add(`монтаж ${normalized.slice("установка ".length)}`.trim());
  }
  if (normalized.startsWith("ремонт ")) {
    out.add(`починка ${normalized.slice("ремонт ".length)}`.trim());
    out.add(`восстановление ${normalized.slice("ремонт ".length)}`.trim());
  }
  if (normalized.startsWith("строительство ")) {
    out.add(`возведение ${normalized.slice("строительство ".length)}`.trim());
    out.add("строительные работы");
  }

  return Array.from(out).filter(Boolean);
}

function simplifyActivityPhrase(raw: string): string {
  let phrase = normalizePhrase(raw);
  if (!phrase) return "";

  phrase = phrase
    .replace(/^(выполнение|оказание|предоставление|осуществление)\s+(функций?\s+)?/iu, "")
    .replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/giu, "")
    .replace(/\b\d+([-/]\d+)?\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return phrase;
}

function looksLikeUsefulPhrase(phrase: string): boolean {
  if (!phrase) return false;
  if (!/[a-zа-яё]/iu.test(phrase)) return false;
  if (wordsCount(phrase) > 6) return false;

  const tokens = phrase.split(/\s+/u).filter(Boolean);
  const meaningfulTokens = tokens.filter((t) => !STOP_WORDS.has(t));
  if (meaningfulTokens.length === 0) return false;
  // Allow short noun phrases (e.g., "канцтовары", "офисная бумага").
  if (tokens.length <= 3) return true;

  const triggers = [
    "монтаж",
    "установка",
    "ремонт",
    "строительство",
    "возведение",
    "проектирование",
    "обслуживание",
    "доставка",
    "аренда",
    "продажа",
    "поставка",
    "изготовление",
    "производство",
  ];

  if (triggers.some((t) => phrase.includes(t))) return true;
  if (phrase.endsWith("работы") || phrase.endsWith("услуги")) return true;
  return false;
}

function selectTopPhrases(candidates: Array<{ phrase: string; score: number }>, max: number): string[] {
  const selected: string[] = [];
  const selectedTokens = new Set<string>();

  const isTooSimilar = (phrase: string): boolean => {
    const tokens = phrase.split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) return true;
    const tokenKey = tokens.slice(0, 3).join(" ");
    if (selectedTokens.has(tokenKey)) return true;

    for (const existing of selected) {
      if (existing === phrase) return true;
      if (existing.includes(phrase) || phrase.includes(existing)) {
        // Avoid near-duplicates like "монтаж вентиляции" vs "заказать монтаж вентиляции".
        const a = existing.split(/\s+/u).filter(Boolean);
        const b = phrase.split(/\s+/u).filter(Boolean);
        const common = a.filter((t) => b.includes(t)).length;
        if (common >= Math.min(2, Math.min(a.length, b.length))) return true;
      }
    }

    return false;
  };

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  for (const item of sorted) {
    if (selected.length >= max) break;
    const phrase = item.phrase;
    if (!isAllowedKeywordPhrase(phrase)) continue;
    if (isTooSimilar(phrase)) continue;

    const tokens = phrase.split(/\s+/u).filter(Boolean);
    selectedTokens.add(tokens.slice(0, 3).join(" "));
    selected.push(phrase);
  }

  return selected;
}

export function generateCompanyKeywordPhrases(
  company: BiznesinfoCompany,
  opts?: {
    maxKeywords?: number;
    now?: Date;
    volumeLookup?: (_phrase: string) => number | null | undefined;
  },
): string[] {
  const maxKeywords = Math.max(1, Math.min(50, opts?.maxKeywords ?? 10));
  const now = opts?.now ?? new Date();
  const volumeLookup = opts?.volumeLookup;

  const candidates: Array<{ phrase: string; score: number }> = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string, baseScore: number) => {
    const phrase = normalizePhrase(raw);
    if (!phrase) return;
    if (!isAllowedKeywordPhrase(phrase)) return;
    if (!looksLikeUsefulPhrase(phrase)) return;
    const key = phrase;
    if (seen.has(key)) return;
    seen.add(key);

    const volume = volumeLookup ? volumeLookup(phrase) : null;
    const volumeScore = volume && volume > 0 ? Math.log10(volume + 1) * 4 : 0;

    const lengthPenalty = Math.max(0, wordsCount(phrase) - 3) * 0.5;
    const score = baseScore + volumeScore + seasonBoost(phrase, now) - lengthPenalty;

    candidates.push({ phrase, score });
  };

  const serviceBase: string[] = [];
  for (const item of company.services_list || []) {
    for (const part of splitToPhrases(item?.name || "")) {
      const phrase = simplifyActivityPhrase(part);
      if (!phrase) continue;
      serviceBase.push(phrase);
    }
  }

  const productBase: string[] = [];
  for (const item of company.products || []) {
    for (const part of splitToPhrases(item?.name || "")) {
      const phrase = normalizePhrase(part);
      if (!phrase) continue;
      productBase.push(phrase);
    }
  }

  const descriptionPhrases: string[] = [];
  for (const part of splitToPhrases((company.description || "").replace(/[.!?]+/gu, "\n"))) {
    const phrase = simplifyActivityPhrase(part);
    if (!phrase) continue;
    if (looksLikeUsefulPhrase(phrase)) descriptionPhrases.push(phrase);
  }

  const aboutPhrases: string[] = [];
  for (const part of splitToPhrases((company.about || "").replace(/[.!?]+/gu, "\n"))) {
    const phrase = simplifyActivityPhrase(part);
    if (!phrase) continue;
    if (looksLikeUsefulPhrase(phrase)) aboutPhrases.push(phrase);
  }

  // 1) Services (highest priority)
  for (const phrase of serviceBase.slice(0, 12)) {
    addCandidate(phrase, 100);
    for (const syn of expandSynonyms(phrase).slice(0, 3)) addCandidate(syn, 92);
    for (const prefix of TRANSACTIONAL_PREFIXES_SERVICE) addCandidate(`${prefix} ${phrase}`, 88);
  }

  // 2) Products (if any)
  for (const phrase of productBase.slice(0, 12)) {
    addCandidate(phrase, 96);
    for (const syn of expandSynonyms(phrase).slice(0, 2)) addCandidate(syn, 90);
    for (const prefix of TRANSACTIONAL_PREFIXES_PRODUCT) addCandidate(`${prefix} ${phrase}`, 86);
    addCandidate(`купить оптом ${phrase}`, 78);
  }

  // 3) What the company does (description/about)
  const textBoost = serviceBase.length > 0 || productBase.length > 0 ? 70 : 92;
  for (const phrase of descriptionPhrases.slice(0, 16)) addCandidate(phrase, textBoost);
  for (const phrase of aboutPhrases.slice(0, 16)) addCandidate(phrase, textBoost - 2);

  // 4) General sphere (rubrics/categories)
  for (const r of company.rubrics || []) addCandidate(normalizePhrase(r?.name || ""), 60);
  for (const c of company.categories || []) addCandidate(normalizePhrase(c?.name || ""), 55);

  return selectTopPhrases(candidates, Math.min(maxKeywords, 10));
}

export function generateCompanyKeywordsString(company: BiznesinfoCompany, opts?: Parameters<typeof generateCompanyKeywordPhrases>[1]): string {
  return generateCompanyKeywordPhrases(company, opts).join(", ");
}

export function generateCompanyKeywords(company: BiznesinfoCompany): string[] {
  const keywordsSet = new Set<string>();
  const companyNameTokens = extractCompanyNameTokens(company.name || "");

  for (const rubric of company.rubrics || []) {
    addTokens(keywordsSet, tokenizeText(rubric.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
  }

  for (const cat of company.categories || []) {
    addTokens(keywordsSet, tokenizeText(cat.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
  }

  // Structured products/services
  for (const item of company.products || []) {
    addTokens(keywordsSet, tokenizeText(item?.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
    addTokens(keywordsSet, tokenizeText(item?.description || ""), {
      minLen: 3,
      excludeTokens: companyNameTokens,
      maxNewTokens: 24,
    });
  }

  for (const item of company.services_list || []) {
    addTokens(keywordsSet, tokenizeText(item?.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
    addTokens(keywordsSet, tokenizeText(item?.description || ""), {
      minLen: 3,
      excludeTokens: companyNameTokens,
      maxNewTokens: 24,
    });
  }

  // Free-text description/about: indicator-based extraction + small general fallback
  addTokens(keywordsSet, extractProductKeywords(company.description || "", companyNameTokens), { minLen: 3 });
  addTokens(keywordsSet, extractProductKeywords(company.about || "", companyNameTokens), { minLen: 3 });

  addTokens(keywordsSet, tokenizeText(company.description || ""), {
    minLen: 3,
    excludeTokens: companyNameTokens,
    maxNewTokens: 48,
  });
  addTokens(keywordsSet, tokenizeText(company.about || ""), {
    minLen: 3,
    excludeTokens: companyNameTokens,
    maxNewTokens: 48,
  });

  return Array.from(keywordsSet);
}
