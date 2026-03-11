import { NextResponse } from "next/server";
import { getCompaniesIndex, isMeiliHealthy } from "@/lib/meilisearch";
import { isExcludedBiznesinfoCompany } from "@/lib/biznesinfo/exclusions";
import { isLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";
import { biznesinfoGetCompanyCardsByIds } from "@/lib/biznesinfo/postgres";

export const runtime = "nodejs";

const DEFAULT_NEARBY_RADIUS = 10000; // 10 km
const MIN_NEARBY_RADIUS = 1000; // 1 km
const MAX_NEARBY_RADIUS = 100000; // 100 km
const MAX_NEARBY_LIMIT = 2000;

const SERVICE_QUERY_INTENT_STOP_WORDS = new Set([
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

function normalizeServiceQueryToken(token: string): string {
  const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return "";
  return t;
}

function hasFoodVenueToken(tokens: string[]): boolean {
  return tokens.some((token) => FOOD_VENUE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));
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
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  const hasWeakVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && !hasWeakVenueSignal) return false;

  const hasNegativeSignal = fieldTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );

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
    FOOD_VENUE_STRONG_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  const hasWeakVenueSignal = fieldTokens.some((token) =>
    FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && !hasWeakVenueSignal) return false;

  const hasNegativeSignal = fieldTokens.some((token) =>
    FOOD_VENUE_NEGATIVE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)),
  );
  if (!hasStrongVenueSignal && hasNegativeSignal) return false;

  return true;
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
    .map((token) => normalizeServiceQueryToken(token))
    .filter(Boolean);

  if (picked.length > 1 && hasFoodVenueToken(picked)) {
    const withoutCuisine = picked.filter((token) => !isCuisineQualifierToken(token));
    if (withoutCuisine.length > 0) {
      picked = withoutCuisine;
    }
  }

  if (picked.length > 0 && picked.every((token) => isCheeseIntentToken(token))) {
    return "молочная";
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
  return tokens.some((t) => t.startsWith("молок"));
}

function shouldApplyCheeseFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((t) => isCheeseIntentToken(t));
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

function canonicalizeStrictToken(raw: string): string {
  const t = normalizeServiceQueryToken(raw);
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

function hitMatchesStrictQuery(hit: any, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;

  const searchableSource = [
    hit?.name || "",
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  
  const query = searchParams.get("q") || "";
  const lat = parseFloat(searchParams.get("lat") || "0");
  const lng = parseFloat(searchParams.get("lng") || "0");
  const radius = parseInt(searchParams.get("radius") || String(DEFAULT_NEARBY_RADIUS), 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

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

  try {
    if (!(await isMeiliHealthy())) {
      return NextResponse.json(
        { error: "Search service unavailable" },
        { status: 503 }
      );
    }

    const index = getCompaniesIndex();
    const rawQuery = query.trim();
    const normalizedQuery = normalizeNearbyQuery(rawQuery);
    const contextOnlyQuery = isContextOnlyNearbyQuery(rawQuery);
    const searchQuery = normalizedQuery || (contextOnlyQuery ? "" : rawQuery);
    const applyMilkFilter = shouldApplyMilkFilter(searchQuery);
    const applyCheeseFilter = shouldApplyCheeseFilter(searchQuery);
    const applyKeywordFilter = applyMilkFilter || applyCheeseFilter;
    const strictQueryTokens = tokenizeForStrictMatch(searchQuery);
    const queryTokenCount = tokenizeServiceQuery(searchQuery).length;
    const queryMatchingStrategy = searchQuery ? (queryTokenCount > 1 ? "last" : "all") : undefined;
    const queryServiceTokens = tokenizeServiceQuery(searchQuery);
    const applyFoodVenueFilter = queryServiceTokens.length > 0 && hasFoodVenueToken(queryServiceTokens);
    const useStrictFoodVenueFilter =
      applyFoodVenueFilter &&
      queryServiceTokens.length > 0 &&
      queryServiceTokens.every((token) => FOOD_VENUE_WEAK_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)));

    // Build search options
    const searchOptions: any = {
      limit: safeLimit,
      offset: safeOffset,
      filter: [
        `_geoRadius(${lat}, ${lng}, ${safeRadius})`,
      ],
      matchingStrategy: queryMatchingStrategy,
      attributesToSearchOn: searchQuery ? ["keywords", "rubric_names", "category_names", "name"] : undefined,
      attributesToRetrieve: [
        "id",
        "unp",
        "name",
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
      if (strictQueryTokens.length > 0 && !hitMatchesStrictQuery(hit, strictQueryTokens)) continue;
      if (applyFoodVenueFilter) {
        const matchesFoodVenue = useStrictFoodVenueFilter
          ? hitMatchesStrictFoodVenueIntent(hit)
          : hitMatchesFoodVenueIntent(hit);
        if (!matchesFoodVenue) continue;
      }
      if (applyKeywordFilter) {
        const keywords: string[] = hit?.keywords || [];
        if (applyMilkFilter && !hasMilkKeyword(keywords)) continue;
        if (applyCheeseFilter && !hasCheeseKeyword(keywords)) continue;
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

      const geo = hitGeoById.get(card.id) ?? card.geo ?? null;
      companies.push({
        id: card.id,
        name: card.name,
        description: card.description,
        address: card.address,
        city: card.city,
        phones: card.phones || [],
        emails: card.emails || [],
        logo_url: card.logo_url,
        categories: card.categories || [],
        rubrics: card.rubrics || [],
        distance: distanceMetersBetweenPoints(lat, lng, geo?.lat, geo?.lng),
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
    const hasPostFilter = applyKeywordFilter || strictQueryTokens.length > 0;

    const response: NearbySearchResponse = {
      companies: uniqueCompanies,
      total: hasPostFilter ? uniqueCompanies.length : (result.estimatedTotalHits || uniqueCompanies.length),
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
