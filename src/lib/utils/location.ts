const ADDRESS_MARKERS_RE =
  /\b(ул\.?|улица|пр-?т\.?|просп\.?|проспект|пер\.?|переулок|пл\.?|площадь|наб\.?|набережная|бул\.?|бульвар|шоссе|тракт|дом|кв\.?|квартира|корп\.?|корпус|оф\.?|офис)\b/iu;

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
  return ADDRESS_MARKERS_RE.test(s);
}

