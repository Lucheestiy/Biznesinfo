#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import type { BiznesinfoCompany } from "../src/lib/biznesinfo/types";
import {
  backfillEmptyCompanyRegions,
  ensureBiznesinfoPgSchema,
  upsertCompaniesAndServicesBatch,
} from "../src/lib/biznesinfo/postgres";

const DEFAULT_BATCH_SIZE = 300;
const MIN_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

function resolveBatchSizeFromEnv(): number {
  const raw = String(process.env.BIZNESINFO_IMPORT_BATCH_SIZE || "").trim();
  if (!raw) return DEFAULT_BATCH_SIZE;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_BATCH_SIZE || parsed > MAX_BATCH_SIZE) {
    throw new Error(`BIZNESINFO_IMPORT_BATCH_SIZE must be in range ${MIN_BATCH_SIZE}-${MAX_BATCH_SIZE}. Received: ${raw}`);
  }

  return parsed;
}

async function main() {
  const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
    || path.join(process.cwd(), "public", "data", "biznesinfo", "companies.jsonl");
  const batchSize = resolveBatchSizeFromEnv();

  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL not found: ${jsonlPath}`);
  }

  console.log("=".repeat(60));
  console.log("Biznesinfo JSONL -> PostgreSQL import");
  console.log("=".repeat(60));
  console.log(`Source: ${jsonlPath}`);
  console.log(`Batch size: ${batchSize}`);

  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  let totalLines = 0;
  let invalidLines = 0;
  let parsedCompanies = 0;
  let upsertedCompanies = 0;
  let skippedCompanies = 0;
  let insertedServices = 0;
  let batchesProcessed = 0;

  let batch: BiznesinfoCompany[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;

    const result = await upsertCompaniesAndServicesBatch(batch);
    batchesProcessed += 1;
    parsedCompanies += result.total;
    upsertedCompanies += result.upsertedCompanies;
    skippedCompanies += result.skippedCompanies;
    insertedServices += result.insertedServices;

    console.log(
      `[batch ${batchesProcessed}] input=${result.total} upserted=${result.upsertedCompanies} skipped=${result.skippedCompanies} services=${result.insertedServices}`,
    );

    batch = [];
  };

  await ensureBiznesinfoPgSchema();

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    totalLines += 1;
    try {
      const parsed = JSON.parse(raw) as BiznesinfoCompany;
      if (!parsed?.source_id) {
        invalidLines += 1;
        continue;
      }
      batch.push(parsed);
      if (batch.length >= batchSize) {
        await flushBatch();
      }
    } catch {
      invalidLines += 1;
    }
  }

  await flushBatch();

  const backfill = await backfillEmptyCompanyRegions();

  console.log(`Read lines: ${totalLines}`);
  console.log(`Parsed companies: ${parsedCompanies}`);
  console.log(`Invalid/empty skipped: ${invalidLines}`);

  console.log("=".repeat(60));
  console.log(`Batches processed: ${batchesProcessed}`);
  console.log(`Companies upserted: ${upsertedCompanies}`);
  console.log(`Companies skipped: ${skippedCompanies}`);
  console.log(`Services inserted: ${insertedServices}`);
  console.log(`Input total: ${parsedCompanies}`);
  console.log(
    `[region backfill] scanned=${backfill.scanned} updated=${backfill.updated} remaining_empty=${backfill.remainingEmpty} unresolved=${backfill.unresolved}`,
  );
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
