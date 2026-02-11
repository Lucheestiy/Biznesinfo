import type { BiznesinfoCompany } from "./types";
import synonymRulesJson from "./keyword_synonyms.ru.json";
import geoDictionaryJson from "./keyword_geo.ru.json";

export type KeywordFallbackMode = "rubrics" | "short";

export interface KeywordGenerationOptions {
  maxKeywords?: number;
  strictStats?: boolean;
  fallbackMode?: KeywordFallbackMode;
  volumeLookup?: (_phrase: string) => number | null | undefined;
  volumeMap?: ReadonlyMap<string, number>;
}

interface KeywordSynonymRule {
  match: string[];
  synonyms: string[];
}

interface KeywordGeoDictionary {
  countries: string[];
  cities: string[];
}

type KeywordCandidateSource = "service" | "product" | "aux_text" | "rubric" | "category";

interface KeywordCandidate {
  phrase: string;
  source: KeywordCandidateSource;
  score: number;
  volume: number;
}

const STOP_WORDS = new Set([
  "и", "в", "на", "с", "по", "для", "из", "к", "от", "до", "о", "об", "при",
  "за", "под", "над", "без", "через", "между", "а", "но", "или", "либо", "как",
  "что", "это", "так", "же", "бы", "ли", "не", "ни", "да", "нет", "мы", "вы",
  "они", "он", "она", "оно", "их", "ее", "его", "наш", "ваш", "тот", "эта",
  "эти", "то", "все", "вся", "все", "компания", "организация", "предприятие",
]);

const EDGE_TRIM_WORDS = new Set([
  ...STOP_WORDS,
  "выполняет", "выполнение", "оказывает", "оказание", "предоставляет", "предоставление",
  "осуществляет", "осуществление", "занимается", "занимались", "занимается", "предлагает",
  "также", "еще", "еще", "основное", "основные", "направление", "направления",
  "бренд", "бренды",
]);

const GENERIC_SINGLE_WORDS = new Set([
  "услуги",
  "работы",
  "производство",
  "изготовление",
  "продажа",
  "поставка",
  "доставка",
  "строительство",
  "ремонт",
  "монтаж",
  "установка",
  "обслуживание",
  "аренда",
  "товар",
  "товары",
  "продукт",
  "продукты",
  "продукция",
  "бренд",
  "бренды",
]);

const GENERIC_SUBJECT_STEMS = [
  "бренд",
  "продукт",
  "продукц",
  "товар",
  "ассортимент",
  "линейк",
];

const RUBRIC_CATEGORY_SINGLE_WORD_BLOCKLIST = new Set([
  "транспорт",
  "логистика",
  "недвижимость",
  "строительство",
  "сооружений",
  "зданий",
  "апк",
  "сельское",
  "лесное",
  "сырье",
  "химия",
  "энергетика",
  "системы",
]);

const DISALLOWED_WORDS = new Set([
  "цена",
  "недорого",
  "дешево",
]);

const DISALLOWED_STEMS = [
  "цен",
  "недорог",
  "дешев",
];

const ACTIVITY_TRIGGER_STEMS = [
  "продаж",
  "поставк",
  "покупк",
  "куп",
  "заказ",
  "монтаж",
  "установ",
  "ремонт",
  "строитель",
  "обслужив",
  "изготов",
  "производ",
  "аренд",
  "достав",
  "услуг",
  "работ",
];

const AUXILIARY_FORBIDDEN_TOKENS = new Set([
  "история",
  "исторический",
  "образованное",
  "образована",
  "образован",
  "образовано",
  "году",
  "год",
  "реконструкция",
  "корпуса",
  "корпус",
  "цех",
  "цеха",
  "отдел",
  "отделы",
  "география",
  "доля",
  "выручки",
  "выручка",
  "вес",
  "покупателей",
  "покупатель",
  "группа",
  "группу",
  "составляют",
  "составляет",
]);

const AUXILIARY_FORBIDDEN_STEMS = [
  "образован",
  "реконструкц",
  "достраив",
  "реконструир",
  "выруч",
  "покупател",
  "составля",
  "групп",
  "дол",
];

const AUX_PRODUCT_HINT_STEMS = [
  "молок",
  "кефир",
  "масл",
  "творог",
  "творож",
  "сметан",
  "йогурт",
  "сливк",
  "ряженк",
  "простокваш",
  "бифид",
  "морожен",
  "детск",
  "питани",
  "смес",
  "сыворот",
  "сыр",
];

const CALLBACK_SERVICE_STEMS = [
  "сантехник",
  "электрик",
  "авар",
  "замок",
  "канализац",
  "труб",
  "мастер",
  "эвакуатор",
  "грузчик",
];

const SOURCE_PRIORITY: Record<KeywordCandidateSource, number> = {
  service: 5,
  product: 4,
  aux_text: 3,
  rubric: 2,
  category: 1,
};

const TRANSACTIONAL_PREFIX_RE = /^(купить оптом|покупка оптом|купить|покупка|продажа|заказать|вызвать|услуги)\s+/u;
const MAX_VARIANTS_PER_CORE = 1;

const SYNONYM_RULES = (synonymRulesJson as KeywordSynonymRule[])
  .map((rule) => ({
    match: (rule.match || []).map((v) => normalizeKeywordPhrase(v)).filter(Boolean),
    synonyms: (rule.synonyms || []).map((v) => normalizeKeywordPhrase(v)).filter(Boolean),
  }))
  .filter((rule) => rule.match.length > 0 && rule.synonyms.length > 0);

const GEO_DICTIONARY = geoDictionaryJson as KeywordGeoDictionary;
const GEO_COUNTRY_PHRASES = (GEO_DICTIONARY.countries || [])
  .map((v) => normalizeKeywordPhrase(v))
  .filter(Boolean);
const GEO_CITY_PHRASES = (GEO_DICTIONARY.cities || [])
  .map((v) => normalizeKeywordPhrase(v))
  .filter(Boolean);
const GEO_PHRASES = new Set([...GEO_COUNTRY_PHRASES, ...GEO_CITY_PHRASES]);
const GEO_TOKENS = new Set(
  Array.from(GEO_PHRASES)
    .flatMap((phrase) => phrase.split(" "))
    .map((token) => token.trim())
    .filter(Boolean),
);

function decodeHtmlEntities(raw: string): string {
  return (raw || "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#34;/gu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function hasActivityTriggerToken(token: string): boolean {
  const t = (token || "").trim();
  if (!t) return false;
  return ACTIVITY_TRIGGER_STEMS.some((stem) => t.startsWith(stem));
}

function hasActivityTrigger(phrase: string): boolean {
  return phrase
    .split(/\s+/u)
    .filter(Boolean)
    .some((token) => hasActivityTriggerToken(token));
}

function hasAuxProductHintToken(token: string): boolean {
  const t = (token || "").trim();
  if (!t) return false;
  if (t.startsWith("сырь")) return false;
  return AUX_PRODUCT_HINT_STEMS.some((stem) => t.startsWith(stem));
}

function hasAuxProductHint(phrase: string): boolean {
  return phrase
    .split(/\s+/u)
    .filter(Boolean)
    .some((token) => hasAuxProductHintToken(token));
}

function wordsCount(phrase: string): number {
  return phrase.split(/\s+/u).filter(Boolean).length;
}

function parseVolume(value: number | null | undefined): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num;
}

function normalizeCorePhrase(phrase: string): string {
  return normalizeKeywordPhrase((phrase || "").replace(TRANSACTIONAL_PREFIX_RE, "").trim());
}

function normalizeForLookup(phrase: string): string {
  return normalizeKeywordPhrase(phrase);
}

function buildVolumeLookup(opts?: KeywordGenerationOptions): ((_phrase: string) => number) | null {
  if (opts?.volumeLookup) {
    return (phrase: string) => parseVolume(opts.volumeLookup?.(normalizeForLookup(phrase)));
  }

  if (opts?.volumeMap && opts.volumeMap.size > 0) {
    return (phrase: string) => parseVolume(opts.volumeMap?.get(normalizeForLookup(phrase)));
  }

  return null;
}

function splitRawToParts(raw: string): string[] {
  const text = decodeHtmlEntities(raw || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[•●·▪‣◦]/gu, "\n")
    .replace(/\s*\/\s*/gu, "\n")
    .replace(/[\r\f\v]+/gu, "\n");

  return text
    .split(/[\n,;|]+/gu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripBrandDecorations(raw: string): string {
  return (raw || "")
    .replace(/«[^»]{1,120}»/gu, " ")
    .replace(/"[^"]{1,120}"/gu, " ")
    .replace(/„[^“]{1,120}“/gu, " ")
    .replace(/\([^)]{1,120}\)/gu, " ");
}

function expandConjunctivePhrase(raw: string): string[] {
  const rawNormalized = normalizeKeywordPhrase(raw);
  if (!rawNormalized) return [];

  const tokensWithConjunction = trimEdgeWords(rawNormalized.split(/\s+/u).filter(Boolean));
  const normalized = normalizePhraseCandidate(tokensWithConjunction.join(" "));
  if (!normalized) return [];
  if (tokensWithConjunction.length < 3) return [normalized];

  const andIndexes: number[] = [];
  for (let i = 0; i < tokensWithConjunction.length; i += 1) {
    if (tokensWithConjunction[i] === "и") andIndexes.push(i);
  }

  if (andIndexes.length !== 1) return [normalized];
  const idx = andIndexes[0];
  if (idx <= 0 || idx >= tokensWithConjunction.length - 1) return [normalized];

  const leftTokens = tokensWithConjunction.slice(0, idx);
  const rightTokens = tokensWithConjunction.slice(idx + 1);

  const left = normalizePhraseCandidate(leftTokens.join(" "));
  let right = normalizePhraseCandidate(rightTokens.join(" "));
  if (rightTokens.length === 1 && leftTokens.length >= 2) {
    let genericExpanded = "";
    if (leftTokens.length >= 3) {
      const leftPrefix = leftTokens.slice(0, -1).join(" ");
      genericExpanded = normalizePhraseCandidate(`${leftPrefix} ${rightTokens[0]}`);
    }
    if (genericExpanded) right = genericExpanded;

    const head = leftTokens[0];
    if (!genericExpanded && hasActivityTriggerToken(head)) {
      const expanded = normalizePhraseCandidate(`${head} ${rightTokens[0]}`);
      if (expanded) right = expanded;
    }
  }

  const out = new Set<string>();
  if (left) out.add(left);
  if (right) out.add(right);
  if (out.size === 0) out.add(normalized);
  return Array.from(out);
}

function tokenize(raw: string): string[] {
  const normalized = normalizeKeywordPhrase(raw);
  if (!normalized) return [];
  return normalized.split(/\s+/u).filter(Boolean);
}

export function normalizeKeywordPhrase(raw: string): string {
  return decodeHtmlEntities(raw || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'`“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function trimEdgeWords(tokens: string[]): string[] {
  let left = 0;
  let right = tokens.length - 1;

  while (left <= right && EDGE_TRIM_WORDS.has(tokens[left])) left += 1;
  while (right >= left && EDGE_TRIM_WORDS.has(tokens[right])) right -= 1;

  return tokens.slice(left, right + 1);
}

function containsGeo(phrase: string, contextGeoTokens: Set<string>): boolean {
  const padded = ` ${phrase} `;

  for (const geo of GEO_PHRASES) {
    const geoPadded = ` ${geo} `;
    if (padded.includes(geoPadded)) return true;
  }

  for (const token of phrase.split(/\s+/u)) {
    if (!token) continue;
    if (GEO_TOKENS.has(token)) return true;
    if (contextGeoTokens.has(token)) return true;
  }

  return false;
}

function containsYearOrNumbers(phrase: string): boolean {
  if (/\d/gu.test(phrase)) return true;
  if (/\b(19|20)\d{2}\b/gu.test(phrase)) return true;
  if (/\b[а-яa-z]{1,3}\d{2,}\b/giu.test(phrase)) return true;
  if (/\b\d{2,}[а-яa-z]{1,3}\b/giu.test(phrase)) return true;
  return false;
}

function containsAuxiliaryJunk(phrase: string): boolean {
  const tokens = phrase.split(/\s+/u).filter(Boolean);
  for (const token of tokens) {
    if (AUXILIARY_FORBIDDEN_TOKENS.has(token)) return true;
    if (AUXILIARY_FORBIDDEN_STEMS.some((stem) => token.startsWith(stem))) return true;
  }
  return false;
}

function containsDisallowedWord(phrase: string): boolean {
  const tokens = phrase.split(/\s+/u).filter(Boolean);
  return tokens.some((token) => {
    if (DISALLOWED_WORDS.has(token)) return true;
    return DISALLOWED_STEMS.some((stem) => token.startsWith(stem));
  });
}

function hasMeaningfulTokens(phrase: string): boolean {
  const tokens = phrase.split(/\s+/u).filter(Boolean);
  const meaningful = tokens.filter((token) => !STOP_WORDS.has(token));
  if (meaningful.length === 0) return false;
  if (meaningful.length === 1 && GENERIC_SINGLE_WORDS.has(meaningful[0])) return false;
  return true;
}

function isGenericSubjectToken(token: string): boolean {
  const t = (token || "").trim();
  if (!t) return true;
  return GENERIC_SUBJECT_STEMS.some((stem) => t.startsWith(stem));
}

function hasSpecificSubject(phrase: string): boolean {
  const core = normalizeCorePhrase(phrase) || phrase;
  const tokens = core
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token));
  if (tokens.length === 0) return false;
  return tokens.some((token) => !isGenericSubjectToken(token));
}

function isSafeKeywordPhrase(
  phrase: string,
  source: KeywordCandidateSource,
  contextGeoTokens: Set<string>,
  contextCompanyTokens: Set<string>,
): boolean {
  if (!phrase) return false;
  if (!/[a-zа-я]/iu.test(phrase)) return false;
  if (wordsCount(phrase) > 6) return false;
  if (containsDisallowedWord(phrase)) return false;
  if (containsYearOrNumbers(phrase)) return false;
  if (containsGeo(phrase, contextGeoTokens)) return false;
  if (!hasMeaningfulTokens(phrase)) return false;
  if (source !== "rubric" && source !== "category" && !hasSpecificSubject(phrase)) return false;

  if (source === "aux_text" && containsAuxiliaryJunk(phrase)) return false;
  if (source === "aux_text") {
    const tokens = phrase.split(/\s+/u).filter(Boolean);
    if (tokens.some((token) => contextCompanyTokens.has(token))) return false;
  }
  return true;
}

function normalizePhraseCandidate(raw: string): string {
  const phrase = normalizeKeywordPhrase(raw);
  if (!phrase) return "";
  const tokens = trimEdgeWords(
    phrase
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => token.length > 1 || /^\d+$/u.test(token)),
  );
  if (tokens.length === 0) return "";
  return tokens.join(" ");
}

function collectStructuredPhrases(items: Array<{ name?: string; description?: string }>): string[] {
  const out = new Set<string>();

  for (const item of items || []) {
    const sanitizedName = stripBrandDecorations(item?.name || "");
    for (const part of splitRawToParts(sanitizedName)) {
      for (const variant of expandConjunctivePhrase(part)) {
        if (!variant) continue;
        if (wordsCount(variant) > 6) continue;
        out.add(variant);
      }
    }

    for (const part of splitRawToParts(item?.description || "").slice(0, 3)) {
      for (const variant of expandConjunctivePhrase(part)) {
        if (!variant) continue;
        if (wordsCount(variant) > 6) continue;
        if (!hasActivityTrigger(variant)) continue;
        out.add(variant);
      }
    }
  }

  return Array.from(out);
}

function extractActivityPhrasesFromText(raw: string): string[] {
  const text = decodeHtmlEntities(raw || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\r\f\v]+/gu, "\n")
    .replace(/[•●·▪‣◦]/gu, "\n");

  const sentences = text
    .split(/[\n.!?;:]+/gu)
    .map((s) => normalizeKeywordPhrase(s))
    .filter(Boolean);

  const out = new Set<string>();

  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;

    for (let i = 0; i < tokens.length; i += 1) {
      if (!hasActivityTriggerToken(tokens[i])) continue;

      const start = Math.max(0, i - 1);
      const end = Math.min(tokens.length, start + 6);
      const slice = trimEdgeWords(tokens.slice(start, end));
      if (slice.length === 0) continue;
      if (slice.length > 6) continue;

      const phrase = slice.join(" ");
      if (!hasActivityTrigger(phrase)) continue;
      out.add(phrase);
    }

    if (tokens.length <= 6 && hasActivityTrigger(sentence)) {
      const whole = trimEdgeWords(tokens).join(" ");
      if (whole) out.add(whole);
    }
  }

  return Array.from(out);
}

function normalizeAuxProductListItem(raw: string): string {
  const cleaned = (raw || "")
    .replace(/\bи\s+т\.?\s*д\.?\b/giu, " ")
    .replace(/\bи\s+др\.?\b/giu, " ")
    .replace(/\bи\s+друг(?:ое|ие)\b/giu, " ")
    .replace(/\bт\.?\s*д\.?\b/giu, " ")
    .replace(/\bпроч(?:ее|ие)\b/giu, " ")
    .replace(/[()]/gu, " ");

  const normalized = normalizePhraseCandidate(cleaned);
  if (!normalized) return "";
  if (wordsCount(normalized) > 4) return "";
  if (!hasAuxProductHint(normalized)) return "";
  return normalized;
}

function extractRepeatedHeadListPhrases(raw: string): string[] {
  const parts = splitRawToParts(raw || "");
  if (parts.length === 0) return [];

  const normalizedParts = parts
    .map((part) => normalizePhraseCandidate(part))
    .filter(Boolean)
    .filter((phrase) => wordsCount(phrase) <= 5);
  if (normalizedParts.length === 0) return [];

  const headStemCount = new Map<string, number>();
  const partHeadStem = new Map<string, string>();

  for (const phrase of normalizedParts) {
    const tokens = phrase.split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;
    const head = tokens[0];
    if (STOP_WORDS.has(head)) continue;
    if (isGenericSubjectToken(head)) continue;
    if (hasActivityTriggerToken(head)) continue;
    if (head.length < 3) continue;

    const stem = head.slice(0, 3);
    partHeadStem.set(phrase, stem);
    headStemCount.set(stem, (headStemCount.get(stem) || 0) + 1);
  }

  const dominantStems = new Set(
    Array.from(headStemCount.entries())
      .filter(([, count]) => count >= 3)
      .map(([stem]) => stem),
  );
  if (dominantStems.size === 0) return [];

  const out = new Set<string>();
  for (const phrase of normalizedParts) {
    const stem = partHeadStem.get(phrase);
    if (!stem || !dominantStems.has(stem)) continue;
    out.add(phrase);
  }

  return Array.from(out);
}

function extractProductListPhrasesFromText(raw: string): string[] {
  const text = decodeHtmlEntities(raw || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .replace(/ё/gu, "е");

  const out = new Set<string>();
  const parentheticalRe = /\(([^()]{2,200})\)/gu;
  let match: RegExpExecArray | null = null;

  while ((match = parentheticalRe.exec(text)) !== null) {
    const listRaw = (match[1] || "").trim();
    if (!listRaw) continue;

    const ctxStart = Math.max(0, match.index - 90);
    const leftContext = text.slice(ctxStart, match.index);
    if (!/(продукц|ассортимент|линейк|питани|выпуска|производ|молоч)/u.test(leftContext)) continue;

    const chunks = listRaw
      .split(/[;,/]+/u)
      .flatMap((chunk) => chunk.split(/\s+\bи\b\s+/u));

    for (const chunk of chunks) {
      const item = normalizeAuxProductListItem(chunk);
      if (!item) continue;
      out.add(item);
    }
  }

  const normalizedText = normalizeKeywordPhrase(raw || "");
  if (/сух[а-я]*\s+детск[а-я]*\s+питани[а-я]*/u.test(normalizedText)) {
    out.add("сухое детское питание");
  } else if (/детск[а-я]*\s+питани[а-я]*/u.test(normalizedText)) {
    out.add("детское питание");
  }

  return Array.from(out);
}

function hasFoodIndustryTaxonomy(company: BiznesinfoCompany): boolean {
  const taxonomyProbe = normalizeKeywordPhrase([
    ...(company.categories || []).map((entry) => entry?.name || ""),
    ...(company.rubrics || []).map((entry) => entry?.name || ""),
  ].join(" "));

  if (!taxonomyProbe) return false;

  return /(пищев|молоч|мясн|рыбн|хлеб|кондитер|продукты питания|напитк|консерв|масложиров|маслосыр|морожен|сыр(?!ь)[а-я]*)/u
    .test(taxonomyProbe);
}

function expandSynonyms(phrase: string): string[] {
  const base = normalizeKeywordPhrase(phrase);
  if (!base) return [];

  const out = new Set<string>();

  for (const rule of SYNONYM_RULES) {
    const matched = rule.match.some((probe) =>
      probe === base || base.includes(probe) || probe.includes(base),
    );
    if (!matched) continue;
    for (const synonym of rule.synonyms) out.add(synonym);
  }

  if (base.startsWith("монтаж ")) {
    out.add(`установка ${base.slice("монтаж ".length)}`.trim());
  }
  if (base.startsWith("установка ")) {
    out.add(`монтаж ${base.slice("установка ".length)}`.trim());
  }
  if (base.startsWith("прочистка ")) {
    out.add(`чистка ${base.slice("прочистка ".length)}`.trim());
  }
  if (base.startsWith("чистка ")) {
    out.add(`прочистка ${base.slice("чистка ".length)}`.trim());
  }
  if (base.startsWith("ремонт ")) {
    out.add(`обслуживание ${base.slice("ремонт ".length)}`.trim());
  }

  return Array.from(out)
    .map((item) => normalizePhraseCandidate(item))
    .filter(Boolean)
    .slice(0, 3);
}

function shouldAddCallPhrase(servicePhrase: string): boolean {
  const tokens = tokenize(servicePhrase);
  return tokens.some((token) => CALLBACK_SERVICE_STEMS.some((stem) => token.startsWith(stem)));
}

function candidateSort(a: KeywordCandidate, b: KeywordCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.volume !== a.volume) return b.volume - a.volume;
  if (SOURCE_PRIORITY[b.source] !== SOURCE_PRIORITY[a.source]) {
    return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  }
  if (wordsCount(a.phrase) !== wordsCount(b.phrase)) {
    return wordsCount(a.phrase) - wordsCount(b.phrase);
  }
  return a.phrase.localeCompare(b.phrase, "ru", { sensitivity: "base" });
}

function selectTopPhrases(
  candidates: KeywordCandidate[],
  max: number,
  alreadySelected: string[] = [],
): string[] {
  const selected = [...alreadySelected];
  const selectedSet = new Set(selected);
  const variantCountByCore = new Map<string, number>();

  for (const phrase of selected) {
    const core = normalizeCorePhrase(phrase) || phrase;
    variantCountByCore.set(core, (variantCountByCore.get(core) || 0) + 1);
  }

  const sorted = [...candidates].sort(candidateSort);
  for (const candidate of sorted) {
    if (selected.length >= max) break;
    if (selectedSet.has(candidate.phrase)) continue;

    const core = normalizeCorePhrase(candidate.phrase) || candidate.phrase;
    const existingVariants = variantCountByCore.get(core) || 0;
    if (existingVariants >= MAX_VARIANTS_PER_CORE) continue;

    selected.push(candidate.phrase);
    selectedSet.add(candidate.phrase);
    variantCountByCore.set(core, existingVariants + 1);
  }

  return selected.slice(0, max);
}

function extractContextGeoTokens(company: BiznesinfoCompany): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(company.city || "")) tokens.add(token);
  for (const token of tokenize(company.region || "")) tokens.add(token);
  for (const token of tokenize(company.country || "")) tokens.add(token);
  return tokens;
}

function extractCompanyIdentityTokens(company: BiznesinfoCompany): Set<string> {
  const out = new Set<string>();
  const legalFormTokens = new Set(["ооо", "оао", "зао", "ао", "ип", "чуп", "уп", "гп", "кусхп"]);

  for (const token of tokenize(company.name || "")) {
    if (token.length < 4) continue;
    if (legalFormTokens.has(token)) continue;
    out.add(token);
  }

  for (const token of normalizeKeywordPhrase(company.source_id || "").split(/\s+/u).filter(Boolean)) {
    if (token.length < 4) continue;
    out.add(token);
  }

  return out;
}

function collectRubricCategoryPhrases(company: BiznesinfoCompany): Array<{ phrase: string; source: "rubric" | "category" }> {
  const out: Array<{ phrase: string; source: "rubric" | "category" }> = [];
  const seen = new Set<string>();

  const pushPhrase = (phrase: string, source: "rubric" | "category") => {
    const normalized = normalizePhraseCandidate(phrase);
    if (!normalized) return;
    if (wordsCount(normalized) > 6) return;
    if (wordsCount(normalized) === 1 && RUBRIC_CATEGORY_SINGLE_WORD_BLOCKLIST.has(normalized)) return;
    const key = `${source}::${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ phrase: normalized, source });
  };

  for (const rubric of company.rubrics || []) {
    const sanitized = stripBrandDecorations(rubric?.name || "");
    for (const part of splitRawToParts(sanitized)) {
      for (const variant of expandConjunctivePhrase(part)) {
        pushPhrase(variant, "rubric");
      }
    }
  }

  for (const category of company.categories || []) {
    const sanitized = stripBrandDecorations(category?.name || "");
    for (const part of splitRawToParts(sanitized)) {
      for (const variant of expandConjunctivePhrase(part)) {
        pushPhrase(variant, "category");
      }
    }
  }

  return out;
}

function buildCandidateScore(baseScore: number, volume: number, phrase: string): number {
  const volumeBoost = volume > 0 ? Math.log10(volume + 1) * 8 : 0;
  const lengthPenalty = Math.max(0, wordsCount(phrase) - 3) * 0.4;
  return baseScore + volumeBoost - lengthPenalty;
}

function hasCargoSignal(company: BiznesinfoCompany): boolean {
  const probeParts: string[] = [];

  for (const rubric of company.rubrics || []) {
    probeParts.push(rubric?.name || "");
  }
  for (const category of company.categories || []) {
    probeParts.push(category?.name || "");
  }
  for (const service of company.services_list || []) {
    probeParts.push(service?.name || "");
    probeParts.push(service?.description || "");
  }
  for (const product of company.products || []) {
    probeParts.push(product?.name || "");
    probeParts.push(product?.description || "");
  }

  const probe = normalizeKeywordPhrase(probeParts.join(" "));
  if (!probe) return false;

  return /(груз[а-я]*|экспедир[а-я]*|грузоперевоз[а-я]*)/iu.test(probe);
}

function canUsePostProcessedPhrase(
  phrase: string,
  strictStatsActive: boolean,
  volumeLookup: ((_phrase: string) => number) | null,
): boolean {
  if (!strictStatsActive) return true;
  if (!volumeLookup) return false;
  return volumeLookup(phrase) > 0;
}

function refineSelectedKeywordPhrases(
  selected: string[],
  company: BiznesinfoCompany,
  strictStatsActive: boolean,
  volumeLookup: ((_phrase: string) => number) | null,
): string[] {
  const out = [...selected];
  const hasCargo = hasCargoSignal(company);

  if (hasCargo) {
    const idx = out.indexOf("перевозки");
    if (
      idx >= 0
      && !out.includes("перевозки грузов")
      && canUsePostProcessedPhrase("перевозки грузов", strictStatsActive, volumeLookup)
    ) {
      out[idx] = "перевозки грузов";
    }
  }

  if (out.includes("транспортные услуги")) {
    const idx = out.indexOf("транспорт");
    if (idx >= 0) out.splice(idx, 1);
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const phrase of out) {
    if (!phrase) continue;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    deduped.push(phrase);
  }

  return deduped;
}

function ensureBuyIntentKeywords(
  selected: string[],
  candidates: KeywordCandidate[],
  strictStatsActive: boolean,
): string[] {
  const MIN_BUY_KEYWORDS = 2;
  const out = [...selected];
  const existingBuyCount = out.filter((phrase) => phrase.startsWith("купить ")).length;
  if (existingBuyCount >= MIN_BUY_KEYWORDS) return out;

  const candidateByPhrase = new Map(candidates.map((candidate) => [candidate.phrase, candidate]));
  const outSet = new Set(out);

  const convertible: Array<{ idx: number; buyPhrase: string; saleScore: number }> = [];
  for (let i = 0; i < out.length; i += 1) {
    const phrase = out[i];
    if (!phrase.startsWith("продажа ")) continue;

    const core = normalizeCorePhrase(phrase);
    if (!core) continue;
    const buyPhrase = normalizePhraseCandidate(`купить ${core}`);
    if (!buyPhrase) continue;
    if (outSet.has(buyPhrase)) continue;

    const buyCandidate = candidateByPhrase.get(buyPhrase);
    if (!buyCandidate) continue;
    if (strictStatsActive && buyCandidate.volume <= 0) continue;

    const saleScore = candidateByPhrase.get(phrase)?.score || 0;
    convertible.push({ idx: i, buyPhrase, saleScore });
  }

  if (convertible.length === 0) return out;

  convertible.sort((a, b) => a.saleScore - b.saleScore);
  let needed = MIN_BUY_KEYWORDS - existingBuyCount;

  for (const item of convertible) {
    if (needed <= 0) break;
    if (outSet.has(item.buyPhrase)) continue;

    const oldPhrase = out[item.idx];
    out[item.idx] = item.buyPhrase;
    outSet.delete(oldPhrase);
    outSet.add(item.buyPhrase);
    needed -= 1;
  }

  return out;
}

function buildBlockedGenericPhrases(selected: string[]): Set<string> {
  const blocked = new Set<string>();
  const set = new Set(selected);

  if (set.has("транспортные услуги")) blocked.add("транспорт");
  if (set.has("перевозки грузов")) blocked.add("перевозки");

  return blocked;
}

export function generateCompanyKeywordPhrases(
  company: BiznesinfoCompany,
  opts?: KeywordGenerationOptions,
): string[] {
  const maxKeywords = Math.max(1, Math.min(10, opts?.maxKeywords ?? 10));
  const fallbackMode: KeywordFallbackMode = opts?.fallbackMode === "short" ? "short" : "rubrics";
  const volumeLookup = buildVolumeLookup(opts);
  const strictStatsActive = Boolean(opts?.strictStats && volumeLookup);
  const contextGeoTokens = extractContextGeoTokens(company);
  const contextCompanyTokens = extractCompanyIdentityTokens(company);

  const candidatesByPhrase = new Map<string, KeywordCandidate>();

  const addCandidate = (
    rawPhrase: string,
    source: KeywordCandidateSource,
    baseScore: number,
  ) => {
    const phrase = normalizePhraseCandidate(rawPhrase);
    if (!phrase) return;
    if (!isSafeKeywordPhrase(phrase, source, contextGeoTokens, contextCompanyTokens)) return;

    const volume = volumeLookup ? volumeLookup(phrase) : 0;
    const score = buildCandidateScore(baseScore, volume, phrase);

    const existing = candidatesByPhrase.get(phrase);
    if (!existing) {
      candidatesByPhrase.set(phrase, { phrase, source, score, volume });
      return;
    }

    if (score > existing.score) {
      candidatesByPhrase.set(phrase, { phrase, source, score, volume: Math.max(volume, existing.volume) });
      return;
    }

    if (volume > existing.volume) {
      candidatesByPhrase.set(phrase, { ...existing, volume });
    }
  };

  const servicePhrases = collectStructuredPhrases(company.services_list || []);
  const productPhrases = collectStructuredPhrases(company.products || []);
  const structuredPhrasesCount = servicePhrases.length + productPhrases.length;

  for (const phrase of servicePhrases) {
    addCandidate(phrase, "service", 120);
    addCandidate(`заказать ${phrase}`, "service", 129);
    addCandidate(`услуги ${phrase}`, "service", 124);
    if (shouldAddCallPhrase(phrase)) addCandidate(`вызвать ${phrase}`, "service", 126);

    for (const synonym of expandSynonyms(phrase)) {
      addCandidate(synonym, "service", 117);
    }
  }

  for (const phrase of productPhrases) {
    addCandidate(phrase, "product", 118);
    addCandidate(`продажа ${phrase}`, "product", 127);
    addCandidate(`купить ${phrase}`, "product", 126);
    addCandidate(`купить оптом ${phrase}`, "product", 125);
    addCandidate(`покупка ${phrase}`, "product", 123);
    addCandidate(`покупка оптом ${phrase}`, "product", 122);

    for (const synonym of expandSynonyms(phrase)) {
      addCandidate(synonym, "product", 114);
    }
  }

  if (structuredPhrasesCount === 0) {
    const repeatedHeadPhrases = extractRepeatedHeadListPhrases(company.description || "");
    for (const phrase of repeatedHeadPhrases) {
      addCandidate(phrase, "aux_text", 112);
      addCandidate(`продажа ${phrase}`, "aux_text", 110);
      addCandidate(`купить ${phrase}`, "aux_text", 109);
    }
  }

  const allowAuxText = strictStatsActive;
  if (allowAuxText) {
    const descriptionPhrases = extractActivityPhrasesFromText(company.description || "");
    for (const phrase of descriptionPhrases) addCandidate(phrase, "aux_text", 84);

    const aboutPhrases = extractActivityPhrasesFromText(company.about || "");
    for (const phrase of aboutPhrases) addCandidate(phrase, "aux_text", 81);
  }

  const allowProductListExtraction = hasFoodIndustryTaxonomy(company);
  if (allowProductListExtraction) {
    // Safe product-list extractor from text (e.g., "молочная продукция (молоко, кефир, масло, творог)").
    const descriptionProductListPhrases = extractProductListPhrasesFromText(company.description || "");
    for (const phrase of descriptionProductListPhrases) addCandidate(phrase, "aux_text", 109);

    const aboutProductListPhrases = extractProductListPhrasesFromText(company.about || "");
    for (const phrase of aboutProductListPhrases) addCandidate(phrase, "aux_text", 106);
  }

  const rubricCategoryPhrases = collectRubricCategoryPhrases(company);
  for (const entry of rubricCategoryPhrases) {
    addCandidate(entry.phrase, entry.source, entry.source === "rubric" ? 58 : 54);
  }

  const allCandidates = Array.from(candidatesByPhrase.values());
  const strictFiltered = strictStatsActive
    ? allCandidates.filter((candidate) => candidate.volume > 0)
    : allCandidates;

  let selected = selectTopPhrases(strictFiltered, maxKeywords);
  selected = refineSelectedKeywordPhrases(selected, company, strictStatsActive, volumeLookup);

  if (selected.length < maxKeywords && fallbackMode === "rubrics") {
    const blocked = buildBlockedGenericPhrases(selected);
    const fallbackCandidates = allCandidates.filter((candidate) => {
      if (candidate.source !== "rubric" && candidate.source !== "category") return false;
      return !selected.includes(candidate.phrase);
    });
    const filteredFallback = fallbackCandidates.filter((candidate) => !blocked.has(candidate.phrase));

    selected = selectTopPhrases(filteredFallback, maxKeywords, selected);
    selected = refineSelectedKeywordPhrases(selected, company, strictStatsActive, volumeLookup);
  }

  selected = ensureBuyIntentKeywords(selected, allCandidates, strictStatsActive);
  selected = refineSelectedKeywordPhrases(selected, company, strictStatsActive, volumeLookup);

  return selected.slice(0, maxKeywords);
}

export function generateCompanyKeywordsString(
  company: BiznesinfoCompany,
  opts?: KeywordGenerationOptions,
): string {
  return generateCompanyKeywordPhrases(company, opts).join(", ");
}

export function keywordPhrasesToSearchTokens(phrases: string[]): string[] {
  const out = new Set<string>();

  for (const raw of phrases || []) {
    const phrase = normalizeKeywordPhrase(raw);
    if (!phrase) continue;
    out.add(phrase);

    for (const token of phrase.split(/\s+/u).filter(Boolean)) {
      if (token.length < 2) continue;
      if (STOP_WORDS.has(token)) continue;
      out.add(token);
    }
  }

  return Array.from(out);
}

export function generateCompanyKeywords(company: BiznesinfoCompany, opts?: KeywordGenerationOptions): string[] {
  const phrases = generateCompanyKeywordPhrases(company, opts);
  return keywordPhrasesToSearchTokens(phrases);
}
