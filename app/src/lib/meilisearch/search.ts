import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getCompaniesIndex, isMeiliHealthy } from "./client";
import type { MeiliSearchParams, MeiliCompanyDocument } from "./types";
import type { IbizCompanySummary, IbizSearchResponse, IbizSuggestResponse } from "../ibiz/types";
import { IBIZ_CATEGORY_ICONS } from "../ibiz/icons";
import { isAddressLikeLocationQuery, normalizeCityForFilter } from "../utils/location";

const LOGO_CACHE_DIR = process.env.IBIZ_LOGO_CACHE_DIR?.trim() || path.join(os.tmpdir(), "ibiz-logo-cache");
const LOGO_SNIFF_BYTES = 4096;
const LOGO_FETCH_TIMEOUT_MS = 5000;

const logoToneCache = new Map<string, "color" | "bw">();

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

function shouldApplyCheeseFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.includes("сыр") || tokens.includes("сыры") || tokens.includes("сыра");
}

function shouldApplyMilkFilter(raw: string): boolean {
  const tokens = tokenizeServiceQuery(raw);
  return tokens.some((t) => t.startsWith("молок") || t.startsWith("молоч"));
}

function hasCheeseKeyword(keywords: string[]): boolean {
  for (const raw of keywords || []) {
    const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!t) continue;
    if (t.startsWith("сыр") && !t.startsWith("сырь")) return true;
  }
  return false;
}

function hasMilkKeyword(keywords: string[]): boolean {
  for (const raw of keywords || []) {
    const t = (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
    if (!t) continue;
    if (t.startsWith("молок") || t.startsWith("молоч")) return true;
  }
  return false;
}

const KEYWORD_FILTER_TOTAL_SCAN_LIMIT = 5000;
const KEYWORD_FILTER_TOTAL_SCAN_BATCH = 200;

async function countKeywordFilteredTotal(params: {
  index: ReturnType<typeof getCompaniesIndex>;
  searchQuery: string;
  filter: string[];
  attributesToSearchOn?: string[];
  matchingStrategy?: "all" | "last" | "frequency";
  predicate: (keywords: string[]) => boolean;
}): Promise<number> {
  let offset = 0;
  let counted = 0;
  const safeFilter = params.filter.length > 0 ? params.filter : undefined;

  while (true) {
    const result = await params.index.search(params.searchQuery, {
      offset,
      limit: KEYWORD_FILTER_TOTAL_SCAN_BATCH,
      filter: safeFilter,
      attributesToSearchOn: params.attributesToSearchOn,
      matchingStrategy: params.matchingStrategy,
      attributesToRetrieve: ["keywords"],
    });

    if (!result.hits.length) break;

    for (const hit of result.hits) {
      const keywords = (hit as Partial<MeiliCompanyDocument>).keywords || [];
      if (params.predicate(keywords)) counted++;
    }

    offset += result.hits.length;
    const estimatedTotal = result.estimatedTotalHits || 0;
    if (estimatedTotal && offset >= estimatedTotal) break;
  }

  return counted;
}

function normalizeLogoTargetUrl(raw: string): URL | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = (u.hostname || "").toLowerCase();
  if (host !== "ibiz.by" && !host.endsWith(".ibiz.by")) return null;
  if (!u.pathname.startsWith("/images/")) return null;
  u.username = "";
  u.password = "";
  u.protocol = "https:";
  return u;
}

function logoCacheKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function logoCacheFilePath(key: string, pathname: string): string {
  const ext = path.extname(pathname || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 && /^[.a-z0-9]+$/.test(ext) ? ext : "";
  return path.join(LOGO_CACHE_DIR, `${key}${safeExt}`);
}

async function readHeadBytesFromFile(filePath: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function fetchHeadBytes(url: string, maxBytes: number): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        range: `bytes=0-${maxBytes - 1}`,
        "user-agent": "biznesinfo.lucheestiy.com/logo-sniffer",
      },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength <= 0) return null;
    return buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isGrayscalePalette(table: Uint8Array, tolerance: number): boolean {
  for (let i = 0; i + 2 < table.length; i += 3) {
    const r = table[i];
    const g = table[i + 1];
    const b = table[i + 2];
    if (Math.abs(r - g) > tolerance) return false;
    if (Math.abs(r - b) > tolerance) return false;
    if (Math.abs(g - b) > tolerance) return false;
  }
  return true;
}

function readUInt32BE(buf: Uint8Array, offset: number): number | null {
  if (offset + 4 > buf.byteLength) return null;
  // eslint-disable-next-line no-bitwise
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function sniffGifIsBlackAndWhite(buf: Uint8Array): boolean | null {
  if (buf.byteLength < 13) return null;
  const header =
    String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]);
  if (header !== "GIF87a" && header !== "GIF89a") return null;

  const packed = buf[10];
  const hasGlobal = (packed & 0x80) !== 0;
  const tolerance = 10;
  let cursor = 13;

  if (hasGlobal) {
    const sizeCode = packed & 0x07;
    const tableSize = 1 << (sizeCode + 1);
    const tableBytes = 3 * tableSize;
    if (cursor + tableBytes > buf.byteLength) return null;
    return isGrayscalePalette(buf.subarray(cursor, cursor + tableBytes), tolerance);
  }

  // No global palette: try to find the first local color table.
  while (cursor < buf.byteLength) {
    const b = buf[cursor];
    if (b === 0x2C) {
      // Image descriptor
      if (cursor + 10 > buf.byteLength) return null;
      const imgPacked = buf[cursor + 9];
      const hasLocal = (imgPacked & 0x80) !== 0;
      if (!hasLocal) return null;
      const sizeCode = imgPacked & 0x07;
      const tableSize = 1 << (sizeCode + 1);
      const tableBytes = 3 * tableSize;
      const tableStart = cursor + 10;
      if (tableStart + tableBytes > buf.byteLength) return null;
      return isGrayscalePalette(buf.subarray(tableStart, tableStart + tableBytes), tolerance);
    }
    if (b === 0x21) {
      // Extension: skip blocks
      cursor += 2;
      while (cursor < buf.byteLength) {
        const size = buf[cursor];
        cursor += 1;
        if (size === 0) break;
        cursor += size;
      }
      continue;
    }
    if (b === 0x3B) return null; // Trailer
    cursor += 1;
  }

  return null;
}

function sniffPngIsBlackAndWhite(buf: Uint8Array): boolean | null {
  if (buf.byteLength < 33) return null;
  // PNG signature
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4E ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0D ||
    buf[5] !== 0x0A ||
    buf[6] !== 0x1A ||
    buf[7] !== 0x0A
  ) {
    return null;
  }

  const tolerance = 10;
  let cursor = 8;
  let colorType: number | null = null;

  while (cursor + 8 <= buf.byteLength) {
    const length = readUInt32BE(buf, cursor);
    if (length === null) return null;
    cursor += 4;
    const type = String.fromCharCode(buf[cursor], buf[cursor + 1], buf[cursor + 2], buf[cursor + 3]);
    cursor += 4;

    const dataStart = cursor;
    const dataEnd = cursor + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buf.byteLength) return null;

    if (type === "IHDR" && length >= 13) {
      // IHDR: width(4) height(4) bitDepth(1) colorType(1) ...
      colorType = buf[dataStart + 9];
      if (colorType === 0 || colorType === 4) return true; // grayscale
      if (colorType === 2 || colorType === 6) return false; // RGB/RGBA
    }

    if (type === "PLTE") {
      const table = buf.subarray(dataStart, dataEnd);
      // Only meaningful for indexed-color images (colorType 3), but safe to evaluate anyway.
      if (colorType === 3) return isGrayscalePalette(table, tolerance);
    }

    if (type === "IDAT" || type === "IEND") break;
    cursor = crcEnd;
  }

  return null;
}

async function isBlackAndWhiteLogo(logoUrl: string): Promise<boolean> {
  const target = normalizeLogoTargetUrl(logoUrl);
  if (!target) return false;

  const normalized = target.toString();
  const key = logoCacheKey(normalized);
  const cached = logoToneCache.get(key);
  if (cached) return cached === "bw";

  const filePath = logoCacheFilePath(key, target.pathname);
  const head =
    (await readHeadBytesFromFile(filePath, LOGO_SNIFF_BYTES)) ||
    (await fetchHeadBytes(normalized, LOGO_SNIFF_BYTES));

  const bw = head ? sniffGifIsBlackAndWhite(head) ?? sniffPngIsBlackAndWhite(head) : null;
  const tone: "color" | "bw" = bw === true ? "bw" : "color";
  logoToneCache.set(key, tone);
  return tone === "bw";
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

function normalizeWebsites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const byHost = new Map<string, { url: string; isRoot: boolean; length: number }>();
  const fallback: string[] = [];
  const fallbackSeen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    const normalized = (() => {
      try {
        // eslint-disable-next-line no-new
        new URL(trimmed);
        return trimmed;
      } catch {
        return `https://${trimmed.replace(/^\/+/, "")}`;
      }
    })();

    let url: URL | null = null;
    try {
      url = new URL(normalized);
    } catch {
      url = null;
    }

    if (!url) {
      const key = trimmed.toLowerCase();
      if (fallbackSeen.has(key)) continue;
      fallbackSeen.add(key);
      fallback.push(trimmed);
      continue;
    }

    const hostKey = (url.hostname || "").toLowerCase().replace(/^www\./i, "");
    if (!hostKey) continue;

    const isRoot = (url.pathname || "") === "/" || (url.pathname || "") === "";
    const candidate = { url: normalized, isRoot, length: normalized.length };
    const existing = byHost.get(hostKey);
    if (!existing) {
      byHost.set(hostKey, candidate);
      continue;
    }

    if (candidate.isRoot && !existing.isRoot) {
      byHost.set(hostKey, candidate);
      continue;
    }

    if (candidate.isRoot === existing.isRoot && candidate.length < existing.length) {
      byHost.set(hostKey, candidate);
    }
  }

  return [...Array.from(byHost.values()).map((v) => v.url), ...fallback];
}

function documentToSummary(doc: MeiliCompanyDocument): IbizCompanySummary {
  return {
    id: doc.id,
    source: doc.source,
    name: doc.name,
    address: doc.address,
    city: doc.city,
    region: doc.region,
    work_hours: {
      status: doc.work_hours_status || undefined,
      work_time: doc.work_hours_time || undefined,
    },
    phones_ext: doc.phones_ext || [],
    phones: doc.phones,
    emails: doc.emails,
    websites: normalizeWebsites(doc.websites),
    description: doc.description,
    about: doc.about || "",
    logo_url: doc.logo_url,
    primary_category_slug: doc.primary_category_slug,
    primary_category_name: doc.primary_category_name,
    primary_rubric_slug: doc.primary_rubric_slug,
    primary_rubric_name: doc.primary_rubric_name,
  };
}

export async function meiliSearch(params: MeiliSearchParams): Promise<IbizSearchResponse> {
  const index = getCompaniesIndex();
  const offset = Math.max(0, params.offset || 0);
  const limit = Math.max(1, Math.min(200, params.limit || 24));
  const targetEnd = offset + limit;

  const filter: string[] = [];

  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }
  if (params.categorySlug) {
    filter.push(`category_slugs = "${params.categorySlug}"`);
  }
  if (params.rubricSlug) {
    filter.push(`rubric_slugs = "${params.rubricSlug}"`);
  }

  // Determine search query and attributes to search on
  const company = (params.query || "").trim();
  const service = (params.service || "").trim();
  const keywords = (params.keywords || "").trim();
  const city = (params.city || "").trim();
  const cityNorm = normalizeCityForFilter(city);
  const useCityExactFilter = Boolean(cityNorm) && !isAddressLikeLocationQuery(city);
  const keywordQuery = `${service} ${keywords}`.trim();
  const applyCheeseFilter = Boolean(service || keywords) && shouldApplyCheeseFilter(keywordQuery);
  const applyMilkFilter = Boolean(service || keywords) && shouldApplyMilkFilter(keywordQuery);
  const applyKeywordFilter = applyCheeseFilter || applyMilkFilter;
  const matchesKeywordFilter = (hitKeywords: string[]) => {
    if (applyCheeseFilter && !hasCheeseKeyword(hitKeywords)) return false;
    if (applyMilkFilter && !hasMilkKeyword(hitKeywords)) return false;
    return true;
  };

  const terms: string[] = [];
  if (company) terms.push(company);
  if (service) terms.push(service);
  if (!service && keywords) terms.push(keywords);
  if (service && keywords) terms.push(keywords);
  if (city && !useCityExactFilter) terms.push(city);

  if (useCityExactFilter) {
    const safe = cityNorm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    filter.push(`city_norm = "${safe}"`);
  }

  const searchQuery = terms.join(" ").trim();
  const matchingStrategy: "all" | "last" | "frequency" | undefined = searchQuery ? "all" : undefined;

  const attrs = new Set<string>();
  if (company) attrs.add("name");
  if (service || keywords) attrs.add("keywords");
  if (city && !useCityExactFilter) {
    attrs.add("city");
    attrs.add("address");
  }
  const attributesToSearchOn = attrs.size > 0 ? Array.from(attrs) : undefined;

  const attributesToRetrieve: Array<keyof MeiliCompanyDocument> = [
    "id",
    "source",
    "name",
    "description",
    "about",
    "address",
    "city",
    "region",
    "phones",
    "phones_ext",
    "emails",
    "websites",
    "logo_url",
    "primary_category_slug",
    "primary_category_name",
    "primary_rubric_slug",
    "primary_rubric_name",
    "work_hours_status",
    "work_hours_time",
    "keywords",
  ];

  // Ensure companies with an actual logo appear before companies that would render initials.
  // (Avoids extra network calls by not trying to classify logo tone.)
  const withLogo: MeiliCompanyDocument[] = [];
  const withoutLogo: MeiliCompanyDocument[] = [];

  const batchSize = Math.min(200, Math.max(50, limit * 10));
  let fetched = 0;
  let estimatedTotal = 0;

  while (true) {
    const result = await index.search(searchQuery, {
      offset: fetched,
      limit: batchSize,
      filter: filter.length > 0 ? filter : undefined,
      attributesToSearchOn,
      matchingStrategy,
      attributesToRetrieve,
    });

    if (fetched === 0) estimatedTotal = result.estimatedTotalHits || 0;
    if (!result.hits.length) break;

    for (const hit of result.hits) {
      if (applyKeywordFilter && !matchesKeywordFilter(hit.keywords || [])) continue;
      const logo = (hit.logo_url || "").trim();
      if (logo) withLogo.push(hit);
      else withoutLogo.push(hit);
      if (withLogo.length >= targetEnd) break;
    }

    fetched += result.hits.length;

    if (withLogo.length >= targetEnd) break;

    // Otherwise, keep fetching until we exhaust the result set.
    if (estimatedTotal && fetched >= estimatedTotal) break;
  }

  const ordered =
    withLogo.length >= targetEnd ? withLogo : [...withLogo, ...withoutLogo];
  const page = ordered.slice(offset, targetEnd);

  let total = estimatedTotal;
  if (applyKeywordFilter) {
    if (estimatedTotal && fetched >= estimatedTotal) {
      total = ordered.length;
    } else if (estimatedTotal && estimatedTotal <= KEYWORD_FILTER_TOTAL_SCAN_LIMIT) {
      total = await countKeywordFilteredTotal({
        index,
        searchQuery,
        filter,
        attributesToSearchOn,
        matchingStrategy,
        predicate: matchesKeywordFilter,
      });
    }
  }

  return {
    query: params.query,
    total,
    companies: page.map(documentToSummary),
  };
}

export async function meiliSuggest(params: {
  query: string;
  region?: string | null;
  limit?: number;
}): Promise<IbizSuggestResponse> {
  const index = getCompaniesIndex();

  const filter: string[] = [];
  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }

  const result = await index.search(params.query, {
    limit: params.limit || 8,
    filter: filter.length > 0 ? filter : undefined,
    attributesToSearchOn: ["name"],
    matchingStrategy: "all",
    attributesToRetrieve: [
      "id", "name", "address", "city",
      "primary_category_slug", "primary_category_name",
    ],
  });

  const suggestions: IbizSuggestResponse["suggestions"] = result.hits.map(hit => ({
    type: "company" as const,
    id: hit.id,
    name: hit.name,
    url: `/company/${hit.id}`,
    icon: hit.primary_category_slug ? IBIZ_CATEGORY_ICONS[hit.primary_category_slug] || null : null,
    subtitle: hit.address || hit.city || "",
  }));

  return {
    query: params.query,
    suggestions,
  };
}

export { isMeiliHealthy };
