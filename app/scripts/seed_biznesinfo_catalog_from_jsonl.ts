#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import type { BiznesinfoCompany } from "../src/lib/biznesinfo/types";
import { ensureBiznesinfoPgSchema, replaceBiznesinfoCatalog } from "../src/lib/biznesinfo/postgres";

type SeedStats = {
  totalLines: number;
  parsedCompanies: number;
  invalidLines: number;
};

async function loadCompaniesFromJsonl(jsonlPath: string): Promise<{ companies: BiznesinfoCompany[]; stats: SeedStats }> {
  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  const companies: BiznesinfoCompany[] = [];
  let totalLines = 0;
  let invalidLines = 0;

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
      companies.push(parsed);
    } catch {
      invalidLines += 1;
    }
  }

  return {
    companies,
    stats: {
      totalLines,
      parsedCompanies: companies.length,
      invalidLines,
    },
  };
}

async function main() {
  const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
    || path.join(process.cwd(), "public", "data", "biznesinfo", "companies.jsonl");

  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL not found: ${jsonlPath}`);
  }

  console.log("=".repeat(60));
  console.log("Biznesinfo catalog seed (JSONL -> PostgreSQL catalog tables)");
  console.log("=".repeat(60));
  console.log(`Source: ${jsonlPath}`);

  await ensureBiznesinfoPgSchema();

  console.log("Loading JSONL into memory...");
  const { companies, stats } = await loadCompaniesFromJsonl(jsonlPath);
  console.log(`Read lines: ${stats.totalLines}`);
  console.log(`Parsed companies: ${stats.parsedCompanies}`);
  console.log(`Invalid/empty skipped: ${stats.invalidLines}`);

  console.log("Replacing catalog tables...");
  const result = await replaceBiznesinfoCatalog(companies);

  console.log("=".repeat(60));
  console.log(`Input total: ${result.total}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log("Done.");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Catalog seed failed:", error);
  process.exit(1);
});

