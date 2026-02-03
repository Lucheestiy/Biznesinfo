import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appDir = path.resolve(__dirname, "..");
const src = (process.env.BIZNESINFO_COMPANIES_JSONL_PATH || "").trim();
const dst = path.resolve(appDir, "public", "data", "biznesinfo", "companies.jsonl");

if (!src) {
  console.error("BIZNESINFO_COMPANIES_JSONL_PATH is required (path to companies.jsonl)");
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`Copied: ${src} -> ${dst}`);
