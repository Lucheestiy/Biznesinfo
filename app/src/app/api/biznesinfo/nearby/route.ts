import { NextResponse } from "next/server";
import { getCompaniesIndex, isMeiliHealthy } from "@/lib/meilisearch";
import { isExcludedBiznesinfoCompany } from "@/lib/biznesinfo/exclusions";
import { isLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";
import { biznesinfoGetCompanyCardsByIds } from "@/lib/biznesinfo/postgres";
import { isAddressLikeLocationQuery, normalizeLocationQueryForSearch } from "@/lib/utils/location";
import minskDistrictStreetLists from "@/lib/biznesinfo/minsk-district-streets.json";

export const runtime = "nodejs";

const DEFAULT_NEARBY_RADIUS = 10000; // 10 km
const MIN_NEARBY_RADIUS = 1000; // 1 km
const MAX_NEARBY_RADIUS = 100000; // 100 km
const MAX_NEARBY_LIMIT = 200;

type MinskDistrictKey =
  | "frunzensky"
  | "pervomaisky"
  | "centralny"
  | "sovetsky"
  | "zavodskoy"
  | "leninsky"
  | "moskovsky"
  | "oktyabrsky"
  | "partizansky";

const MINSK_DISTRICT_CONFIGS: Array<{ key: MinskDistrictKey; tokenPrefixes: string[] }> = [
  { key: "frunzensky", tokenPrefixes: ["фрунзен", "frunzen"] },
  { key: "pervomaisky", tokenPrefixes: ["первомай", "pervomai", "pervomay"] },
  { key: "centralny", tokenPrefixes: ["центральн", "centraln", "tsentral"] },
  { key: "sovetsky", tokenPrefixes: ["советск", "sovetsk", "soviet"] },
  { key: "zavodskoy", tokenPrefixes: ["заводск", "zavodsk"] },
  { key: "leninsky", tokenPrefixes: ["ленинск", "leninsk"] },
  { key: "moskovsky", tokenPrefixes: ["московск", "moskovsk", "moscow"] },
  { key: "oktyabrsky", tokenPrefixes: ["октябр", "oktyabr", "october"] },
  { key: "partizansky", tokenPrefixes: ["партизан", "partizan"] },
];

const DISTRICT_STREET_EXCLUSIONS_BY_KEY: Partial<Record<MinskDistrictKey, string[]>> = {
  // Explicitly exclude border/ambiguous case that user reported as wrong for Frunzensky.
  frunzensky: ["максима танка", "улица максима танка"],
};

const SERVICE_QUERY_INTENT_STOP_WORDS = new Set([
  "на",
  "карте",
  "можно",
  "можете",
  "могу",
  "пожалуйста",
  "пж",
  "найди",
  "найдите",
  "найти",
  "покажи",
  "покажите",
  "показать",
  "ищи",
  "ищите",
  "ищу",
  "где",
  "подскажи",
  "подскажите",
  "нужен",
  "нужна",
  "нужны",
  "нужно",
  "что",
  "please",
  "find",
  "show",
  "where",
  "купить",
  "куплю",
  "покупка",
  "покупки",
  "продажа",
  "продажи",
  "продаю",
  "заказать",
  "закажу",
  "заказ",
  "заказы",
  "опт",
  "оптом",
  "розница",
  "розницу",
  "цена",
  "цены",
  "стоимость",
]);

const FOOD_INTENT_NL_TOKEN_PREFIXES = [
  "поесть",
  "поест",
  "поед",
  "съесть",
  "съест",
  "сьесть",
  "сьест",
  "еда",
  "питани",
  "перекус",
  "покуш",
  "кушат",
  "пообед",
  "поужин",
  "позавтрак",
  "обед",
  "ужин",
  "завтрак",
  "голод",
  "food",
  "breakfast",
  "lunch",
  "dinner",
  "eat",
  "dine",
];

const SERVICE_QUERY_DESCRIPTOR_STOP_WORDS = new Set([
  "компания",
  "компании",
  "компаний",
  "предприятие",
  "предприятия",
  "предприятий",
  "организация",
  "организации",
  "организаций",
  "фирма",
  "фирмы",
  "фирм",
  "завод",
  "завода",
  "заводы",
  "фабрика",
  "фабрики",
  "фабрик",
  "продукция",
  "продукции",
  "промышленность",
  "промышленности",
  "отрасль",
  "отрасли",
  "направление",
  "направления",
]);

const SERVICE_QUERY_PROXIMITY_HELPER_WORDS = new Set([
  "рядом",
  "поблизости",
  "недалеко",
  "возле",
  "около",
  "близко",
  "здесь",
  "тут",
  "мной",
  "мне",
  "меня",
]);

const SERVICE_QUERY_DESCRIPTOR_PREFIXES = [
  "компан",
  "предприят",
  "организац",
  "фирм",
  "завод",
  "фабрик",
  "производств",
  "производител",
  "продукц",
  "промышленност",
  "отрасл",
  "направлен",
  "деятельност",
  "товар",
  "услуг",
  "работ",
];

const FOOD_VENUE_TOKEN_PREFIXES = [
  "ресторан",
  "кафе",
  "кафетер",
  "бар",
  "пиццер",
  "пицц",
  "суши",
  "кофейн",
  "столов",
];

const FOOD_VENUE_STRONG_TOKEN_PREFIXES = [
  "ресторан",
  "кафе",
  "кафетер",
  "бар",
  "пиццер",
  "пицц",
  "суши",
  "кофейн",
  "закусоч",
  "бистро",
  "общепит",
  "обществен",
];

const FOOD_VENUE_DIRECT_TOKEN_PREFIXES = [
  "ресторан",
  "кафе",
  "кафетер",
  "бар",
  "пиццер",
  "пицц",
  "суши",
  "кофейн",
  "закусоч",
  "бистро",
];

const FOOD_VENUE_WEAK_TOKEN_PREFIXES = [
  "столов",
];

const FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES = [
  "прибор",
  "посуд",
  "фарфор",
  "сервиз",
  "мебел",
  "оборуд",
  "холодиль",
  "торгов",
  "инвентар",
  "текстил",
  "утвар",
  "кухон",
];

const BREAD_INTENT_TOKEN_PREFIXES = [
  "хлеб",
  "хлебобул",
  "пекар",
  "булоч",
  "выпеч",
  "батон",
  "булк",
];

const BREAD_POSITIVE_CATALOG_PREFIXES = [
  "пищ",
  "продукт",
  "хлеб",
  "хлебобул",
  "пекар",
  "кондитер",
  "кафе",
];

const BREAD_NEGATIVE_CATALOG_PREFIXES = [
  "оборуд",
  "машиностро",
  "отоп",
  "вентил",
  "колледж",
  "инспекц",
  "стандартиз",
  "сертификац",
  "государств",
  "образован",
  "лаборатор",
  "сельхозмаш",
  "инженер",
];

const BREAD_TRANSPORT_DISTRACTOR_PREFIXES = [
  "фургон",
  "груз",
  "грузопассажир",
  "авто",
  "автомоб",
  "машин",
  "машиностро",
  "транспорт",
  "кузов",
  "прицеп",
  "полуприцеп",
  "ремонт",
  "рефрижератор",
  "truck",
  "vehicle",
  "trailer",
];

const BREAD_PRODUCT_TOKEN_PREFIXES = [
  "хлеб",
  "хлебобул",
  "булоч",
  "выпеч",
  "батон",
  "багет",
  "лаваш",
  "булк",
  "хлебец",
];

const BREAD_SELL_OR_PRODUCE_PREFIXES = [
  "производ",
  "выпуск",
  "продаж",
  "магазин",
  "пекар",
  "хлебозавод",
  "кафе",
];

const BREAD_NEGATIVE_TEXT_PREFIXES = [
  "оборуд",
  "инвентар",
  "форма",
  "штамп",
  "ингредиент",
  "сырь",
  "добавк",
  "упаков",
  "техник",
  "спецодеж",
  "исследован",
  "разработк",
  "стандарт",
  "сертификац",
  "инжинир",
  "лаборатор",
  "печ",
  "нагрев",
  "отоп",
];

const TRANSPORT_QUERY_TOKEN_PREFIXES = [
  "фургон",
  "груз",
  "грузопассажир",
  "авто",
  "автомоб",
  "машин",
  "машиностро",
  "транспорт",
  "кузов",
  "прицеп",
  "полуприцеп",
  "ремонт",
  "рефрижератор",
  "truck",
  "vehicle",
  "trailer",
];

const SCHOOL_INTENT_TOKEN_PREFIXES = [
  "школ",
  "гимназ",
  "лице",
  "school",
  "lyce",
  "gymnas",
];

const KINDERGARTEN_INTENT_TOKEN_PREFIXES = [
  "сад",
  "садик",
  "ясл",
  "дошкол",
  "kindergarten",
  "preschool",
  "nursery",
];

const KINDERGARTEN_CHILD_CONTEXT_TOKEN_PREFIXES = [
  "дет",
  "реб",
  "дошкол",
  "ясл",
  "воспит",
];

const KINDERGARTEN_NEGATIVE_TOKEN_PREFIXES = [
  "садов",
  "ландшафт",
  "огород",
  "питом",
  "растен",
  "цвет",
  "семен",
  "удобр",
  "теплиц",
  "инвентар",
];

function normalizeDistrictStreetText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const DISTRICT_STREET_TYPE_STOP_WORDS = new Set([
  "улица",
  "ул",
  "переулок",
  "пер",
  "проезд",
  "проспект",
  "просп",
  "пр-т",
  "тракт",
  "бульвар",
  "б-р",
  "набережная",
  "наб",
  "площадь",
  "пл",
  "спуск",
]);

function normalizeDistrictStreetComparable(raw: string): string {
  const normalized = normalizeDistrictStreetText(raw);
  if (!normalized) return "";
  return normalized
    .split(" ")
    .filter((token) => token && !DISTRICT_STREET_TYPE_STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function buildDistrictStreetMatchers(streets: string[]): string[] {
  const out = new Set<string>();
  const pushVariant = (raw: string) => {
    const normalized = normalizeDistrictStreetText(raw);
    if (normalized) out.add(normalized);
    if (normalized.includes("-")) {
      const noDash = normalized.replace(/-/gu, " ").replace(/\s+/gu, " ").trim();
      if (noDash) out.add(noDash);
    }
    const comparable = normalizeDistrictStreetComparable(raw);
    if (comparable) out.add(comparable);
    if (comparable.includes("-")) {
      const comparableNoDash = comparable.replace(/-/gu, " ").replace(/\s+/gu, " ").trim();
      if (comparableNoDash) out.add(comparableNoDash);
    }
  };

  for (const street of streets) {
    pushVariant(street);
  }
  return Array.from(out);
}

function buildMinskDistrictStreetMatchers(): Record<MinskDistrictKey, string[]> {
  const typed = minskDistrictStreetLists as Record<MinskDistrictKey, string[]>;
  const out = {} as Record<MinskDistrictKey, string[]>;
  for (const config of MINSK_DISTRICT_CONFIGS) {
    const rawStreets = typed[config.key] || [];
    const excludedTokens = new Set(
      (DISTRICT_STREET_EXCLUSIONS_BY_KEY[config.key] || [])
        .map((street) => normalizeDistrictStreetComparable(street))
        .filter(Boolean),
    );
    const filtered = rawStreets.filter((street) => {
      const comparable = normalizeDistrictStreetComparable(street);
      if (!comparable) return false;
      return !excludedTokens.has(comparable);
    });
    out[config.key] = buildDistrictStreetMatchers(filtered);
  }
  return out;
}

const MINSK_DISTRICT_STREET_MATCHERS = buildMinskDistrictStreetMatchers();

function matchesFoodVenueTokenPrefix(token: string, prefix: string): boolean {
  if (!token || !prefix) return false;
  // Avoid false positives like "кафедра" while keeping valid compound forms.
  if (prefix === "кафе") {
    return token === "кафе" || token.startsWith("кафе-");
  }
  if (prefix === "суши") {
    return token === "суши" || token.startsWith("суши-");
  }
  if (prefix === "бар") {
    return /^бар(ы|а|у|е|ом|ов|ам|ами|ах)?$/u.test(token) || token.startsWith("бар-");
  }
  return token.startsWith(prefix);
}

const CUISINE_QUALIFIER_PREFIXES = [
  "итальян",
  "япон",
  "китай",
  "грузин",
  "белорус",
  "француз",
  "европ",
  "азиат",
  "турец",
  "индий",
  "кавказ",
  "узбек",
  "армян",
  "корей",
  "тайск",
  "мексикан",
];

function isProximityHelperToken(raw: string): boolean {
  const token = normalizeServiceQueryToken(raw);
  if (!token) return false;
  if (SERVICE_QUERY_PROXIMITY_HELPER_WORDS.has(token)) return true;
  if (token.startsWith("ближайш")) return true;
  if (token.startsWith("поблиз")) return true;
  if (token.startsWith("недалек")) return true;
  return false;
}

function tokenizeServiceQuery(raw: string): string[] {
  const cleaned = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!cleaned) return [];
  return cleaned.split(" ").filter(Boolean);
}

function isServiceDescriptorToken(token: string): boolean {
  const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return false;
  if (SERVICE_QUERY_DESCRIPTOR_STOP_WORDS.has(t)) return true;
  return SERVICE_QUERY_DESCRIPTOR_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function isCheeseIntentToken(raw: string): boolean {
  const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return false;
  if (!t.startsWith("сыр")) return false;
  if (t.startsWith("сырь")) return false; // сырьё / сырьевой
  if (/^сыр(о|ой|ая|ое|ые|ого|ому|ым|ых|ую)$/u.test(t)) return false; // сырой / сырые / сырых ...
  if (t.startsWith("сырост")) return false; // сырость
  if (t.startsWith("сырокопч")) return false; // сырокопчёный
  if (t.startsWith("сыровялен") || t.startsWith("сыровял")) return false; // сыровяленый
  return true;
}

function isBreadIntentToken(raw: string): boolean {
  const t = normalizeServiceQueryToken(raw);
  if (!t) return false;
  return BREAD_INTENT_TOKEN_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function normalizeServiceQueryToken(token: string): string {
  const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return "";
  return t;
}

function canonicalizeNearbyIntentToken(raw: string): string {
  const t = normalizeServiceQueryToken(raw);
  if (!t) return "";
  // Keep singular/plural school forms equivalent: "школа", "школы", "школу" -> "школ".
  if (t.startsWith("школ")) return "школ";
  if (t.startsWith("school")) return "school";
  if (FOOD_INTENT_NL_TOKEN_PREFIXES.some((prefix) => t.startsWith(prefix))) return "кафе";
  return t;
}

function hasFoodVenueToken(tokens: string[]): boolean {
  return tokens.some((token) => FOOD_VENUE_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)));
}

function hasFoodNaturalLanguageIntentToken(tokens: string[]): boolean {
  return tokens.some((token) => FOOD_INTENT_NL_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

function hitMatchesFoodVenueIntent(hit: any): boolean {
  const searchableSource = [
    hit?.name || "",
    ...(hit?.keywords || []),
    ...(hit?.rubric_names || []),
    ...(hit?.category_names || []),
  ]
    .filter(Boolean)
    .join(" ");

  const fieldTokens = tokenizeServiceQuery(searchableSource);
  if (fieldTokens.length === 0) return false;

  const hasStrongVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasDirectVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_DIRECT_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasWeakVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && !hasWeakVenueSignal) return false;

  const hasNegativeSignal = fieldTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );

  // Guardrail: B2B suppliers often contain "общепит" plus "оборудование".
  // Keep only direct venue signals when negative B2B context is present.
  if (hasNegativeSignal && !hasDirectVenueSignal) return false;

  // "Столовые" can refer to canteens or tableware/equipment.
  // If we only have weak venue markers and clear non-venue markers, treat as non-venue.
  if (!hasStrongVenueSignal && hasNegativeSignal) return false;

  return true;
}

function hitMatchesStrictFoodVenueIntent(hit: any): boolean {
  const primarySource = [
    hit?.name || "",
    ...(hit?.rubric_names || []),
    ...(hit?.category_names || []),
  ]
    .filter(Boolean)
    .join(" ");

  const fieldTokens = tokenizeServiceQuery(primarySource);
  if (fieldTokens.length === 0) return false;

  const hasStrongVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasDirectVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_DIRECT_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasWeakVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && !hasWeakVenueSignal) return false;

  const hasNegativeSignal = fieldTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (hasNegativeSignal && !hasDirectVenueSignal) return false;
  if (!hasStrongVenueSignal && hasNegativeSignal) return false;

  return true;
}

function hasSchoolIntentToken(tokens: string[]): boolean {
  return tokens.some((token) => SCHOOL_INTENT_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

function isGenericKindergartenSadToken(token: string): boolean {
  return /^сад(ик)?(?:ы|а|у|е|ом|ов|ам|ами|ах)?$/u.test(token) || /^сад-\d+$/u.test(token);
}

function matchesKindergartenTokenPrefix(token: string, prefix: string): boolean {
  if (!token || !prefix) return false;
  if (prefix === "сад") {
    if (token.startsWith("детсад")) return true;
    return isGenericKindergartenSadToken(token);
  }
  if (prefix === "садик") {
    return /^садик(?:и|а|у|е|ом|ов|ам|ами|ах)?$/u.test(token) || token.startsWith("детсад");
  }
  return token.startsWith(prefix);
}

function hasKindergartenStrongToken(tokens: string[]): boolean {
  return tokens.some((token) => {
    if (token.startsWith("детсад")) return true;
    if (token.startsWith("ясл") || token.startsWith("дошкол")) return true;
    if (token.startsWith("kindergarten") || token.startsWith("preschool") || token.startsWith("nursery")) return true;
    if (matchesKindergartenTokenPrefix(token, "садик")) return true;
    return false;
  });
}

function tokensMatchKindergartenIntent(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const hasStrongSignal = hasKindergartenStrongToken(tokens);
  if (hasStrongSignal) return true;

  const hasGenericSadSignal = tokens.some((token) => matchesKindergartenTokenPrefix(token, "сад"));
  if (!hasGenericSadSignal) return false;

  const hasChildContextSignal = tokens.some((token) =>
    KINDERGARTEN_CHILD_CONTEXT_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasChildContextSignal) return false;

  const hasNegativeSignal = tokens.some((token) =>
    KINDERGARTEN_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (hasNegativeSignal) return false;

  return true;
}

function hasKindergartenFocusedIntentToken(tokens: string[]): boolean {
  return tokensMatchKindergartenIntent(tokens);
}

function hasKindergartenIntentToken(tokens: string[]): boolean {
  return tokens.some((token) =>
    KINDERGARTEN_INTENT_TOKEN_PREFIXES.some((prefix) => matchesKindergartenTokenPrefix(token, prefix)),
  );
}

function hitMatchesSchoolIntent(hit: any): boolean {
  const searchableSource = [
    hit?.name || "",
    ...(hit?.rubric_names || []),
    ...(hit?.category_names || []),
  ]
    .filter(Boolean)
    .join(" ");

  const fieldTokens = tokenizeServiceQuery(searchableSource);
  if (fieldTokens.length === 0) return false;

  const hasSchoolSignal = hasSchoolIntentToken(fieldTokens);
  if (!hasSchoolSignal) return false;

  const hasKindergartenSignal = tokensMatchKindergartenIntent(fieldTokens);
  if (hasKindergartenSignal) return false;

  return true;
}

function hitMatchesKindergartenIntent(hit: any): boolean {
  const searchableSource = [
    hit?.name || "",
    ...(hit?.rubric_names || []),
    ...(hit?.category_names || []),
  ]
    .filter(Boolean)
    .join(" ");

  const fieldTokens = tokenizeServiceQuery(searchableSource);
  return tokensMatchKindergartenIntent(fieldTokens);
}

function isCuisineQualifierToken(token: string): boolean {
  const t = normalizeServiceQueryToken(token);
  if (!t) return false;
  return CUISINE_QUALIFIER_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function normalizeNearbyQuery(raw: string): string {
  const tokens = tokenizeServiceQuery(raw);
  if (tokens.length === 0) return "";

  const filtered = tokens.filter((token) => {
    if (SERVICE_QUERY_INTENT_STOP_WORDS.has(token)) return false;
    if (isServiceDescriptorToken(token)) return false;
    if (isProximityHelperToken(token)) return false;
    return true;
  });

  const hasOnlyContextTokens = tokens.every((token) => {
    if (SERVICE_QUERY_INTENT_STOP_WORDS.has(token)) return true;
    if (isServiceDescriptorToken(token)) return true;
    if (isProximityHelperToken(token)) return true;
    return false;
  });

  const pickedSource = filtered.length > 0 ? filtered : hasOnlyContextTokens ? [] : tokens;
  let picked = pickedSource
    .map((token) => canonicalizeNearbyIntentToken(token))
    .filter(Boolean);

  if (picked.length > 0 && hasFoodNaturalLanguageIntentToken(picked) && !hasFoodVenueToken(picked)) {
    // Natural-language ask ("где поесть") should map to venue intent, not literal term lookup.
    picked = ["кафе"];
  }

  if (picked.length > 1 && hasFoodVenueToken(picked)) {
    const withoutCuisine = picked.filter((token) => !isCuisineQualifierToken(token));
    if (withoutCuisine.length > 0) {
      picked = withoutCuisine;
    }
  }

  if (picked.length > 0 && picked.every((token) => isCheeseIntentToken(token))) {
    return "молочная";
  }

  if (picked.length > 0 && picked.every((token) => isBreadIntentToken(token))) {
    return "хлеб";
  }

  if (picked.length > 0 && tokensMatchKindergartenIntent(picked)) {
    const hasExplicitNumber = picked.some((token) => /\d/u.test(token));
    const hasGenericSadSignal = picked.some((token) => matchesKindergartenTokenPrefix(token, "сад"));
    const hasStrongKindergartenSignal = hasKindergartenStrongToken(picked);
    if (!hasExplicitNumber && (hasGenericSadSignal || !hasStrongKindergartenSignal)) {
      return "ясли";
    }
  }

  return picked.join(" ").trim();
}

function isContextOnlyNearbyQuery(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    if (SERVICE_QUERY_INTENT_STOP_WORDS.has(token)) return true;
    if (isServiceDescriptorToken(token)) return true;
    if (isProximityHelperToken(token)) return true;
    return false;
  });
}

function shouldApplyMilkFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((t) => t.startsWith("молок") || t.startsWith("молоч"));
}

function shouldApplyCheeseFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((t) => isCheeseIntentToken(t));
}

function shouldApplyBreadFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((token) => isBreadIntentToken(token));
}

function hasTransportIntentToken(tokens: string[]): boolean {
  return tokens.some((token) => TRANSPORT_QUERY_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

function hasMilkKeyword(keywords: string[]): boolean {
  for (const raw of keywords || []) {
    const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!t) continue;
    if (t.startsWith("молок") || t.startsWith("молоч")) return true;
  }
  return false;
}

function hasCheeseKeyword(keywords: string[]): boolean {
  for (const raw of keywords || []) {
    if (isCheeseIntentToken(raw)) return true;
  }
  return false;
}

function hasBreadKeyword(keywords: string[]): boolean {
  for (const raw of keywords || []) {
    const t = normalizeServiceQueryToken(raw);
    if (!t) continue;
    if (BREAD_INTENT_TOKEN_PREFIXES.some((prefix) => t.startsWith(prefix))) return true;
  }
  return false;
}

function cardCatalogNames(card: any): string[] {
  const categories = Array.isArray(card?.categories) ? card.categories : [];
  const rubrics = Array.isArray(card?.rubrics) ? card.rubrics : [];
  return [
    ...categories.map((c: any) => String(c?.name || "").trim()),
    ...rubrics.map((r: any) => String(r?.name || "").trim()),
  ].filter(Boolean);
}

function cardMatchesFoodVenueIntent(card: any): boolean {
  const name = String(card?.name || "");
  const description = String(card?.description || "");
  const catalogText = cardCatalogNames(card).join(" ");
  const fullTokens = tokenizeServiceQuery(`${name} ${catalogText} ${description}`.trim());
  if (fullTokens.length === 0) return false;

  const hasStrongVenueSignal = fullTokens.some((token) =>
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasWeakVenueSignal = fullTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && !hasWeakVenueSignal) return false;

  const hasNegativeSignal = fullTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && hasNegativeSignal) return false;

  // Guard against accidental matches in long descriptions:
  // require venue signal in company name/rubrics/categories too.
  const primaryTokens = tokenizeServiceQuery(`${name} ${catalogText}`.trim());
  const hasPrimaryStrongSignal = primaryTokens.some((token) =>
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => matchesFoodVenueTokenPrefix(token, prefix)),
  );
  const hasPrimaryWeakSignal = primaryTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasPrimaryStrongSignal && !hasPrimaryWeakSignal) return false;

  const hasPrimaryNegativeSignal = primaryTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasPrimaryStrongSignal && hasPrimaryNegativeSignal) return false;

  return true;
}

function cardHasFoodContext(card: any): boolean {
  const names = cardCatalogNames(card);
  for (const raw of names) {
    const t = normalizeServiceQueryToken(raw);
    if (!t) continue;
    if (
      t.includes("пищ") ||
      t.includes("продукт") ||
      t.includes("молоч") ||
      t.includes("молок")
    ) {
      return true;
    }
  }
  return false;
}

function textHasMilkToken(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((t) => t.startsWith("молок") || t.startsWith("молоч"));
}

function cardMatchesMilkIntent(card: any): boolean {
  const names = cardCatalogNames(card);
  const hasMilkCatalog = names.some((raw) => {
    const t = normalizeServiceQueryToken(raw);
    return t.includes("молоч") || t.includes("молок");
  });
  if (hasMilkCatalog) return true;
  if (!cardHasFoodContext(card)) return false;
  return textHasMilkToken(String(card?.name || "")) || textHasMilkToken(String(card?.description || ""));
}

function hasAnyPrefixToken(tokens: string[], prefixes: string[]): boolean {
  return tokens.some((token) => prefixes.some((prefix) => token.startsWith(prefix)));
}

function cardMatchesBreadIntent(card: any): boolean {
  const name = String(card?.name || "");
  const description = String(card?.description || "");
  const nameAndDescription = `${name} ${description}`.trim();
  const catalogText = cardCatalogNames(card).join(" ");
  const textTokens = tokenizeServiceQuery(`${nameAndDescription} ${catalogText}`.trim());
  if (!hasAnyPrefixToken(textTokens, BREAD_PRODUCT_TOKEN_PREFIXES)) return false;
  if (hasAnyPrefixToken(textTokens, BREAD_NEGATIVE_TEXT_PREFIXES)) return false;

  const catalogTokens = tokenizeServiceQuery(catalogText);
  if (hasAnyPrefixToken(catalogTokens, BREAD_NEGATIVE_CATALOG_PREFIXES)) return false;

  const hasPositiveCatalog = hasAnyPrefixToken(catalogTokens, BREAD_POSITIVE_CATALOG_PREFIXES);
  const hasTransportDistractor = hasAnyPrefixToken(textTokens, BREAD_TRANSPORT_DISTRACTOR_PREFIXES);
  const hasSellOrProduceSignal = hasAnyPrefixToken(textTokens, BREAD_SELL_OR_PRODUCE_PREFIXES);

  if (hasTransportDistractor) return false;
  return hasPositiveCatalog || hasSellOrProduceSignal;
}

function cardMatchesKindergartenIntent(card: any): boolean {
  const name = String(card?.name || "");
  const catalogText = cardCatalogNames(card).join(" ");
  const textTokens = tokenizeServiceQuery(`${name} ${catalogText}`.trim());
  return tokensMatchKindergartenIntent(textTokens);
}

function cardMatchesSchoolIntent(card: any): boolean {
  const name = String(card?.name || "");
  const catalogText = cardCatalogNames(card).join(" ");
  const textTokens = tokenizeServiceQuery(`${name} ${catalogText}`.trim());
  if (textTokens.length === 0) return false;

  const hasSchoolSignal = hasSchoolIntentToken(textTokens);
  if (!hasSchoolSignal) return false;

  const hasKindergartenSignal = tokensMatchKindergartenIntent(textTokens);
  if (hasKindergartenSignal) return false;

  return true;
}

function canonicalizeStrictToken(raw: string): string {
  const t = canonicalizeNearbyIntentToken(raw);
  if (!t) return "";
  if (t.startsWith("молок") || t.startsWith("молоч")) return "молоч";
  if (isCheeseIntentToken(t)) return "сыр";
  return t;
}

function tokenizeForStrictMatch(raw: string): string[] {
  return tokenizeServiceQuery(raw)
    .map((token) => canonicalizeStrictToken(token))
    .filter((token) => token.length >= 2);
}

function strictTokenMatch(fieldToken: string, queryToken: string): boolean {
  if (!fieldToken || !queryToken) return false;
  if (fieldToken === queryToken) return true;
  if (queryToken.length >= 3 && fieldToken.startsWith(queryToken)) return true;
  if (fieldToken.length >= 5 && queryToken.startsWith(fieldToken)) return true;
  return false;
}

function tokenizeAddressComparable(raw: string): string[] {
  const cleaned = String(raw || "")
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

function extractHouseCandidatesAfterStreet(rawAddress: string, streetTokens: string[]): string[] {
  const address = String(rawAddress || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
  if (!address || streetTokens.length === 0) return [];

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

function hitMatchesAddressHouseQuery(address: string, query: string): boolean {
  const queryTokens = tokenizeAddressComparable(query).map((token) => normalizeAddressToken(token)).filter(Boolean);
  if (queryTokens.length === 0) return true;
  const houseTokens = queryTokens.filter((token) => /\d/u.test(token));
  if (houseTokens.length === 0) return true;
  const streetTokens = queryTokens.filter((token) => !/\d/u.test(token) && token.length >= 3);

  const addressTokens = tokenizeAddressComparable(address).map((token) => normalizeAddressToken(token)).filter(Boolean);
  if (addressTokens.length === 0) return false;

  const streetMatches = streetTokens.filter((streetToken) =>
    addressTokens.some((addressToken) => matchesStreetAddressToken(addressToken, streetToken)),
  ).length;
  if (streetTokens.length > 0 && streetMatches < Math.min(streetTokens.length, 2)) {
    return false;
  }

  if (streetTokens.length > 0) {
    const houseAfterStreet = extractHouseCandidatesAfterStreet(address, streetTokens);
    if (houseAfterStreet.length > 0) {
      return houseTokens.every((houseToken) =>
        houseAfterStreet.some((candidate) => matchesHouseAddressToken(candidate, houseToken)),
      );
    }
  }

  return houseTokens.every((houseToken) =>
    addressTokens.some((addressToken) => matchesHouseAddressToken(addressToken, houseToken)),
  );
}

function hitMatchesAddressStreetQuery(address: string, query: string): boolean {
  const queryTokens = tokenizeAddressComparable(query).map((token) => normalizeAddressToken(token)).filter(Boolean);
  if (queryTokens.length === 0) return true;
  const streetTokens = queryTokens.filter((token) => !/\d/u.test(token) && token.length >= 3);
  if (streetTokens.length === 0) return true;

  const addressTokens = tokenizeAddressComparable(address).map((token) => normalizeAddressToken(token)).filter(Boolean);
  if (addressTokens.length === 0) return false;

  const streetMatches = streetTokens.filter((streetToken) =>
    addressTokens.some((addressToken) => matchesStreetAddressToken(addressToken, streetToken)),
  ).length;

  const requiredMatches = streetTokens.length <= 1
    ? 1
    : Math.max(1, Math.ceil(streetTokens.length * 0.75));
  return streetMatches >= requiredMatches;
}

function hitMatchesStrictQuery(
  hit: any,
  queryTokens: string[],
  options?: { requireAllTokens?: boolean },
): boolean {
  if (queryTokens.length === 0) return true;

  const searchableSource = [
    hit?.name || "",
    hit?.address || "",
    ...(hit?.keywords || []),
    ...(hit?.rubric_names || []),
    ...(hit?.category_names || []),
  ]
    .filter(Boolean)
    .join(" ");

  const fieldTokens = tokenizeForStrictMatch(searchableSource);
  if (fieldTokens.length === 0) return false;

  const matchedTokens = queryTokens.filter((queryToken) =>
    fieldTokens.some((fieldToken) => strictTokenMatch(fieldToken, queryToken)),
  ).length;
  const requireAllTokens = Boolean(options?.requireAllTokens);
  if (requireAllTokens) return matchedTokens >= queryTokens.length;

  const requiredMatches =
    queryTokens.length <= 2
      ? 1
      : Math.max(2, Math.ceil(queryTokens.length * 0.6));
  return matchedTokens >= requiredMatches;
}

interface NearbyCompany {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  phones: string[];
  emails: string[];
  logo_url: string;
  categories: { slug: string; name: string }[];
  rubrics: { slug: string; name: string; category_slug: string | null; category_name: string | null }[];
  distance: number | null; // Distance in meters
  _geo?: { lat: number; lng: number } | null;
}

interface NearbySearchResponse {
  companies: NearbyCompany[];
  total: number;
  offset: number;
  limit: number;
  query: string;
  center: { lat: number; lng: number };
  radius: number;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMetersBetweenPoints(
  fromLat: number,
  fromLng: number,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
): number | null {
  if (!Number.isFinite(toLat) || !Number.isFinite(toLng)) return null;

  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians((toLat as number) - fromLat);
  const dLng = toRadians((toLng as number) - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat as number)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

function hasMinskPostalCode(addressRaw: string): boolean {
  const address = String(addressRaw || "");
  const zipMatch = address.match(/\b22\d{4}\b/u);
  if (!zipMatch) return false;
  return zipMatch[0].startsWith("220");
}

function normalizeCityToken(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeNearbyCityByAddress(addressRaw: string, cityRaw: string): string {
  const city = String(cityRaw || "").trim();
  if (!hasMinskPostalCode(addressRaw)) return city;
  return "Минск";
}

function normalizeNearbyAddressByCity(addressRaw: string, cityRaw: string): string {
  const address = String(addressRaw || "").trim();
  const city = String(cityRaw || "").trim();
  if (!address || !city) return address;
  if (!hasMinskPostalCode(address)) return address;

  const match = address.match(/^(\s*22\d{4}\s*,\s*)([^,]+)(\s*,.*)$/u);
  if (!match) return address;

  const cityToken = normalizeCityToken(match[2] || "");
  if (cityToken.includes("минск")) return address;
  return `${match[1]}${city}${match[3]}`;
}

function resolveMinskDistrictKey(rawDistrictName: string): MinskDistrictKey | null {
  const normalized = normalizeDistrictStreetText(rawDistrictName);
  if (!normalized) return null;
  for (const config of MINSK_DISTRICT_CONFIGS) {
    if (config.tokenPrefixes.some((prefix) => normalized.includes(prefix))) {
      return config.key;
    }
  }
  return null;
}

function isSupportedDistrictFilter(rawDistrictName: string): boolean {
  return resolveMinskDistrictKey(rawDistrictName) !== null;
}

function addressMatchesMinskDistrictByStreetList(rawAddress: string, districtKey: MinskDistrictKey): boolean {
  const normalizedAddress = normalizeDistrictStreetText(rawAddress);
  if (!normalizedAddress) return false;
  const comparableAddress = normalizeDistrictStreetComparable(rawAddress);

  const config = MINSK_DISTRICT_CONFIGS.find((item) => item.key === districtKey);
  if (config?.tokenPrefixes.some((prefix) => normalizedAddress.includes(prefix))) {
    return true;
  }

  const normalizedHaystack = ` ${normalizedAddress} `;
  const comparableHaystack = comparableAddress ? ` ${comparableAddress} ` : "";
  const matchers = MINSK_DISTRICT_STREET_MATCHERS[districtKey] || [];
  return matchers.some((streetMatcher) =>
    normalizedHaystack.includes(` ${streetMatcher} `) ||
    (comparableHaystack ? comparableHaystack.includes(` ${streetMatcher} `) : false),
  );
}

function cardMatchesDistrictFilter(
  card: { address?: string | null; city?: string | null },
  districtName: string,
): boolean {
  if (!districtName) return true;
  const districtKey = resolveMinskDistrictKey(districtName);
  if (!districtKey) return true;

  const cityToken = normalizeCityToken(card.city || "");
  if (cityToken && !cityToken.includes("минск")) return false;
  return addressMatchesMinskDistrictByStreetList(card.address || "", districtKey);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  
  const query = searchParams.get("q") || "";
  const districtName = (searchParams.get("district") || "").trim();
  const lat = parseFloat(searchParams.get("lat") || "0");
  const lng = parseFloat(searchParams.get("lng") || "0");
  const userLat = parseFloat(searchParams.get("user_lat") || "");
  const userLng = parseFloat(searchParams.get("user_lng") || "");
  const radius = parseInt(searchParams.get("radius") || String(DEFAULT_NEARBY_RADIUS), 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const bboxSouthLat = parseFloat(searchParams.get("bbox_south") || "");
  const bboxWestLng = parseFloat(searchParams.get("bbox_west") || "");
  const bboxNorthLat = parseFloat(searchParams.get("bbox_north") || "");
  const bboxEastLng = parseFloat(searchParams.get("bbox_east") || "");

  // Validate coordinates
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "Invalid coordinates. Provide lat and lng parameters." },
      { status: 400 }
    );
  }

  // Validate radius (allow custom radius set by user, clamped to safe range)
  const safeRadius = Number.isFinite(radius)
    ? Math.min(MAX_NEARBY_RADIUS, Math.max(MIN_NEARBY_RADIUS, radius))
    : DEFAULT_NEARBY_RADIUS;
  const safeLimit = Math.min(Number.isFinite(limit) ? limit : 50, MAX_NEARBY_LIMIT);
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const hasGeoBoundingBox =
    Number.isFinite(bboxSouthLat) &&
    Number.isFinite(bboxWestLng) &&
    Number.isFinite(bboxNorthLat) &&
    Number.isFinite(bboxEastLng) &&
    bboxNorthLat >= bboxSouthLat &&
    bboxEastLng >= bboxWestLng;
  const hasUserDistanceOrigin =
    Number.isFinite(userLat) &&
    Number.isFinite(userLng) &&
    Math.abs(userLat) <= 90 &&
    Math.abs(userLng) <= 180;
  const distanceOriginLat = hasUserDistanceOrigin ? userLat : lat;
  const distanceOriginLng = hasUserDistanceOrigin ? userLng : lng;

  try {
    if (!(await isMeiliHealthy())) {
      return NextResponse.json(
        { error: "Search service unavailable" },
        { status: 503 }
      );
    }

    const index = getCompaniesIndex();
    const rawQuery = query.trim();
    const isAddressQuery = isAddressLikeLocationQuery(rawQuery);
    const normalizedAddressQuery = isAddressQuery ? normalizeLocationQueryForSearch(rawQuery) : "";
    const normalizedQuery = isAddressQuery ? "" : normalizeNearbyQuery(rawQuery);
    const contextOnlyQuery = isAddressQuery ? false : isContextOnlyNearbyQuery(rawQuery);
    const searchQuery = isAddressQuery
      ? (normalizedAddressQuery || rawQuery)
      : (normalizedQuery || (contextOnlyQuery ? "" : rawQuery));
    const queryServiceTokens = isAddressQuery ? [] : tokenizeServiceQuery(searchQuery);
    const queryHasTransportIntent = !isAddressQuery && hasTransportIntentToken(queryServiceTokens);
    const applyMilkFilter = !isAddressQuery && shouldApplyMilkFilter(searchQuery);
    const applyCheeseFilter = !isAddressQuery && shouldApplyCheeseFilter(searchQuery);
    const applyBreadFilter = !isAddressQuery && shouldApplyBreadFilter(searchQuery) && !queryHasTransportIntent;
    const applyKeywordFilter = applyMilkFilter || applyCheeseFilter || applyBreadFilter;
    const strictQueryTokens = tokenizeForStrictMatch(searchQuery);
    const addressQueryHasHouseToken = isAddressQuery && /\d/u.test(searchQuery);
    const addressQueryIsStreetOnly = isAddressQuery && !addressQueryHasHouseToken && strictQueryTokens.length > 0;
    const queryTokenCount = tokenizeServiceQuery(searchQuery).length;
    const queryMatchingStrategy = searchQuery
      ? (isAddressQuery ? "all" : (queryTokenCount > 1 ? "last" : "all"))
      : undefined;
    const applyFoodVenueFilter = !isAddressQuery && queryServiceTokens.length > 0 && hasFoodVenueToken(queryServiceTokens);
    const applySchoolFilter =
      !isAddressQuery &&
      queryServiceTokens.length > 0 &&
      hasSchoolIntentToken(queryServiceTokens) &&
      !hasKindergartenIntentToken(queryServiceTokens);
    const applyKindergartenFilter =
      !isAddressQuery &&
      queryServiceTokens.length > 0 &&
      hasKindergartenFocusedIntentToken(queryServiceTokens);
    const useStrictFoodVenueFilter =
      applyFoodVenueFilter &&
      queryServiceTokens.length > 0 &&
      queryServiceTokens.every((token) => FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));
    const applyDistrictFilter = isSupportedDistrictFilter(districtName);
    const useDistrictBoundsOnly = applyDistrictFilter && hasGeoBoundingBox;
    const geoFilters: string[] = [];
    if (!useDistrictBoundsOnly) {
      geoFilters.push(`_geoRadius(${lat}, ${lng}, ${safeRadius})`);
    }
    if (hasGeoBoundingBox) {
      geoFilters.push(`_geoBoundingBox([${bboxNorthLat}, ${bboxEastLng}], [${bboxSouthLat}, ${bboxWestLng}])`);
    }
    if (geoFilters.length === 0) {
      geoFilters.push(`_geoRadius(${lat}, ${lng}, ${safeRadius})`);
    }

    // Build search options
    const searchOptions: any = {
      limit: safeLimit,
      offset: safeOffset,
      filter: geoFilters,
      matchingStrategy: queryMatchingStrategy,
      attributesToSearchOn: searchQuery
        ? (isAddressQuery
          ? ["address", "name", "keywords", "rubric_names", "category_names"]
          : ["keywords", "rubric_names", "category_names", "name"])
        : undefined,
      attributesToRetrieve: [
        "id",
        "unp",
        "name",
        "address",
        "category_names",
        "rubric_names",
        "_geoDistance",
        "_geo",
        "keywords",
      ],
    };

    const result = await index.search(searchQuery || "", searchOptions);
    const filteredHits: any[] = [];
    for (const hit of result.hits as any[]) {
      if (isExcludedBiznesinfoCompany({ source_id: hit?.id || "", unp: hit?.unp || "" })) continue;
      if (
        strictQueryTokens.length > 0 &&
        !hitMatchesStrictQuery(hit, strictQueryTokens, { requireAllTokens: addressQueryHasHouseToken })
      ) continue;
      if (isAddressQuery && addressQueryHasHouseToken && !hitMatchesAddressHouseQuery(hit?.address || "", searchQuery)) continue;
      if (addressQueryIsStreetOnly && !hitMatchesAddressStreetQuery(hit?.address || "", searchQuery)) continue;
      if (applyFoodVenueFilter) {
        const matchesFoodVenue = useStrictFoodVenueFilter
          ? hitMatchesStrictFoodVenueIntent(hit)
          : hitMatchesFoodVenueIntent(hit);
        if (!matchesFoodVenue) continue;
      }
      if (applySchoolFilter && !hitMatchesSchoolIntent(hit)) continue;
      if (applyKindergartenFilter && !hitMatchesKindergartenIntent(hit)) continue;
      if (applyKeywordFilter) {
        const keywords: string[] = hit?.keywords || [];
        if (applyMilkFilter && !hasMilkKeyword(keywords)) continue;
        if (applyCheeseFilter && !hasCheeseKeyword(keywords)) continue;
        if (applyBreadFilter && !hasBreadKeyword(keywords)) continue;
      }
      filteredHits.push(hit);
    }

    const hitIds = filteredHits
      .map((hit) => String(hit?.id || "").trim())
      .filter(Boolean);
    const hitGeoById = new Map<string, { lat: number; lng: number } | null>();
    for (const hit of filteredHits) {
      const id = String(hit?.id || "").trim();
      if (!id) continue;
      const geo = hit?._geo;
      if (Number.isFinite(geo?.lat) && Number.isFinite(geo?.lng)) {
        hitGeoById.set(id, { lat: geo.lat as number, lng: geo.lng as number });
      } else {
        hitGeoById.set(id, null);
      }
    }

    const cards = await biznesinfoGetCompanyCardsByIds(hitIds);
    const companies: NearbyCompany[] = [];
    for (const card of cards) {
      if (
        await isLiquidatedByKartoteka({
          source_id: card.id,
          unp: card.unp || "",
          name: card.name || "",
          city: card.city || "",
          address: card.address || "",
        })
      ) {
        continue;
      }
      if (applyMilkFilter && !cardMatchesMilkIntent(card)) {
        continue;
      }
      if (applyFoodVenueFilter && !cardMatchesFoodVenueIntent(card)) {
        continue;
      }
      if (applyBreadFilter && !cardMatchesBreadIntent(card)) {
        continue;
      }
      if (applySchoolFilter && !cardMatchesSchoolIntent(card)) {
        continue;
      }
      if (applyKindergartenFilter && !cardMatchesKindergartenIntent(card)) {
        continue;
      }
      if (applyDistrictFilter && !cardMatchesDistrictFilter(card, districtName)) {
        continue;
      }

      const geo = hitGeoById.get(card.id) ?? card.geo ?? null;
      const normalizedCity = normalizeNearbyCityByAddress(card.address || "", card.city || "");
      const normalizedAddress = normalizeNearbyAddressByCity(card.address || "", normalizedCity);
      companies.push({
        id: card.id,
        name: card.name,
        description: card.description,
        address: normalizedAddress,
        city: normalizedCity || card.city,
        phones: card.phones || [],
        emails: card.emails || [],
        logo_url: card.logo_url,
        categories: card.categories || [],
        rubrics: card.rubrics || [],
        distance: distanceMetersBetweenPoints(distanceOriginLat, distanceOriginLng, geo?.lat, geo?.lng),
        _geo: geo,
      });
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    const uniqueCompanies = companies.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    const hasPostFilter =
      applyKeywordFilter ||
      applyFoodVenueFilter ||
      applySchoolFilter ||
      applyKindergartenFilter ||
      strictQueryTokens.length > 0 ||
      (isAddressQuery && addressQueryHasHouseToken);
    const estimatedTotal = Number.isFinite(result.estimatedTotalHits)
      ? Number(result.estimatedTotalHits)
      : uniqueCompanies.length;

    const response: NearbySearchResponse = {
      companies: uniqueCompanies,
      total: hasPostFilter ? uniqueCompanies.length : Math.max(estimatedTotal, uniqueCompanies.length),
      offset: safeOffset,
      limit: safeLimit,
      query: rawQuery,
      center: { lat, lng },
      radius: safeRadius,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Nearby search error:", error);
    return NextResponse.json(
      { error: "Search failed", details: String(error) },
      { status: 500 }
    );
  }
}
