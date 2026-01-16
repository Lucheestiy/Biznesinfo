import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appDir = path.resolve(__dirname, "..");
const defaultSrc = path.resolve(appDir, "..", "..", "Info-ibiz", "output", "companies.jsonl");
const src = (process.env.IBIZ_COMPANIES_JSONL_PATH || defaultSrc).trim();
const dst = path.resolve(appDir, "public", "data", "ibiz", "companies.jsonl");

if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`Copied: ${src} -> ${dst}`);

