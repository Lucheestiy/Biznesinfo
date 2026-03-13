const ADDRESS_MARKERS_RE =
  /(?:^|[\s,.;:()\-])(?:ул\.?|улица|пр-?т\.?|просп\.?|проспект|пер\.?|переулок|пл\.?|площадь|наб\.?|набережная|бул\.?|бульвар|шоссе|тракт|дом|кв\.?|квартира|корп\.?|корпус|оф\.?|офис)(?=$|[\s,.;:()\-])/iu;

const STREET_LIKE_SINGLE_TOKEN_RE =
  /(?:ская|ский|ской|ского|скую|ские|ская|ная|ной|ного|ную|ный|ная|ое|ого|евская|овская|инская|енская|анская|ская)$/iu;
const STREET_PERSON_SINGLE_TOKEN_RE =
  /(?:ей|ого|ова|ева|ина|ына|ича|вича)$/iu;

const SETTLEMENT_PREFIXES = new Set([
  "г",
  "город",
  "гп",
  "гпт",
  "пгт",
  "пос",
  "поселок",
  "посёлок",
  "п",
  "д",
  "дер",
  "деревня",
  "с",
  "село",
  "аг",
  "агрогородок",
]);

const BELARUS_CITY_ALIAS_TO_CANONICAL: Record<string, string> = {
  "минск": "Минск",
  "минске": "Минск",
  "минска": "Минск",
  "minsk": "Минск",
  "брест": "Брест",
  "бресте": "Брест",
  "бреста": "Брест",
  "brest": "Брест",
  "гродно": "Гродно",
  "гродне": "Гродно",
  "гродна": "Гродно",
  "grodno": "Гродно",
  "hrodna": "Гродно",
  "витебск": "Витебск",
  "витебске": "Витебск",
  "витебска": "Витебск",
  "vitebsk": "Витебск",
  "гомель": "Гомель",
  "гомеле": "Гомель",
  "гомеля": "Гомель",
  "gomel": "Гомель",
  "homel": "Гомель",
  "могилев": "Могилев",
  "могилеве": "Могилев",
  "могилева": "Могилев",
  "могилеву": "Могилев",
  "могилёв": "Могилев",
  "могилёве": "Могилев",
  "могилёва": "Могилев",
  "могилёву": "Могилев",
  "mogilev": "Могилев",
  "mohilev": "Могилев",
};

const BELARUS_REGION_ALIAS_TO_CANONICAL: Record<string, string> = {
  "minsk": "Минск",
  "minsk-region": "Минская область",
  "minsk region": "Минская область",
  "минская область": "Минская область",
  "brest": "Брестская область",
  "brest-region": "Брестская область",
  "brest region": "Брестская область",
  "брестская область": "Брестская область",
  "vitebsk": "Витебская область",
  "vitebsk-region": "Витебская область",
  "vitebsk region": "Витебская область",
  "витебская область": "Витебская область",
  "gomel": "Гомельская область",
  "gomel-region": "Гомельская область",
  "gomel region": "Гомельская область",
  "гомельская область": "Гомельская область",
  "grodno": "Гродненская область",
  "grodno-region": "Гродненская область",
  "grodno region": "Гродненская область",
  "гродненская область": "Гродненская область",
  "mogilev": "Могилевская область",
  "mogilev-region": "Могилевская область",
  "mogilev region": "Могилевская область",
  "могилевская область": "Могилевская область",
  "могилёвская область": "Могилевская область",
};

function normalizeGeoLabelKey(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/_/gu, "-")
    .replace(/[«»"'“”„()]/gu, " ")
    .replace(/[.,;:!?/\\]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function localizeBelarusGeoLabel(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  const normalizedKey = normalizeGeoLabelKey(trimmed);
  if (!normalizedKey) return trimmed;

  const regionLabel = BELARUS_REGION_ALIAS_TO_CANONICAL[normalizedKey];
  if (regionLabel) return regionLabel;

  const cityLabel = canonicalBelarusCityFromTail(trimmed);
  if (cityLabel) return cityLabel;

  return trimmed;
}

function escapeRegExp(raw: string): string {
  return String(raw || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripPostalPrefix(raw: string): string {
  return String(raw || "")
    .replace(/^\s*\d{6}\s*,?\s*/u, "")
    .trim();
}

function stripCityPrefixFromAddress(rawAddress: string, cityLabel: string): string {
  let address = stripPostalPrefix(rawAddress);
  if (!address) return "";

  const city = localizeBelarusGeoLabel(cityLabel || "").trim();
  if (!city) return address;

  const variants = Array.from(
    new Set([
      city,
      city.toLowerCase(),
      city.replace(/ё/gu, "е"),
      city.toLowerCase().replace(/ё/gu, "е"),
    ].filter(Boolean)),
  );

  for (const variant of variants) {
    const re = new RegExp(`^(?:г\\.?\\s*)?${escapeRegExp(variant)}\\s*,?\\s*`, "iu");
    address = address.replace(re, "").trim();
  }

  return address.replace(/^,\s*/u, "").replace(/\s+/gu, " ").trim();
}

export function buildCompanySuggestSubtitle(cityRaw: string, addressRaw: string): string {
  const city = localizeBelarusGeoLabel(cityRaw || "").trim();
  const address = stripCityPrefixFromAddress(addressRaw || "", city);

  if (city && address) {
    const cityNorm = city.toLowerCase().replace(/ё/gu, "е");
    const addressNorm = address.toLowerCase().replace(/ё/gu, "е");
    if (cityNorm === addressNorm) return city;
    return `${city}, ${address}`;
  }

  if (city) return city;
  if (address) return address;
  return "";
}

function canonicalBelarusCityFromTail(rawTail: string): string | null {
  const cleaned = (rawTail || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„()]/gu, " ")
    .replace(/[.,;:!?/\\]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;

  const candidates = [
    cleaned,
    cleaned.replace(/^(в|во|по)\s+/u, "").trim(),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCityForFilter(candidate);
    if (!normalized) continue;
    const canonical = BELARUS_CITY_ALIAS_TO_CANONICAL[normalized];
    if (canonical) return canonical;
  }
  return null;
}

function isLocationConnectorToken(raw: string): boolean {
  const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
  return t === "в" || t === "во" || t === "по";
}

function cleanServiceTokens(parts: string[]): string {
  const cleaned = [...parts];
  while (cleaned.length > 0 && isLocationConnectorToken(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  return cleaned.join(" ").replace(/[,\-–—]+$/u, "").trim();
}

function tryExtractCityFromServiceParts(
  parts: string[],
  requiredCanonicalCity?: string | null,
): { service: string; city: string } | null {
  if (parts.length === 0) return null;
  const maxLen = Math.min(3, parts.length);
  const seen = new Set<string>();

  for (let cityLen = maxLen; cityLen >= 1; cityLen -= 1) {
    const tailStart = parts.length - cityLen;
    const candidates: number[] = [tailStart, 0];
    for (let start = 0; start <= parts.length - cityLen; start += 1) {
      candidates.push(start);
    }

    for (const start of candidates) {
      if (start < 0 || start > parts.length - cityLen) continue;
      const key = `${start}:${cityLen}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cityChunk = parts.slice(start, start + cityLen).join(" ");
      const inferredCity = canonicalBelarusCityFromTail(cityChunk);
      if (!inferredCity) continue;
      if (requiredCanonicalCity && inferredCity !== requiredCanonicalCity) continue;

      const rest = [...parts.slice(0, start), ...parts.slice(start + cityLen)];
      const connectorIndex = start - 1;
      if (connectorIndex >= 0 && connectorIndex < rest.length && isLocationConnectorToken(rest[connectorIndex])) {
        rest.splice(connectorIndex, 1);
      }

      return {
        service: cleanServiceTokens(rest),
        city: requiredCanonicalCity || inferredCity,
      };
    }
  }

  return null;
}

export function normalizeCityForFilter(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  const cleaned = trimmed
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!cleaned) return "";

  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) return "";

  // Handle common multi-token prefixes like "г п" (from "г.п.")
  if (parts.length >= 2 && parts[0] === "г" && parts[1] === "п") {
    return parts.slice(2).join(" ").trim();
  }

  if (SETTLEMENT_PREFIXES.has(parts[0])) {
    return parts.slice(1).join(" ").trim();
  }

  return parts.join(" ").trim();
}

export function isAddressLikeLocationQuery(raw: string): boolean {
  const s = (raw || "").trim();
  if (!s) return false;
  if (/\d/u.test(s)) return true;
  if (ADDRESS_MARKERS_RE.test(s)) return true;

  // Heuristic for common street-only input without explicit marker:
  // "Советская", "Первомайская", "Центральная", ...
  const normalized = s
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return false;

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length !== 1) return false;

  const token = parts[0];
  if (token.length < 5) return false;
  if (canonicalBelarusCityFromTail(token)) return false;
  return STREET_LIKE_SINGLE_TOKEN_RE.test(token) || STREET_PERSON_SINGLE_TOKEN_RE.test(token);
}

const LOCATION_SEARCH_STOP_WORDS = new Set([
  "г",
  "город",
  "ул",
  "улица",
  "пр",
  "пр-т",
  "просп",
  "проспект",
  "пер",
  "переулок",
  "бул",
  "бульвар",
  "наб",
  "набережная",
  "пл",
  "площадь",
  "д",
  "дом",
  "к",
  "корп",
  "корпус",
  "оф",
  "офис",
  "кв",
  "квартира",
  "р-н",
  "район",
  "обл",
  "область",
]);

export function normalizeLocationQueryForSearch(raw: string): string {
  const cleaned = (raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return "";

  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => {
      if (LOCATION_SEARCH_STOP_WORDS.has(t)) return false;
      if (/^\d+$/u.test(t)) return true;
      return t.length >= 2;
    });

  return tokens.join(" ").trim();
}

export function splitServiceAndCity(rawService: string, rawCity?: string | null): {
  service: string;
  city: string;
} {
  const city = (rawCity || "").trim();
  const service = (rawService || "").trim();
  if (!service) return { service, city };

  const explicitCanonicalCity = canonicalBelarusCityFromTail(city);
  const explicitCityOut = explicitCanonicalCity || city;
  const parts = service.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return { service, city: explicitCityOut };

  // If city is explicitly provided, strip duplicated city tail from service
  // (e.g. "молоко Гродно" + city="Гродно", "Гродно молоко" + city="Гродно").
  if (explicitCanonicalCity) {
    const stripped = tryExtractCityFromServiceParts(parts, explicitCanonicalCity);
    if (stripped) {
      return { service: stripped.service, city: explicitCityOut };
    }
    return { service, city: explicitCityOut };
  }

  if (city) return { service, city };

  const inferred = tryExtractCityFromServiceParts(parts);
  if (inferred) {
    return inferred;
  }

  return { service, city: explicitCityOut };
}
