#!/usr/bin/env npx tsx

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SearchResultItem = {
  id?: string;
  name?: string;
};

type SearchResponse = {
  items?: SearchResultItem[];
  companies?: SearchResultItem[];
  total?: number;
  zero_results?: unknown;
};

type GoldenQueryCase = {
  id: string;
  label?: string;
  params: Record<string, string | number | boolean | null | undefined>;
  expect_results?: boolean;
  relevant_threshold?: number;
  forbidden_ids?: string[];
  labels?: Record<string, number>;
};

type GoldenSet = {
  version: number;
  top_k?: number;
  thresholds?: {
    min_precision_at_10?: number;
    min_ndcg_at_10?: number;
    max_irrelevant_share_top10?: number;
    max_zero_result_rate?: number;
  };
  queries: GoldenQueryCase[];
};

type QueryMetrics = {
  id: string;
  label: string;
  expectResults: boolean;
  total: number;
  returnedTopK: number;
  precisionAtK: number;
  ndcgAtK: number;
  irrelevantShare: number;
  zeroResults: boolean;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_GOLDEN_SET_PATH = path.join(APP_DIR, "tests", "fixtures", "search-quality-golden-set.json");
const DEFAULT_BASE_URL = "http://localhost:8116/api/biznesinfo/search";

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getThreshold(
  envName: string,
  goldenValue: number | undefined,
  fallback: number,
): number {
  const fromEnv = parseOptionalNumber(process.env[envName]);
  if (fromEnv != null) return fromEnv;
  if (Number.isFinite(goldenValue)) return Number(goldenValue);
  return fallback;
}

function clampRelevance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 3) return 3;
  return rounded;
}

function dcg(gains: number[]): number {
  return gains.reduce((sum, gain, index) => {
    const discounted = (2 ** gain - 1) / Math.log2(index + 2);
    return sum + discounted;
  }, 0);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function loadGoldenSet(goldenPath: string): Promise<GoldenSet> {
  const raw = await fs.readFile(goldenPath, "utf-8");
  const parsed = JSON.parse(raw) as GoldenSet;
  if (!parsed || !Array.isArray(parsed.queries) || parsed.queries.length === 0) {
    throw new Error(`Invalid golden set: ${goldenPath}`);
  }
  return parsed;
}

function buildRequestUrl(
  baseUrl: string,
  params: Record<string, string | number | boolean | null | undefined>,
  topK: number,
  forcedAbVariant: "control" | "treatment" | null,
): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    url.searchParams.set(key, normalized);
  }
  url.searchParams.set("limit", String(topK));
  if (forcedAbVariant) {
    url.searchParams.set("ab_variant", forcedAbVariant);
    url.searchParams.set("ab_seed", `quality-${forcedAbVariant}`);
  }
  return url.toString();
}

async function fetchSearch(
  baseUrl: string,
  params: Record<string, string | number | boolean | null | undefined>,
  topK: number,
  forcedAbVariant: "control" | "treatment" | null,
): Promise<{ total: number; items: SearchResultItem[]; hasZeroPayload: boolean }> {
  const url = buildRequestUrl(baseUrl, params, topK, forcedAbVariant);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Search request failed (${response.status}): ${url}\n${body.slice(0, 400)}`);
  }

  const json = await response.json() as SearchResponse;
  const items = Array.isArray(json.items)
    ? json.items
    : (Array.isArray(json.companies) ? json.companies : []);
  const total = Number(json.total || 0);
  return {
    total,
    items,
    hasZeroPayload: Boolean(json.zero_results),
  };
}

function computeNdcgAtK(
  retrievedGains: number[],
  judgedGains: number[],
  k: number,
): number {
  const gains = retrievedGains.slice(0, k);
  const idealSize = Math.max(gains.length, Math.min(k, judgedGains.length));
  const idealGains = [...judgedGains]
    .sort((a, b) => b - a)
    .slice(0, idealSize);
  const dcgValue = dcg(gains);
  const idcgValue = dcg(idealGains);
  if (idcgValue <= 0) return 0;
  return dcgValue / idcgValue;
}

async function main() {
  const goldenSetPath = String(process.env.BIZNESINFO_SEARCH_GOLDEN_SET || DEFAULT_GOLDEN_SET_PATH).trim();
  const baseUrl = String(process.env.BIZNESINFO_SEARCH_QUALITY_BASE_URL || DEFAULT_BASE_URL).trim();
  const goldenSet = await loadGoldenSet(goldenSetPath);

  const topK = Math.max(
    1,
    Math.trunc(
      parseOptionalNumber(process.env.BIZNESINFO_SEARCH_TOP_K) ??
        (Number.isFinite(goldenSet.top_k) ? Number(goldenSet.top_k) : 10),
    ),
  );

  const minPrecisionAt10 = getThreshold(
    "BIZNESINFO_SEARCH_MIN_PRECISION_AT_10",
    goldenSet.thresholds?.min_precision_at_10,
    0.8,
  );
  const minNdcgAt10 = getThreshold(
    "BIZNESINFO_SEARCH_MIN_NDCG_AT_10",
    goldenSet.thresholds?.min_ndcg_at_10,
    0.85,
  );
  const maxIrrelevantShareTop10 = getThreshold(
    "BIZNESINFO_SEARCH_MAX_IRRELEVANT_SHARE_TOP10",
    goldenSet.thresholds?.max_irrelevant_share_top10,
    0.2,
  );
  const maxZeroResultRate = getThreshold(
    "BIZNESINFO_SEARCH_MAX_ZERO_RESULT_RATE",
    goldenSet.thresholds?.max_zero_result_rate,
    0.1,
  );
  const forcedAbVariantRaw = String(process.env.BIZNESINFO_SEARCH_AB_VARIANT || "").trim().toLowerCase();
  const forcedAbVariant: "control" | "treatment" | null =
    forcedAbVariantRaw === "control" || forcedAbVariantRaw === "treatment"
      ? forcedAbVariantRaw
      : null;

  const metrics: QueryMetrics[] = [];
  const failures: string[] = [];

  console.log(`[search-quality] golden_set=${goldenSetPath}`);
  console.log(`[search-quality] base_url=${baseUrl}`);
  console.log(`[search-quality] top_k=${topK}`);
  console.log(`[search-quality] ab_variant=${forcedAbVariant || "auto"}`);

  for (const queryCase of goldenSet.queries) {
    const expectResults = queryCase.expect_results !== false;
    const labels = queryCase.labels || {};
    const relevantThreshold = Number.isFinite(queryCase.relevant_threshold)
      ? Number(queryCase.relevant_threshold)
      : 2;
    if (expectResults && Object.keys(labels).length === 0) {
      failures.push(`Query "${queryCase.id}" has no manual labels`);
      continue;
    }

    const response = await fetchSearch(baseUrl, queryCase.params, topK, forcedAbVariant);
    const topItems = response.items.slice(0, topK);
    const topIds = topItems
      .map((item) => String(item.id || "").trim())
      .filter(Boolean);
    const retrievedCount = topItems.length;
    const gains = topItems.map((item) => clampRelevance(labels[String(item.id || "").trim()] || 0));
    const judgedPool = Object.values(labels).map((value) => clampRelevance(value));
    const relevantCount = gains.filter((gain) => gain >= relevantThreshold).length;
    const irrelevantCount = gains.filter((gain) => gain === 0).length;
    const precisionAtK = retrievedCount > 0 ? relevantCount / retrievedCount : 0;
    const ndcgAtK = computeNdcgAtK(gains, judgedPool, topK);
    const irrelevantShare = retrievedCount > 0 ? irrelevantCount / retrievedCount : 1;
    const zeroResults = retrievedCount === 0;

    metrics.push({
      id: queryCase.id,
      label: queryCase.label || queryCase.id,
      expectResults,
      total: response.total,
      returnedTopK: retrievedCount,
      precisionAtK,
      ndcgAtK,
      irrelevantShare,
      zeroResults,
    });

    console.log(
      `[search-quality] ${queryCase.id} (${queryCase.label || queryCase.id}) ` +
        `total=${response.total} top=${retrievedCount} ` +
        `p@${topK}=${precisionAtK.toFixed(3)} ndcg@${topK}=${ndcgAtK.toFixed(3)} ` +
        `irrelevant=${irrelevantShare.toFixed(3)}`,
    );

    if (!expectResults) {
      if (!zeroResults) {
        failures.push(`Expected zero-results for "${queryCase.id}", got ${retrievedCount} results`);
      }
      if (!response.hasZeroPayload) {
        failures.push(`Expected zero_results payload for "${queryCase.id}"`);
      }
    }

    const forbiddenIds = (queryCase.forbidden_ids || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (forbiddenIds.length > 0) {
      const forbiddenHit = forbiddenIds.find((id) => topIds.includes(id));
      if (forbiddenHit) {
        failures.push(`Forbidden id "${forbiddenHit}" appeared in top-${topK} for "${queryCase.id}"`);
      }
    }
  }

  const scored = metrics.filter((item) => item.expectResults);
  if (scored.length === 0) {
    failures.push("No scored queries (expect_results=true) in golden set");
  }

  const precisionAt10 = avg(scored.map((item) => item.precisionAtK));
  const ndcgAt10 = avg(scored.map((item) => item.ndcgAtK));
  const irrelevantShareTop10 = avg(scored.map((item) => item.irrelevantShare));
  const zeroResultRate = avg(scored.map((item) => (item.zeroResults ? 1 : 0)));

  console.log("[search-quality] aggregate");
  console.log(`  Precision@${topK}: ${precisionAt10.toFixed(4)} (${formatRatio(precisionAt10)})`);
  console.log(`  NDCG@${topK}: ${ndcgAt10.toFixed(4)} (${formatRatio(ndcgAt10)})`);
  console.log(`  IrrelevantShare@${topK}: ${irrelevantShareTop10.toFixed(4)} (${formatRatio(irrelevantShareTop10)})`);
  console.log(`  ZeroResultRate: ${zeroResultRate.toFixed(4)} (${formatRatio(zeroResultRate)})`);

  if (precisionAt10 < minPrecisionAt10) {
    failures.push(
      `Precision@${topK} ${precisionAt10.toFixed(4)} < threshold ${minPrecisionAt10.toFixed(4)}`,
    );
  }
  if (ndcgAt10 < minNdcgAt10) {
    failures.push(
      `NDCG@${topK} ${ndcgAt10.toFixed(4)} < threshold ${minNdcgAt10.toFixed(4)}`,
    );
  }
  if (irrelevantShareTop10 > maxIrrelevantShareTop10) {
    failures.push(
      `IrrelevantShare@${topK} ${irrelevantShareTop10.toFixed(4)} > threshold ${maxIrrelevantShareTop10.toFixed(4)}`,
    );
  }
  if (zeroResultRate > maxZeroResultRate) {
    failures.push(
      `ZeroResultRate ${zeroResultRate.toFixed(4)} > threshold ${maxZeroResultRate.toFixed(4)}`,
    );
  }

  if (failures.length > 0) {
    console.error("[search-quality] FAILED");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("[search-quality] PASSED");
}

main().catch((error) => {
  console.error("[search-quality] Unhandled error");
  console.error(error);
  process.exit(1);
});
