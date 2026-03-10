#!/usr/bin/env npx tsx

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ensureBiznesinfoPgSchema, biznesinfoGetSearchItemsByIds } from "../src/lib/biznesinfo/postgres";
import { getDbPool } from "../src/lib/auth/db";

type CheckStatus = "ok" | "warn" | "fail";
type CheckResult = {
  name: string;
  status: CheckStatus;
  details: string;
};

const DB_TARGET_MS = Number.parseInt(process.env.BIZNESINFO_DB_TARGET_MS || "50", 10);
const MEILI_TARGET_MS = Number.parseInt(process.env.BIZNESINFO_MEILI_TARGET_MS || "100", 10);
const PERF_RUNS = 5;
const MEILI_HOST = String(process.env.MEILI_HOST || "http://localhost:7700").trim();
const MEILI_MASTER_KEY = String(process.env.MEILI_MASTER_KEY || "").trim();
const COMPANIES_INDEX = "companies";
const execFileAsync = promisify(execFile);

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

async function collectCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await collectCodeFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(entry.name)) continue;
    out.push(fullPath);
  }
  return out;
}

async function findRuntimeJsonlUsages(runtimeDir: string): Promise<string[]> {
  const files = await collectCodeFiles(runtimeDir);
  const offenders: string[] = [];
  for (const filePath of files) {
    const body = await fs.readFile(filePath, "utf-8");
    if (body.includes("companies.jsonl") || body.includes("BIZNESINFO_COMPANIES_JSONL_PATH")) {
      offenders.push(path.relative(process.cwd(), filePath));
    }
  }
  return offenders;
}

async function meiliRequest<T>(pathName: string, init?: RequestInit): Promise<T> {
  const url = `${MEILI_HOST}${pathName}`;
  const headers = new Headers(init?.headers || {});
  if (MEILI_MASTER_KEY) {
    headers.set("Authorization", `Bearer ${MEILI_MASTER_KEY}`);
    headers.set("X-Meili-API-Key", MEILI_MASTER_KEY);
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meili request failed ${response.status} ${response.statusText}: ${body.slice(0, 400)}`);
  }

  if (response.status === 204) {
    return {} as T;
  }
  return await response.json() as T;
}

async function runPrismaMigrateDeploy(): Promise<{ ok: boolean; details: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npm",
      ["run", "prisma:migrate:deploy"],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const combined = `${stdout}\n${stderr}`.replace(/\s+/gu, " ").trim();
    const trimmed = combined.slice(0, 240);
    return { ok: true, details: trimmed || "prisma migrate deploy выполнен" };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    const combined = `${e.stdout || ""}\n${e.stderr || ""}\n${e.message || ""}`
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 240);
    return { ok: false, details: combined || "prisma migrate deploy завершился ошибкой" };
  }
}

async function main() {
  const checks: CheckResult[] = [];

  if (!String(process.env.DATABASE_URL || "").trim()) {
    checks.push({
      name: "DATABASE_URL",
      status: "fail",
      details: "DATABASE_URL не задан",
    });
    printReportAndExit(checks);
    return;
  }

  const prismaMigrate = await runPrismaMigrateDeploy();
  checks.push({
    name: "Prisma migration",
    status: prismaMigrate.ok ? "ok" : "fail",
    details: prismaMigrate.details,
  });
  if (!prismaMigrate.ok) {
    printReportAndExit(checks);
    return;
  }

  await ensureBiznesinfoPgSchema();
  checks.push({
    name: "DB migration",
    status: "ok",
    details: "PostgreSQL схема доступна",
  });

  const pool = getDbPool();
  const migrations = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM biznesinfo_catalog_schema_migrations
      WHERE id = ANY($1::text[])
      ORDER BY id ASC
    `,
    [[
      "20260217_01_biznesinfo_catalog_pg_primary",
      "20260217_02_companies_services",
    ]],
  );
  const migrationSet = new Set(migrations.rows.map((row) => row.id));
  const migrationOk =
    migrationSet.has("20260217_01_biznesinfo_catalog_pg_primary") &&
    migrationSet.has("20260217_02_companies_services");
  checks.push({
    name: "Schema migrations applied",
    status: migrationOk ? "ok" : "fail",
    details: migrationOk
      ? "Найдены обе миграции Biznesinfo"
      : `Неполный список миграций: ${Array.from(migrationSet).join(", ") || "пусто"}`,
  });

  const counts = await pool.query<{ companies_total: string; services_total: string }>(
    `
      SELECT
        (SELECT COUNT(*)::text FROM companies) AS companies_total,
        (SELECT COUNT(*)::text FROM services) AS services_total
    `,
  );
  const companiesTotal = Number.parseInt(counts.rows[0]?.companies_total || "0", 10);
  const servicesTotal = Number.parseInt(counts.rows[0]?.services_total || "0", 10);
  checks.push({
    name: "JSONL import data present",
    status: companiesTotal > 0 ? "ok" : "fail",
    details: `companies=${companiesTotal}, services=${servicesTotal}`,
  });

  const sampleRows = await pool.query<{ id: string }>(
    "SELECT id FROM companies ORDER BY id ASC LIMIT 24",
  );
  const sampleIds = sampleRows.rows.map((row) => row.id).filter(Boolean);
  if (sampleIds.length === 0) {
    checks.push({
      name: "Sample IDs for performance tests",
      status: "fail",
      details: "Не удалось получить sample ID из companies",
    });
    printReportAndExit(checks);
    return;
  }

  await biznesinfoGetSearchItemsByIds(sampleIds);
  const dbDurations: number[] = [];
  for (let i = 0; i < PERF_RUNS; i += 1) {
    const startedAt = nowMs();
    await biznesinfoGetSearchItemsByIds(sampleIds);
    dbDurations.push(nowMs() - startedAt);
  }
  const dbMedian = median(dbDurations);
  checks.push({
    name: "DB query latency",
    status: dbMedian <= DB_TARGET_MS ? "ok" : "warn",
    details: `median=${formatMs(dbMedian)} target<${DB_TARGET_MS}ms`,
  });

  let meiliHealthy = false;
  try {
    await meiliRequest<{ status: string }>("/health");
    meiliHealthy = true;
  } catch {
    meiliHealthy = false;
  }

  if (!meiliHealthy) {
    checks.push({
      name: "Meilisearch health",
      status: "fail",
      details: "Meilisearch недоступен",
    });
    printReportAndExit(checks);
    return;
  }
  checks.push({
    name: "Meilisearch health",
    status: "ok",
    details: "Meilisearch доступен",
  });

  type MeiliIndexStats = { numberOfDocuments?: number };
  type MeiliSearchResponse = { hits?: Array<{ id?: string }> };

  const stats = await meiliRequest<MeiliIndexStats>(`/indexes/${COMPANIES_INDEX}/stats`);
  const indexedDocs = Number(stats.numberOfDocuments || 0);
  checks.push({
    name: "Reindex created index",
    status: indexedDocs > 0 ? "ok" : "fail",
    details: `companies index docs=${indexedDocs}`,
  });

  await meiliRequest<MeiliSearchResponse>(`/indexes/${COMPANIES_INDEX}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: "",
      limit: 1,
      attributesToRetrieve: ["id"],
    }),
  });

  const meiliDurations: number[] = [];
  for (let i = 0; i < PERF_RUNS; i += 1) {
    const startedAt = nowMs();
    await meiliRequest<MeiliSearchResponse>(`/indexes/${COMPANIES_INDEX}/search`, {
      method: "POST",
      body: JSON.stringify({
        q: "",
        limit: 24,
        attributesToRetrieve: ["id"],
      }),
    });
    meiliDurations.push(nowMs() - startedAt);
  }
  const meiliMedian = median(meiliDurations);
  checks.push({
    name: "Meili search latency",
    status: meiliMedian <= MEILI_TARGET_MS ? "ok" : "warn",
    details: `median=${formatMs(meiliMedian)} target<${MEILI_TARGET_MS}ms`,
  });

  const meiliSample = await meiliRequest<MeiliSearchResponse>(`/indexes/${COMPANIES_INDEX}/search`, {
    method: "POST",
    body: JSON.stringify({
      q: "",
      limit: 24,
      attributesToRetrieve: ["id"],
    }),
  });
  const meiliIds = (meiliSample.hits || [])
    .map((hit) => String((hit as { id?: string }).id || "").trim())
    .filter(Boolean);
  const hydrated = await biznesinfoGetSearchItemsByIds(meiliIds);
  checks.push({
    name: "Search data hydration from PostgreSQL",
    status: hydrated.length > 0 ? "ok" : "fail",
    details: `meili_ids=${meiliIds.length}, hydrated_from_pg=${hydrated.length}`,
  });

  const runtimeJsonlUsages = await findRuntimeJsonlUsages(path.join(process.cwd(), "src"));
  checks.push({
    name: "No JSONL in runtime code",
    status: runtimeJsonlUsages.length === 0 ? "ok" : "fail",
    details: runtimeJsonlUsages.length === 0
      ? "В app/src нет references на companies.jsonl"
      : `Найдены references: ${runtimeJsonlUsages.join(", ")}`,
  });

  const layoutPath = path.join(process.cwd(), "src", "app", "layout.tsx");
  const layoutSource = await fs.readFile(layoutPath, "utf-8");
  const hasNonBlockingWarmup = /\bvoid\s+biznesinfoWarmStore\(\);/u.test(layoutSource);
  const hasAwaitedWarmup = /\bawait\s+biznesinfoWarmStore\(\);/u.test(layoutSource);
  checks.push({
    name: "Fast startup wiring",
    status: hasNonBlockingWarmup && !hasAwaitedWarmup ? "ok" : "warn",
    details: hasNonBlockingWarmup && !hasAwaitedWarmup
      ? "Warmup запускается в фоне (без await)"
      : "Проверьте layout.tsx: warmup не должен блокировать startup",
  });

  printReportAndExit(checks);
}

function printReportAndExit(checks: CheckResult[]) {
  const hasFail = checks.some((check) => check.status === "fail");
  const hasWarn = checks.some((check) => check.status === "warn");

  console.log("=".repeat(72));
  console.log("Biznesinfo TЗ Part 4 Acceptance Check");
  console.log("=".repeat(72));
  for (const check of checks) {
    const mark = check.status === "ok" ? "OK  " : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name}: ${check.details}`);
  }
  console.log("=".repeat(72));

  if (hasFail) {
    console.log("RESULT: FAIL");
    process.exit(1);
  }
  if (hasWarn) {
    console.log("RESULT: PASS_WITH_WARNINGS");
    process.exit(0);
  }
  console.log("RESULT: PASS");
  process.exit(0);
}

main().catch((error) => {
  console.error("Acceptance check failed:", error);
  process.exit(1);
});
