import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  generateCompanyKeywordsString,
  type KeywordFallbackMode,
  type KeywordGenerationOptions,
} from "../src/lib/biznesinfo/keywords";
import {
  createVolumeLookup,
  loadKeywordVolumeMapFromFiles,
  parseStatsPaths,
} from "../src/lib/biznesinfo/keywordStats";
import type { BiznesinfoCompany } from "../src/lib/biznesinfo/types";

interface CliOptions {
  src: string;
  out: string;
  statsFiles: string[];
  strictStats: boolean;
  fallbackMode: KeywordFallbackMode;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];

  let src = "public/data/biznesinfo/companies.jsonl";
  let out = "public/data/biznesinfo/company_keywords.jsonl";
  const statsFiles: string[] = [];
  let strictStats = false;
  let fallbackMode: KeywordFallbackMode = "rubrics";

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--src") {
      src = args.shift() || src;
      continue;
    }

    if (arg === "--out") {
      out = args.shift() || out;
      continue;
    }

    if (arg === "--stats" || arg === "--volumes") {
      const value = args.shift() || "";
      for (const part of parseStatsPaths(value)) statsFiles.push(part);
      continue;
    }

    if (arg === "--strict-stats") {
      strictStats = true;
      continue;
    }

    if (arg === "--no-strict-stats") {
      strictStats = false;
      continue;
    }

    if (arg === "--fallback-mode") {
      fallbackMode = (args.shift() || "rubrics").trim().toLowerCase() === "short" ? "short" : "rubrics";
      continue;
    }
  }

  for (const envPath of parseStatsPaths(process.env.KEYWORDS_STATS_FILES)) statsFiles.push(envPath);
  for (const envPath of parseStatsPaths(process.env.KEYWORD_STATS_FILES)) statsFiles.push(envPath);

  if (process.env.KEYWORDS_STRICT_STATS) {
    const flag = process.env.KEYWORDS_STRICT_STATS.trim().toLowerCase();
    strictStats = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  }

  if (process.env.KEYWORDS_FALLBACK_MODE) {
    fallbackMode = process.env.KEYWORDS_FALLBACK_MODE.trim().toLowerCase() === "short" ? "short" : "rubrics";
  }

  return {
    src,
    out,
    statsFiles: Array.from(new Set(statsFiles)),
    strictStats,
    fallbackMode,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const srcPath = path.resolve(process.cwd(), options.src);
  const outPath = path.resolve(process.cwd(), options.out);

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source JSONL not found: ${srcPath}`);
  }

  const volumeMap = loadKeywordVolumeMapFromFiles(options.statsFiles, {
    skipMissing: true,
    onWarning: (message) => {
      console.warn(`[keywords:gen] ${message}`);
    },
  });

  const keywordOptions: KeywordGenerationOptions = {
    maxKeywords: 10,
    strictStats: options.strictStats,
    fallbackMode: options.fallbackMode,
    volumeMap,
    volumeLookup: volumeMap.size > 0 ? createVolumeLookup(volumeMap) : undefined,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const input = fs.createReadStream(srcPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const outStream = fs.createWriteStream(outPath, { encoding: "utf-8" });

  let total = 0;
  let written = 0;

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;
    total += 1;

    try {
      const company = JSON.parse(raw) as BiznesinfoCompany;
      if (!company?.source_id) continue;

      const keywords = generateCompanyKeywordsString(company, keywordOptions);
      outStream.write(`${JSON.stringify({ id: company.source_id, keywords })}\n`);
      written += 1;
    } catch {
      // skip invalid line
    }

    if (written > 0 && written % 5000 === 0) {
      console.log(`[keywords:gen] Generated ${written} rows...`);
    }
  }

  outStream.end();

  console.log("[keywords:gen] Done");
  console.log(`  source: ${srcPath}`);
  console.log(`  output: ${outPath}`);
  console.log(`  parsed: ${total}`);
  console.log(`  written: ${written}`);
  console.log(`  stats files: ${options.statsFiles.length}`);
  console.log(`  stats keys: ${volumeMap.size}`);
  console.log(`  strictStats: ${keywordOptions.strictStats ? "on" : "off"}`);
  console.log(`  fallbackMode: ${keywordOptions.fallbackMode || "rubrics"}`);
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
