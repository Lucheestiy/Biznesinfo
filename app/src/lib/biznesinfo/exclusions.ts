import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BiznesinfoCompany } from "./types";

export const EXCLUDED_BIZNESINFO_COMPANY_IDS: string[] = [
  // Keep empty for liquidation logic.
  // Liquidation filtering should be based on external registry (Kartoteka):
  // by UNP when available and by name fallback when UNP is missing.
];

// Manual fallback list by UNP (if an external registry result should be pinned locally).
export const EXCLUDED_BIZNESINFO_COMPANY_UNPS: string[] = [];

type PersistentLiquidatedBlacklistEntry = {
  source_id?: string;
  unp?: string;
  name?: string;
  city?: string;
  address?: string;
  reason?: string;
  checked_at: string;
};

type PersistentLiquidatedBlacklistFile = {
  version: 1;
  ids: string[];
  unps: string[];
  entries: PersistentLiquidatedBlacklistEntry[];
};

const PERSISTENT_LIQUIDATED_BLACKLIST_PATH =
  process.env.BIZNESINFO_LIQUIDATED_BLACKLIST_PATH?.trim()
  || path.join(os.tmpdir(), "biznesinfo-liquidated-blacklist.json");

function normalizeCompanyId(rawId: string): string {
  return (rawId || "").trim().toLowerCase();
}

export function normalizeBiznesinfoUnp(rawUnp: string): string {
  return (rawUnp || "").replace(/\D+/g, "");
}

const EXCLUDED_COMPANY_IDS = new Set<string>(
  EXCLUDED_BIZNESINFO_COMPANY_IDS.map((id) => normalizeCompanyId(id)).filter(Boolean),
);
const EXCLUDED_COMPANY_UNPS = new Set<string>(
  EXCLUDED_BIZNESINFO_COMPANY_UNPS.map((unp) => normalizeBiznesinfoUnp(unp)).filter(Boolean),
);

const PERSISTENT_EXCLUDED_COMPANY_IDS = new Set<string>();
const PERSISTENT_EXCLUDED_COMPANY_UNPS = new Set<string>();
let persistentEntries: PersistentLiquidatedBlacklistEntry[] = [];
let persistentBlacklistLoaded = false;
let persistentWriteChain: Promise<void> = Promise.resolve();

function ensurePersistentLiquidatedBlacklistLoaded(): void {
  if (persistentBlacklistLoaded) return;

  persistentBlacklistLoaded = true;
  try {
    if (!fs.existsSync(PERSISTENT_LIQUIDATED_BLACKLIST_PATH)) return;
    const raw = fs.readFileSync(PERSISTENT_LIQUIDATED_BLACKLIST_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistentLiquidatedBlacklistFile;
    const ids = Array.isArray(parsed?.ids) ? parsed.ids : [];
    const unps = Array.isArray(parsed?.unps) ? parsed.unps : [];
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

    for (const rawId of ids) {
      const id = normalizeCompanyId(String(rawId || ""));
      if (!id) continue;
      PERSISTENT_EXCLUDED_COMPANY_IDS.add(id);
    }
    for (const rawUnp of unps) {
      const unp = normalizeBiznesinfoUnp(String(rawUnp || ""));
      if (!unp) continue;
      PERSISTENT_EXCLUDED_COMPANY_UNPS.add(unp);
    }

    persistentEntries = entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        source_id: normalizeCompanyId(String(entry.source_id || "")) || undefined,
        unp: normalizeBiznesinfoUnp(String(entry.unp || "")) || undefined,
        name: String(entry.name || "").trim() || undefined,
        city: String(entry.city || "").trim() || undefined,
        address: String(entry.address || "").trim() || undefined,
        reason: String(entry.reason || "").trim() || undefined,
        checked_at: String(entry.checked_at || "").trim() || new Date().toISOString(),
      }));
  } catch {
    // Best-effort loading.
  }
}

function persistPersistentLiquidatedBlacklistSoon(): void {
  const snapshot: PersistentLiquidatedBlacklistFile = {
    version: 1,
    ids: Array.from(PERSISTENT_EXCLUDED_COMPANY_IDS.values()).sort(),
    unps: Array.from(PERSISTENT_EXCLUDED_COMPANY_UNPS.values()).sort(),
    entries: persistentEntries.slice(-10000),
  };

  persistentWriteChain = persistentWriteChain
    .then(async () => {
      try {
        await fsPromises.mkdir(path.dirname(PERSISTENT_LIQUIDATED_BLACKLIST_PATH), { recursive: true });
        await fsPromises.writeFile(PERSISTENT_LIQUIDATED_BLACKLIST_PATH, JSON.stringify(snapshot), "utf-8");
      } catch {
        // Best-effort persistence.
      }
    })
    .catch(() => {
      // Keep chain alive.
    });
}

export function isExcludedBiznesinfoCompanyId(rawId: string): boolean {
  ensurePersistentLiquidatedBlacklistLoaded();
  const id = normalizeCompanyId(rawId);
  if (!id) return false;
  return EXCLUDED_COMPANY_IDS.has(id) || PERSISTENT_EXCLUDED_COMPANY_IDS.has(id);
}

export function isExcludedBiznesinfoCompanyUnp(rawUnp: string): boolean {
  ensurePersistentLiquidatedBlacklistLoaded();
  const unp = normalizeBiznesinfoUnp(rawUnp);
  if (!unp) return false;
  return EXCLUDED_COMPANY_UNPS.has(unp) || PERSISTENT_EXCLUDED_COMPANY_UNPS.has(unp);
}

type ExclusionCandidate = Pick<BiznesinfoCompany, "source_id" | "unp"> | {
  source_id?: string | null;
  unp?: string | null;
};

export function isExcludedBiznesinfoCompany(candidate: ExclusionCandidate | null | undefined): boolean {
  if (!candidate) return false;
  if (isExcludedBiznesinfoCompanyId(candidate.source_id || "")) return true;
  if (isExcludedBiznesinfoCompanyUnp(candidate.unp || "")) return true;
  return false;
}

function escapeMeiliFilterValue(raw: string): string {
  return (raw || "").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildBiznesinfoExclusionFilters(): string[] {
  ensurePersistentLiquidatedBlacklistLoaded();
  const filters: string[] = [];
  const excludedIds = new Set<string>();
  for (const excludedId of EXCLUDED_BIZNESINFO_COMPANY_IDS) {
    const normalized = normalizeCompanyId(excludedId);
    if (!normalized) continue;
    excludedIds.add(normalized);
  }
  for (const excludedId of PERSISTENT_EXCLUDED_COMPANY_IDS) {
    excludedIds.add(excludedId);
  }
  for (const excludedId of excludedIds) {
    const safe = escapeMeiliFilterValue(excludedId);
    if (!safe) continue;
    filters.push(`id != "${safe}"`);
  }
  const excludedUnps = new Set<string>();
  for (const excludedUnp of EXCLUDED_BIZNESINFO_COMPANY_UNPS) {
    const normalized = normalizeBiznesinfoUnp(excludedUnp);
    if (!normalized) continue;
    excludedUnps.add(normalized);
  }
  for (const excludedUnp of PERSISTENT_EXCLUDED_COMPANY_UNPS) {
    excludedUnps.add(excludedUnp);
  }
  for (const excludedUnp of excludedUnps) {
    const safe = escapeMeiliFilterValue(excludedUnp);
    if (!safe) continue;
    filters.push(`unp != "${safe}"`);
  }
  return filters;
}

type PersistentLiquidatedCandidate = {
  source_id?: string | null;
  id?: string | null;
  unp?: string | null;
  name?: string | null;
  city?: string | null;
  address?: string | null;
};

export async function rememberLiquidatedBiznesinfoCompany(
  candidate: PersistentLiquidatedCandidate | null | undefined,
  reason: string = "kartoteka_liquidated",
): Promise<void> {
  if (!candidate) return;
  ensurePersistentLiquidatedBlacklistLoaded();

  const sourceId = normalizeCompanyId(candidate.source_id || candidate.id || "");
  const unp = normalizeBiznesinfoUnp(candidate.unp || "");
  if (!sourceId && !unp) return;

  let changed = false;
  if (sourceId && !PERSISTENT_EXCLUDED_COMPANY_IDS.has(sourceId)) {
    PERSISTENT_EXCLUDED_COMPANY_IDS.add(sourceId);
    changed = true;
  }
  if (unp && !PERSISTENT_EXCLUDED_COMPANY_UNPS.has(unp)) {
    PERSISTENT_EXCLUDED_COMPANY_UNPS.add(unp);
    changed = true;
  }
  if (!changed) return;

  persistentEntries.push({
    source_id: sourceId || undefined,
    unp: unp || undefined,
    name: String(candidate.name || "").trim() || undefined,
    city: String(candidate.city || "").trim() || undefined,
    address: String(candidate.address || "").trim() || undefined,
    reason: String(reason || "").trim() || undefined,
    checked_at: new Date().toISOString(),
  });
  persistPersistentLiquidatedBlacklistSoon();
}
