import fs from "node:fs";
import path from "node:path";

import { normalizeKeywordPhrase } from "./keywords";

export type KeywordVolumeMap = Map<string, number>;

export interface KeywordStatsLoadOptions {
  cwd?: string;
  skipMissing?: boolean;
  onWarning?: (_message: string) => void;
}

const QUERY_HEADER_KEYS = new Set([
  "phrase",
  "query",
  "keyword",
  "key",
  "search_query",
  "search_phrase",
  "запрос",
  "поисковый_запрос",
  "поисковая_фраза",
  "фраза",
  "ключевая_фраза",
]);

const WORDSTAT_VOLUME_KEYS = new Set([
  "volume",
  "freq",
  "frequency",
  "wordstat_volume",
  "ws_volume",
  "частотность",
  "частота",
  "частотность_wordstat",
]);

const WORDSTAT_MONTHLY_KEYS = new Set([
  "volumes_by_month",
  "month_volumes",
  "monthly_volumes",
  "частотность_по_месяцам",
  "по_месяцам",
  "помесячно",
]);

const IMPRESSION_KEYS = new Set([
  "impressions",
  "impression",
  "shows",
  "show",
  "показы",
  "показ",
]);

const CLICK_KEYS = new Set([
  "clicks",
  "click",
  "клики",
  "клик",
]);

const SESSION_KEYS = new Set([
  "sessions",
  "session",
  "visits",
  "visit",
  "users",
  "user",
  "сеансы",
  "сеанс",
  "визиты",
  "визит",
  "пользователи",
  "пользователь",
]);

function normalizeHeader(raw: string): string {
  return normalizeKeywordPhrase(raw)
    .replace(/\s+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((cell) => cell.trim());
}

function detectDelimiter(headerLine: string): string {
  const delimiters = [",", ";", "\t", "|"];

  let best = ",";
  let bestScore = 0;

  for (const delimiter of delimiters) {
    const columns = splitCsvRow(headerLine, delimiter).length;
    if (columns > bestScore) {
      bestScore = columns;
      best = delimiter;
    }
  }

  return best;
}

function parseNumber(raw: string): number {
  const value = (raw || "")
    .replace(/[\u00a0\u202f\s]+/gu, "")
    .replace(/%/gu, "")
    .trim();
  if (!value) return 0;

  let normalized = value;

  if (/^-?\d+[.,]\d+$/u.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/[.,](?=\d{3}(?:\D|$))/gu, "");
    normalized = normalized.replace(",", ".");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function parseMonthlyNumbers(raw: string): number {
  const value = raw || "";
  if (!value.trim()) return 0;

  const matches = value.match(/\d+(?:[.,]\d+)?/gu) || [];
  let total = 0;
  for (const m of matches) {
    total += parseNumber(m);
  }
  return total;
}

function findHeaderIndexes(headers: string[], keys: Set<string>): number[] {
  const out: number[] = [];
  headers.forEach((header, index) => {
    if (keys.has(header)) out.push(index);
  });
  return out;
}

function parseCsvVolumeMap(rawCsv: string): KeywordVolumeMap {
  const out: KeywordVolumeMap = new Map();

  const lines = (rawCsv || "")
    .replace(/^\uFEFF/gu, "")
    .split(/\r?\n/gu)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return out;

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const headers = splitCsvRow(headerLine, delimiter).map((header) => normalizeHeader(header));

  const queryIndex = headers.findIndex((header) => QUERY_HEADER_KEYS.has(header));
  if (queryIndex < 0) return out;

  const volumeIndexes = findHeaderIndexes(headers, WORDSTAT_VOLUME_KEYS);
  const monthlyIndexes = findHeaderIndexes(headers, WORDSTAT_MONTHLY_KEYS);
  const impressionIndexes = findHeaderIndexes(headers, IMPRESSION_KEYS);
  const clickIndexes = findHeaderIndexes(headers, CLICK_KEYS);
  const sessionIndexes = findHeaderIndexes(headers, SESSION_KEYS);

  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvRow(lines[i], delimiter);
    if (row.length === 0) continue;

    const queryRaw = row[queryIndex] || "";
    const key = normalizeKeywordPhrase(queryRaw);
    if (!key) continue;

    let weight = 0;
    let hasWordstatVolume = false;

    for (const index of volumeIndexes) {
      const value = parseNumber(row[index] || "");
      if (value > 0) {
        weight += value;
        hasWordstatVolume = true;
      }
    }

    if (!hasWordstatVolume) {
      for (const index of monthlyIndexes) {
        weight += parseMonthlyNumbers(row[index] || "");
      }
    }

    for (const index of impressionIndexes) {
      weight += parseNumber(row[index] || "");
    }

    for (const index of clickIndexes) {
      weight += parseNumber(row[index] || "");
    }

    for (const index of sessionIndexes) {
      weight += parseNumber(row[index] || "");
    }

    if (weight <= 0) continue;

    out.set(key, (out.get(key) || 0) + weight);
  }

  return out;
}

function parseJsonVolumeMap(rawJson: string): KeywordVolumeMap {
  const out: KeywordVolumeMap = new Map();
  const parsed = JSON.parse(rawJson || "{}");

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const phrase = normalizeKeywordPhrase(
        String((entry as Record<string, unknown>).phrase || (entry as Record<string, unknown>).query || ""),
      );
      if (!phrase) continue;

      const weight = parseNumber(String((entry as Record<string, unknown>).volume || (entry as Record<string, unknown>).weight || 0));
      if (weight <= 0) continue;

      out.set(phrase, (out.get(phrase) || 0) + weight);
    }

    return out;
  }

  if (!parsed || typeof parsed !== "object") return out;

  for (const [keyRaw, valueRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeKeywordPhrase(keyRaw);
    if (!key) continue;

    const weight = parseNumber(String(valueRaw ?? ""));
    if (weight <= 0) continue;

    out.set(key, (out.get(key) || 0) + weight);
  }

  return out;
}

function resolveStatsPath(filePath: string, cwd: string): string | null {
  const trimmed = (filePath || "").trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    path.resolve(cwd, trimmed),
    path.resolve(process.cwd(), trimmed),
    path.resolve(process.cwd(), "app", trimmed),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore
    }
  }

  return null;
}

function mergeVolumeMaps(target: KeywordVolumeMap, source: ReadonlyMap<string, number>): void {
  for (const [key, value] of source.entries()) {
    if (!key) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    target.set(key, (target.get(key) || 0) + value);
  }
}

export function parseStatsPaths(raw: string | null | undefined): string[] {
  return (raw || "")
    .split(/[\n,;]+/gu)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function loadKeywordVolumeMapFromFiles(filePaths: string[], opts?: KeywordStatsLoadOptions): KeywordVolumeMap {
  const cwd = opts?.cwd || process.cwd();
  const skipMissing = opts?.skipMissing ?? false;
  const onWarning = opts?.onWarning;

  const out: KeywordVolumeMap = new Map();

  for (const filePath of filePaths || []) {
    const resolved = resolveStatsPath(filePath, cwd);

    if (!resolved) {
      const msg = `Keyword stats file not found: ${filePath}`;
      if (skipMissing) {
        onWarning?.(msg);
        continue;
      }
      throw new Error(msg);
    }

    const raw = fs.readFileSync(resolved, "utf-8");
    const ext = path.extname(resolved).toLowerCase();

    const map = ext === ".json" ? parseJsonVolumeMap(raw) : parseCsvVolumeMap(raw);
    mergeVolumeMaps(out, map);
  }

  return out;
}

export function createVolumeLookup(volumeMap: ReadonlyMap<string, number>): (_phrase: string) => number {
  return (phrase: string) => {
    const key = normalizeKeywordPhrase(phrase || "");
    if (!key) return 0;
    const value = volumeMap.get(key);
    return Number.isFinite(value) && (value || 0) > 0 ? Number(value) : 0;
  };
}
