#!/usr/bin/env npx tsx

import { reindexAll } from "../src/lib/meilisearch/indexer";

async function main() {
  console.log("=".repeat(60));
  console.log("Meilisearch Indexer");
  console.log("=".repeat(60));
  console.log(`MEILI_HOST: ${process.env.MEILI_HOST || "http://localhost:7700"}`);
  console.log("Source: PostgreSQL catalog");
  console.log("=".repeat(60));

  try {
    const result = await reindexAll();
    console.log("=".repeat(60));
    console.log(`SUCCESS! Indexed ${result.indexed} of ${result.total} companies`);
    console.log("=".repeat(60));
    process.exit(0);
  } catch (error) {
    console.error("=".repeat(60));
    console.error("INDEXING FAILED:");
    console.error(error);
    console.error("=".repeat(60));
    process.exit(1);
  }
}

main();
