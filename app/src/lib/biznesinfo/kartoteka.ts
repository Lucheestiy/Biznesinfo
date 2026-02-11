import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isExcludedBiznesinfoCompany,
  normalizeBiznesinfoUnp,
  rememberLiquidatedBiznesinfoCompany,
} from "./exclusions";

type KartotekaStatus = "active" | "liquidated" | "unknown";

type KartotekaCacheEntry = {
  status: KartotekaStatus;
  checkedAtMs: number;
  sourceStatus: string;
};

type KartotekaCacheFile = {
  version: 1 | 2;
  // Legacy v1 shape (UNP only).
  entries?: Record<string, KartotekaCacheEntry>;
  // v2 shape.
  byUnp?: Record<string, KartotekaCacheEntry>;
  byName?: Record<string, KartotekaCacheEntry>;
};

type KartotekaLookupCandidate = {
  source_id?: string | null;
  id?: string | null;
  unp?: string | null;
  name?: string | null;
  city?: string | null;
  address?: string | null;
};

type KartotekaSearchItem = {
  title?: unknown;
  short_title?: unknown;
  full_name_rus?: unknown;
  address?: unknown;
  status?: unknown;
  status_num?: unknown;
  active?: unknown;
  date_of_elimination?: unknown;
  elimination_description?: unknown;
};

type KartotekaNameMatchCandidate = {
  item: KartotekaSearchItem;
  status: KartotekaStatus;
  sourceStatus: string;
  exactCanonical: boolean;
  matchedTokenCount: number;
  queryTokenCount: number;
  candidateTokenCount: number;
  coverage: number;
  cityMatch: boolean;
  addressMatch: boolean;
  rank: number;
};

const KARTOTEKA_API_BASE_URL = process.env.KARTOTEKA_API_BASE_URL?.trim() || "https://api.kartoteka.by";
const KARTOTEKA_PUBLIC_SEARCH_BASE_URL =
  process.env.KARTOTEKA_PUBLIC_SEARCH_BASE_URL?.trim() || "https://apiv1.kartoteka.by";
const KARTOTEKA_API_TOKEN = process.env.KARTOTEKA_API_TOKEN?.trim() || "";
const KARTOTEKA_TIMEOUT_MS = Number.parseInt(process.env.KARTOTEKA_TIMEOUT_MS || "5000", 10);
const KARTOTEKA_CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.KARTOTEKA_CACHE_TTL_HOURS || "168", 10) * 60 * 60 * 1000,
);
const KARTOTEKA_NAME_CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.KARTOTEKA_NAME_CACHE_TTL_HOURS || "24", 10) * 60 * 60 * 1000,
);
const KARTOTEKA_CACHE_PATH =
  process.env.BIZNESINFO_KARTOTEKA_CACHE_PATH?.trim() ||
  path.join(os.tmpdir(), "biznesinfo-kartoteka-egr-cache.json");

const kartotekaCacheByUnp = new Map<string, KartotekaCacheEntry>();
const kartotekaCacheByName = new Map<string, KartotekaCacheEntry>();
const pendingByUnp = new Map<string, Promise<boolean>>();
const pendingByNameKey = new Map<string, Promise<boolean>>();
const pendingNameSearchByQuery = new Map<string, Promise<KartotekaSearchItem[]>>();
const nameSearchCache = new Map<string, { checkedAtMs: number; items: KartotekaSearchItem[] }>();

let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;
let cacheWriteChain: Promise<void> = Promise.resolve();

const COMPANY_NAME_STOP_WORDS = new Set<string>([
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
  "мчп",
  "сп",
  "птуп",
  "унитарное",
  "предприятие",
  "предприятия",
  "общество",
  "обществою",
  "ограниченной",
  "ответственностью",
  "открытое",
  "закрытое",
  "акционерное",
  "частное",
  "совместное",
  "иностранное",
  "торговое",
  "производственное",
  "производственно",
  "коммерческое",
  "фирма",
  "кооператив",
  "индивидуальный",
  "предприниматель",
]);

const ADDRESS_STOP_WORDS = new Set<string>([
  "г",
  "город",
  "ул",
  "улица",
  "пр",
  "проспект",
  "пер",
  "переулок",
  "бульвар",
  "б-р",
  "наб",
  "набережная",
  "пл",
  "площадь",
  "дом",
  "д",
  "корп",
  "корпус",
  "ком",
  "кв",
  "область",
  "обл",
  "район",
  "рн",
  "р",
  "республика",
  "беларусь",
]);

function hasKartotekaToken(): boolean {
  return KARTOTEKA_API_TOKEN.length > 0;
}

function isValidUnp(unp: string): boolean {
  return /^\d{9}$/u.test(unp);
}

function normalizeStatusText(raw: unknown): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
}

function decodeHtmlEntities(raw: string): string {
  return (raw || "")
    .replace(/&quot;/gu, '"')
    .replace(/&#34;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&#039;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&nbsp;/gu, " ");
}

function normalizeMatchText(raw: unknown): string {
  return decodeHtmlEntities(String(raw || ""))
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenizeNameForMatch(raw: unknown): string[] {
  const cleaned = normalizeMatchText(raw).replace(/[^\p{L}\p{N}]+/gu, " ");
  const tokens = cleaned
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  return tokens.filter((token) => {
    if (/^\d+$/u.test(token)) return false;
    if (token.length < 2) return false;
    if (COMPANY_NAME_STOP_WORDS.has(token)) return false;
    return true;
  });
}

function canonicalizeCompanyName(raw: unknown): string {
  const uniq = Array.from(new Set(tokenizeNameForMatch(raw)));
  uniq.sort();
  return uniq.join(" ").trim();
}

function normalizeCityForMatch(raw: unknown): string {
  return normalizeMatchText(raw)
    .replace(/\bг(?:ород)?\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenizeAddressForMatch(raw: unknown, cityNorm: string): string[] {
  const cleaned = normalizeMatchText(raw).replace(/[^\p{L}\p{N}]+/gu, " ");
  const tokens = cleaned
    .split(/\s+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  const cityTokenSet = new Set(
    cityNorm
      .split(/\s+/u)
      .map((t) => t.trim())
      .filter(Boolean),
  );

  return tokens.filter((token) => {
    if (/^\d+$/u.test(token)) return false;
    if (token.length < 4) return false;
    if (ADDRESS_STOP_WORDS.has(token)) return false;
    if (cityTokenSet.has(token)) return false;
    return true;
  });
}

function tokenLooseMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.startsWith(left)) return true;
  if (right.length >= 5 && left.startsWith(right)) return true;
  return false;
}

function isLiquidatedStatusText(raw: unknown): boolean {
  const status = normalizeStatusText(raw);
  if (!status) return false;
  return /(ликвид|исключен|прекращ|действие прекращ|liquidat|dissolv)/u.test(status);
}

function inferKartotekaStatus(payload: any): { status: KartotekaStatus; sourceStatus: string } {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (!rows.length) return { status: "unknown", sourceStatus: "" };

  const row = rows[0] || {};
  const sourceStatus = String(row.status || "").trim();
  const eliminationDate = String(row.date_of_elimination || "").trim();
  const eliminationDescription = String(row.elimination_description || "").trim();

  if (eliminationDate) {
    return { status: "liquidated", sourceStatus: sourceStatus || eliminationDate };
  }
  if (isLiquidatedStatusText(sourceStatus) || isLiquidatedStatusText(eliminationDescription)) {
    return { status: "liquidated", sourceStatus };
  }
  if (sourceStatus) {
    return { status: "active", sourceStatus };
  }
  return { status: "unknown", sourceStatus: "" };
}

function inferKartotekaStatusFromSearchItem(item: KartotekaSearchItem): {
  status: KartotekaStatus;
  sourceStatus: string;
} {
  const sourceStatus = String(item.status || "").trim();
  const eliminationDate = String(item.date_of_elimination || "").trim();
  const eliminationDescription = String(item.elimination_description || "").trim();

  const statusNum = Number(item.status_num);
  const activeNum = Number(item.active);

  if (eliminationDate) return { status: "liquidated", sourceStatus: sourceStatus || eliminationDate };
  if (Number.isFinite(activeNum) && activeNum === 0) return { status: "liquidated", sourceStatus };
  if (Number.isFinite(statusNum) && statusNum === 0) return { status: "liquidated", sourceStatus };
  if (isLiquidatedStatusText(sourceStatus) || isLiquidatedStatusText(eliminationDescription)) {
    return { status: "liquidated", sourceStatus };
  }

  const normalized = normalizeStatusText(sourceStatus);
  if (Number.isFinite(activeNum) && activeNum === 1) return { status: "active", sourceStatus };
  if (Number.isFinite(statusNum) && statusNum === 1) return { status: "active", sourceStatus };
  if (/действ/u.test(normalized) || /active/u.test(normalized)) {
    return { status: "active", sourceStatus };
  }

  return { status: "unknown", sourceStatus };
}

function buildNameLookupKey(name: string, city: string, address: string): string {
  const canonicalName = canonicalizeCompanyName(name);
  if (!canonicalName) return "";

  const cityNorm = normalizeCityForMatch(city);
  const addressTokens = tokenizeAddressForMatch(address, cityNorm).slice(0, 3).sort();
  return [canonicalName, cityNorm, addressTokens.join(" ")].join("|");
}

function maybeFilterByLocation(
  rows: KartotekaNameMatchCandidate[],
  key: "cityMatch" | "addressMatch",
): KartotekaNameMatchCandidate[] {
  const filtered = rows.filter((row) => row[key]);
  return filtered.length > 0 ? filtered : rows;
}

function matchKartotekaItemsByName(candidate: {
  name: string;
  city: string;
  address: string;
  items: KartotekaSearchItem[];
}): { status: KartotekaStatus; sourceStatus: string } {
  const queryTokens = tokenizeNameForMatch(candidate.name);
  const queryTokenCount = queryTokens.length;
  if (queryTokenCount === 0) return { status: "unknown", sourceStatus: "" };

  const queryCanonical = canonicalizeCompanyName(candidate.name);
  const cityNorm = normalizeCityForMatch(candidate.city);
  const addressTokens = tokenizeAddressForMatch(candidate.address, cityNorm);

  const matches: KartotekaNameMatchCandidate[] = [];

  for (const item of candidate.items || []) {
    const variants = [item.short_title, item.title, item.full_name_rus]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    if (!variants.length) continue;

    let bestVariant:
      | {
          exactCanonical: boolean;
          matchedTokenCount: number;
          candidateTokenCount: number;
        }
      | null = null;

    for (const variant of variants) {
      const candidateTokens = tokenizeNameForMatch(variant);
      if (!candidateTokens.length) continue;

      let matchedTokenCount = 0;
      for (const queryToken of queryTokens) {
        if (candidateTokens.some((candidateToken) => tokenLooseMatch(queryToken, candidateToken))) {
          matchedTokenCount += 1;
        }
      }

      if (matchedTokenCount === 0) continue;
      const exactCanonical = queryCanonical.length > 0 && canonicalizeCompanyName(variant) === queryCanonical;

      const current = {
        exactCanonical,
        matchedTokenCount,
        candidateTokenCount: candidateTokens.length,
      };

      if (!bestVariant) {
        bestVariant = current;
        continue;
      }

      if (current.exactCanonical && !bestVariant.exactCanonical) {
        bestVariant = current;
        continue;
      }

      if (current.exactCanonical === bestVariant.exactCanonical) {
        if (current.matchedTokenCount > bestVariant.matchedTokenCount) {
          bestVariant = current;
          continue;
        }
        if (
          current.matchedTokenCount === bestVariant.matchedTokenCount
          && current.candidateTokenCount < bestVariant.candidateTokenCount
        ) {
          bestVariant = current;
        }
      }
    }

    if (!bestVariant) continue;

    const coverage = bestVariant.matchedTokenCount / queryTokenCount;
    if (!bestVariant.exactCanonical && coverage < 1) continue;

    const itemAddressNorm = normalizeMatchText(item.address || "");
    const cityMatch = cityNorm.length > 0 && itemAddressNorm.includes(cityNorm);
    const addressMatch =
      addressTokens.length > 0
      && addressTokens.some((token) => itemAddressNorm.includes(token));

    const statusInfo = inferKartotekaStatusFromSearchItem(item);

    const specificityPenalty = Math.max(0, bestVariant.candidateTokenCount - bestVariant.matchedTokenCount);
    const rank =
      (bestVariant.exactCanonical ? 1000 : 0)
      + coverage * 100
      + (cityMatch ? 20 : 0)
      + (addressMatch ? 20 : 0)
      - specificityPenalty;

    matches.push({
      item,
      status: statusInfo.status,
      sourceStatus: statusInfo.sourceStatus,
      exactCanonical: bestVariant.exactCanonical,
      matchedTokenCount: bestVariant.matchedTokenCount,
      queryTokenCount,
      candidateTokenCount: bestVariant.candidateTokenCount,
      coverage,
      cityMatch,
      addressMatch,
      rank,
    });
  }

  if (matches.length === 0) return { status: "unknown", sourceStatus: "" };

  let narrowed = matches;
  narrowed = maybeFilterByLocation(narrowed, "cityMatch");
  narrowed = maybeFilterByLocation(narrowed, "addressMatch");

  narrowed.sort((left, right) => right.rank - left.rank);
  const top = narrowed[0];
  if (!top) return { status: "unknown", sourceStatus: "" };

  // For one-token names, avoid hiding on weak/no-location matches.
  if (top.queryTokenCount <= 1 && !top.cityMatch && !top.addressMatch) {
    return { status: "unknown", sourceStatus: "" };
  }

  const close = narrowed.filter((item) => top.rank - item.rank <= 2);
  const knownStatuses = new Set(close.map((item) => item.status).filter((status) => status !== "unknown"));
  if (knownStatuses.size > 1) {
    // Ambiguous match with conflicting statuses -> fail-open.
    return { status: "unknown", sourceStatus: "" };
  }

  return { status: top.status, sourceStatus: top.sourceStatus };
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = (async () => {
    try {
      const raw = await fs.readFile(KARTOTEKA_CACHE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as KartotekaCacheFile;

      const byUnpEntries = parsed?.byUnp || parsed?.entries || {};
      for (const [unp, entry] of Object.entries(byUnpEntries)) {
        const normalizedUnp = normalizeBiznesinfoUnp(unp);
        if (!isValidUnp(normalizedUnp)) continue;
        if (!entry || typeof entry !== "object") continue;

        const checkedAtMs = Number(entry.checkedAtMs);
        const status = String(entry.status || "");
        if (!Number.isFinite(checkedAtMs)) continue;
        if (status !== "active" && status !== "liquidated" && status !== "unknown") continue;

        kartotekaCacheByUnp.set(normalizedUnp, {
          status: status as KartotekaStatus,
          checkedAtMs,
          sourceStatus: String(entry.sourceStatus || ""),
        });
      }

      const byNameEntries = parsed?.byName || {};
      for (const [nameKey, entry] of Object.entries(byNameEntries)) {
        const normalizedKey = String(nameKey || "").trim();
        if (!normalizedKey) continue;
        if (!entry || typeof entry !== "object") continue;

        const checkedAtMs = Number(entry.checkedAtMs);
        const status = String(entry.status || "");
        if (!Number.isFinite(checkedAtMs)) continue;
        if (status !== "active" && status !== "liquidated" && status !== "unknown") continue;

        kartotekaCacheByName.set(normalizedKey, {
          status: status as KartotekaStatus,
          checkedAtMs,
          sourceStatus: String(entry.sourceStatus || ""),
        });
      }
    } catch {
      // No cache yet or invalid cache format: start with empty cache.
    } finally {
      cacheLoaded = true;
      cacheLoadPromise = null;
    }
  })();

  return cacheLoadPromise;
}

function persistCacheSoon(): void {
  const snapshot: KartotekaCacheFile = {
    version: 2,
    byUnp: Object.fromEntries(kartotekaCacheByUnp.entries()),
    byName: Object.fromEntries(kartotekaCacheByName.entries()),
  };

  cacheWriteChain = cacheWriteChain
    .then(async () => {
      try {
        await fs.mkdir(path.dirname(KARTOTEKA_CACHE_PATH), { recursive: true });
        await fs.writeFile(KARTOTEKA_CACHE_PATH, JSON.stringify(snapshot), "utf-8");
      } catch {
        // Best-effort cache persistence.
      }
    })
    .catch(() => {
      // Keep chain alive even if a write failed.
    });
}

async function fetchKartotekaStatusByUnp(unp: string): Promise<{ status: KartotekaStatus; sourceStatus: string }> {
  if (!hasKartotekaToken()) return { status: "unknown", sourceStatus: "" };

  const base = KARTOTEKA_API_BASE_URL.replace(/\/+$/u, "");
  const url = new URL(`${base}/egr/${unp}`);
  url.searchParams.set("access-token", KARTOTEKA_API_TOKEN);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KARTOTEKA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return { status: "unknown", sourceStatus: "" };

    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { status: "unknown", sourceStatus: "" };

    return inferKartotekaStatus(payload);
  } catch {
    return { status: "unknown", sourceStatus: "" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKartotekaSearchShortsByName(nameQuery: string): Promise<KartotekaSearchItem[]> {
  const query = normalizeMatchText(nameQuery);
  if (!query) return [];

  const cached = nameSearchCache.get(query);
  if (cached && Date.now() - cached.checkedAtMs <= KARTOTEKA_NAME_CACHE_TTL_MS) {
    return cached.items;
  }

  const pending = pendingNameSearchByQuery.get(query);
  if (pending) return pending;

  const task = (async () => {
    const base = KARTOTEKA_PUBLIC_SEARCH_BASE_URL.replace(/\/+$/u, "");
    const url = new URL(`${base}/search/shorts`);
    url.searchParams.set("query", nameQuery.trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), KARTOTEKA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!res.ok) return [];

      const payload = await res.json().catch(() => null);
      const items = Array.isArray(payload?.items) ? payload.items : [];

      const normalizedItems = items.filter((item: unknown) => item && typeof item === "object") as KartotekaSearchItem[];
      nameSearchCache.set(query, {
        checkedAtMs: Date.now(),
        items: normalizedItems,
      });
      return normalizedItems;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
      pendingNameSearchByQuery.delete(query);
    }
  })();

  pendingNameSearchByQuery.set(query, task);
  return task;
}

async function resolveKartotekaLiquidatedByUnp(unp: string): Promise<boolean> {
  await ensureCacheLoaded();

  const cached = kartotekaCacheByUnp.get(unp);
  if (cached && Date.now() - cached.checkedAtMs <= KARTOTEKA_CACHE_TTL_MS) {
    return cached.status === "liquidated";
  }

  const fetched = await fetchKartotekaStatusByUnp(unp);
  kartotekaCacheByUnp.set(unp, {
    status: fetched.status,
    checkedAtMs: Date.now(),
    sourceStatus: fetched.sourceStatus,
  });
  persistCacheSoon();

  return fetched.status === "liquidated";
}

async function resolveKartotekaLiquidatedByName(candidate: {
  name: string;
  city: string;
  address: string;
}): Promise<boolean> {
  await ensureCacheLoaded();

  const lookupKey = buildNameLookupKey(candidate.name, candidate.city, candidate.address);
  if (!lookupKey) return false;

  const cached = kartotekaCacheByName.get(lookupKey);
  if (cached && Date.now() - cached.checkedAtMs <= KARTOTEKA_NAME_CACHE_TTL_MS) {
    return cached.status === "liquidated";
  }

  const items = await fetchKartotekaSearchShortsByName(candidate.name);
  const matched = matchKartotekaItemsByName({
    ...candidate,
    items,
  });

  kartotekaCacheByName.set(lookupKey, {
    status: matched.status,
    checkedAtMs: Date.now(),
    sourceStatus: matched.sourceStatus,
  });
  persistCacheSoon();

  return matched.status === "liquidated";
}

export async function isLiquidatedByKartotekaUnp(rawUnp: string): Promise<boolean> {
  const unp = normalizeBiznesinfoUnp(rawUnp);
  if (!isValidUnp(unp)) return false;
  if (isExcludedBiznesinfoCompany({ unp })) return true;
  if (!hasKartotekaToken()) return false;

  const pending = pendingByUnp.get(unp);
  if (pending) {
    const resolved = await pending;
    if (resolved) {
      await rememberLiquidatedBiznesinfoCompany({ unp }, "kartoteka_egr");
    }
    return resolved;
  }

  const task = resolveKartotekaLiquidatedByUnp(unp).finally(() => {
    pendingByUnp.delete(unp);
  });
  pendingByUnp.set(unp, task);
  const resolved = await task;
  if (resolved) {
    await rememberLiquidatedBiznesinfoCompany({ unp }, "kartoteka_egr");
  }
  return resolved;
}

export async function isLiquidatedByKartoteka(candidate: KartotekaLookupCandidate | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  if (
    isExcludedBiznesinfoCompany({
      source_id: candidate.source_id || candidate.id || "",
      unp: candidate.unp || "",
    })
  ) {
    return true;
  }

  const unp = normalizeBiznesinfoUnp(candidate.unp || "");
  if (isValidUnp(unp)) {
    if (!hasKartotekaToken()) return false;
    const isLiquidated = await isLiquidatedByKartotekaUnp(unp);
    if (isLiquidated) {
      await rememberLiquidatedBiznesinfoCompany(
        {
          source_id: candidate.source_id || candidate.id || "",
          unp,
          name: candidate.name || "",
          city: candidate.city || "",
          address: candidate.address || "",
        },
        "kartoteka_egr",
      );
    }
    return isLiquidated;
  }

  const rawName = String(candidate.name || "").trim();
  if (!rawName) return false;

  const rawCity = String(candidate.city || "").trim();
  const rawAddress = String(candidate.address || "").trim();
  const lookupKey = buildNameLookupKey(rawName, rawCity, rawAddress);
  if (!lookupKey) return false;

  const pending = pendingByNameKey.get(lookupKey);
  if (pending) {
    const resolved = await pending;
    if (resolved) {
      await rememberLiquidatedBiznesinfoCompany(
        {
          source_id: candidate.source_id || candidate.id || "",
          unp: candidate.unp || "",
          name: rawName,
          city: rawCity,
          address: rawAddress,
        },
        "kartoteka_name",
      );
    }
    return resolved;
  }

  const task = resolveKartotekaLiquidatedByName({
    name: rawName,
    city: rawCity,
    address: rawAddress,
  }).finally(() => {
    pendingByNameKey.delete(lookupKey);
  });

  pendingByNameKey.set(lookupKey, task);
  const resolved = await task;
  if (resolved) {
    await rememberLiquidatedBiznesinfoCompany(
      {
        source_id: candidate.source_id || candidate.id || "",
        unp: candidate.unp || "",
        name: rawName,
        city: rawCity,
        address: rawAddress,
      },
      "kartoteka_name",
    );
  }
  return resolved;
}

export async function filterOutLiquidatedByKartoteka<
  T extends {
    source_id?: string | null;
    id?: string | null;
    unp?: string | null;
    name?: string | null;
    city?: string | null;
    address?: string | null;
  },
>(items: T[]): Promise<{
  items: T[];
  removed: number;
}> {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return { items: [], removed: 0 };

  const out: T[] = [];
  let removed = 0;

  for (const item of source) {
    const isLiquidated = await isLiquidatedByKartoteka({
      source_id: item?.source_id || "",
      id: item?.id || "",
      unp: item?.unp || "",
      name: item?.name || "",
      city: item?.city || "",
      address: item?.address || "",
    });
    if (isLiquidated) {
      removed += 1;
      continue;
    }
    out.push(item);
  }

  return { items: out, removed };
}
