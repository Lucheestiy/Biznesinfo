import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { generateCompanyKeywordsString } from "../src/lib/biznesinfo/keywords";
import type { BiznesinfoCompany } from "../src/lib/biznesinfo/types";

type VolumeMap = Map<string, number>;

function normalizeKey(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
}

function loadVolumes(filePath: string): VolumeMap {
  const out: VolumeMap = new Map();
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) return out;

  const raw = fs.readFileSync(abs, "utf-8");
  const data = JSON.parse(raw) as Record<string, number>;
  for (const [k, v] of Object.entries(data || {})) {
    const key = normalizeKey(k);
    const num = Number(v);
    if (!key) continue;
    if (!Number.isFinite(num)) continue;
    out.set(key, num);
  }
  return out;
}

function parseArgs(argv: string[]): { src: string; out: string; volumes?: string } {
  const args = [...argv];
  let src = "public/data/biznesinfo/companies.jsonl";
  let out = "public/data/biznesinfo/company_keywords.jsonl";
  let volumes: string | undefined;

  while (args.length > 0) {
    const a = args.shift();
    if (!a) break;
    if (a === "--src") src = args.shift() || src;
    else if (a === "--out") out = args.shift() || out;
    else if (a === "--volumes") volumes = args.shift() || volumes;
  }

  return { src, out, volumes };
}

async function main(): Promise<void> {
  const { src, out, volumes } = parseArgs(process.argv.slice(2));
  const srcPath = path.resolve(process.cwd(), src);
  const outPath = path.resolve(process.cwd(), out);

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source JSONL not found: ${srcPath}`);
  }

  const volumesPath = volumes || process.env.KEYWORD_VOLUMES_PATH || "";
  const volumeMap = volumesPath ? loadVolumes(volumesPath) : new Map<string, number>();
  const volumeLookup = volumeMap.size > 0 ? (phrase: string) => volumeMap.get(normalizeKey(phrase)) : undefined;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const input = fs.createReadStream(srcPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const outStream = fs.createWriteStream(outPath, { encoding: "utf-8" });

  const now = new Date();
  let total = 0;
  let written = 0;

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;
    total += 1;

    try {
      const company = JSON.parse(raw) as BiznesinfoCompany;
      if (!company?.source_id) continue;
      const keywords = generateCompanyKeywordsString(company, { maxKeywords: 10, now, volumeLookup });
      outStream.write(`${JSON.stringify({ id: company.source_id, keywords })}\n`);
      written += 1;
    } catch {
      // skip invalid lines
    }

    if (written > 0 && written % 5000 === 0) {
      console.log(`Generated keywords: ${written} companies...`);
    }
  }

  outStream.end();
  console.log(`Done. Parsed: ${total} lines. Wrote: ${written}. Output: ${outPath}`);
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
