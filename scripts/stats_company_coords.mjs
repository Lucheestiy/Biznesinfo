import fs from "node:fs";
import readline from "node:readline";

const inputPath = process.argv[2] || "app/public/data/ibiz/companies.jsonl";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function main() {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const stats = {
    path: inputPath,
    total: 0,
    withCoords: 0,
    invalidJson: 0,
    bySource: {},
    bySourceWithCoords: {},
  };

  for await (const line of rl) {
    const raw = (line || "").trim();
    if (!raw) continue;
    stats.total += 1;

    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      stats.invalidJson += 1;
      continue;
    }

    const source = obj?.source || "unknown";
    stats.bySource[source] = (stats.bySource[source] || 0) + 1;

    const lat = obj?.extra?.lat;
    const lng = obj?.extra?.lng;
    const hasCoords = isFiniteNumber(lat) && isFiniteNumber(lng);
    if (hasCoords) {
      stats.withCoords += 1;
      stats.bySourceWithCoords[source] = (stats.bySourceWithCoords[source] || 0) + 1;
    }
  }

  const withCoordsPct = stats.total ? (100 * stats.withCoords / stats.total) : 0;
  console.log(
    JSON.stringify(
      { ...stats, withCoordsPct: `${withCoordsPct.toFixed(2)}%` },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

