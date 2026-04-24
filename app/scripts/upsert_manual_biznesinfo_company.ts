#!/usr/bin/env npx tsx

import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureBiznesinfoPgSchema,
  upsertBiznesinfoCatalogBatch,
  upsertCompaniesAndServicesBatch,
} from "../src/lib/biznesinfo/postgres";
import { indexCompany } from "../src/lib/meilisearch/indexer";

import type { BiznesinfoCompany } from "../src/lib/biznesinfo/types";

function toArray(value: unknown): BiznesinfoCompany[] {
  if (Array.isArray(value)) return value as BiznesinfoCompany[];
  if (value && typeof value === "object") return [value as BiznesinfoCompany];
  return [];
}

async function loadCompaniesFromJson(filePath: string): Promise<BiznesinfoCompany[]> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const companies = toArray(parsed);

  if (companies.length === 0) {
    throw new Error(`No companies found in ${resolvedPath}`);
  }

  return companies;
}

async function main() {
  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    throw new Error("Usage: npx tsx scripts/upsert_manual_biznesinfo_company.ts <json-file> [json-file...]");
  }

  const companies: BiznesinfoCompany[] = [];
  for (const filePath of filePaths) {
    companies.push(...(await loadCompaniesFromJson(filePath)));
  }

  await ensureBiznesinfoPgSchema();

  const catalogResult = await upsertBiznesinfoCatalogBatch(companies);
  const searchResult = await upsertCompaniesAndServicesBatch(companies);

  const indexedIds: string[] = [];
  for (const company of companies) {
    const companyId = String(company?.source_id || "").trim();
    if (!companyId) continue;
    const result = await indexCompany(companyId);
    if (result.indexed) indexedIds.push(companyId);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        catalogResult,
        searchResult,
        indexedIds,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
