#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const { Pool } = pg;

const BATCH_SIZE = Math.max(50, Math.min(500, Number.parseInt(process.env.BIZNESINFO_CATALOG_BATCH_SIZE || "150", 10) || 150));

const POSTAL_PREFIX_TO_REGION_SLUG = {
  "210": "vitebsk",
  "211": "vitebsk",
  "212": "mogilev",
  "213": "mogilev",
  "220": "minsk",
  "221": "minsk-region",
  "222": "minsk-region",
  "223": "minsk-region",
  "224": "brest",
  "225": "brest",
  "230": "grodno",
  "231": "grodno",
  "246": "gomel",
  "247": "gomel",
  "200": "minsk",
  "201": "vitebsk",
  "202": "minsk-region",
  "215": "minsk",
  "217": "vitebsk",
  "227": "minsk-region",
  "232": "minsk",
  "234": "grodno",
  "236": "gomel",
  "249": "vitebsk",
  "264": "gomel",
  "270": "minsk",
  "274": "gomel",
};

function safeLower(value) {
  return String(value || "").toLowerCase();
}

function regionSlugFromPostalCode(address) {
  const matches = String(address || "").match(/\b2\d{5}\b/g);
  if (!matches) return null;
  for (const code of matches) {
    const prefix = code.slice(0, 3);
    const regionSlug = POSTAL_PREFIX_TO_REGION_SLUG[prefix];
    if (regionSlug) return regionSlug;
  }
  return null;
}

function normalizeRegionSlug(city, region, address) {
  const cityLow = safeLower(city);
  const regionLow = safeLower(region);
  const addressLow = safeLower(address);

  if (regionLow.includes("брест")) return "brest";
  if (regionLow.includes("витеб")) return "vitebsk";
  if (regionLow.includes("гомел")) return "gomel";
  if (regionLow.includes("гродн")) return "grodno";
  if (regionLow.includes("могил")) return "mogilev";

  if (cityLow.includes("брест")) return "brest";
  if (cityLow.includes("витеб")) return "vitebsk";
  if (cityLow.includes("гомел")) return "gomel";
  if (cityLow.includes("гродн")) return "grodno";
  if (cityLow.includes("могил")) return "mogilev";

  const looksLikeDistrict = (s) => {
    const v = safeLower(s);
    return v.includes("р-н") || v.includes("район") || v.includes("обл") || v.includes("область");
  };

  const minskDistrictRe = /минск(?:ий|ого|ому|ом)?\s*(?:р-н|район)/i;
  const minskOblastRe = /минск(?:ая|ой|ую|ом)?\s*(?:обл\.?|область)/i;

  const isMinskRegion =
    minskDistrictRe.test(cityLow) ||
    minskOblastRe.test(cityLow) ||
    minskDistrictRe.test(regionLow) ||
    minskOblastRe.test(regionLow) ||
    minskDistrictRe.test(addressLow) ||
    minskOblastRe.test(addressLow) ||
    (cityLow.includes("минск") && looksLikeDistrict(cityLow)) ||
    (regionLow.includes("минск") && looksLikeDistrict(regionLow));

  if (isMinskRegion) return "minsk-region";

  const fromPostal = regionSlugFromPostalCode(address);
  if (fromPostal) return fromPostal;

  if (cityLow.includes("минск")) return "minsk";
  if (regionLow.includes("минск")) return "minsk";
  return null;
}

function normalizeCityForFilter(city) {
  return String(city || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildCompanySearchText(company) {
  return [
    company.name,
    company.description,
    company.about,
    company.address,
    Array.isArray(company.phones) ? company.phones.join(" ") : "",
    Array.isArray(company.emails) ? company.emails.join(" ") : "",
    Array.isArray(company.websites) ? company.websites.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function upsertCompanyBatch(client, companies) {
  for (const rawCompany of companies) {
    const sourceId = String(rawCompany?.source_id || "").trim();
    if (!sourceId) continue;

    const company = rawCompany;
    const categories = Array.isArray(company.categories) ? company.categories : [];
    const rubrics = Array.isArray(company.rubrics) ? company.rubrics : [];
    const primaryCategory = categories[0] || null;
    const primaryRubric = rubrics[0] || null;

    const regionSlug = normalizeRegionSlug(company.city || "", company.region || "", company.address || "");
    const cityNorm = normalizeCityForFilter(company.city || "");
    const searchText = buildCompanySearchText(company);

    await client.query(
      `
        INSERT INTO biznesinfo_companies (
          id, source, unp, name, search_text, region_slug, city_norm,
          primary_category_slug, primary_category_name,
          primary_rubric_slug, primary_rubric_name,
          payload, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9,
          $10, $11,
          $12::jsonb, now()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          source = EXCLUDED.source,
          unp = EXCLUDED.unp,
          name = EXCLUDED.name,
          search_text = EXCLUDED.search_text,
          region_slug = EXCLUDED.region_slug,
          city_norm = EXCLUDED.city_norm,
          primary_category_slug = EXCLUDED.primary_category_slug,
          primary_category_name = EXCLUDED.primary_category_name,
          primary_rubric_slug = EXCLUDED.primary_rubric_slug,
          primary_rubric_name = EXCLUDED.primary_rubric_name,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [
        sourceId,
        "biznesinfo",
        String(company.unp || "").trim(),
        String(company.name || "").trim(),
        searchText,
        regionSlug,
        cityNorm,
        primaryCategory?.slug ?? null,
        primaryCategory?.name ?? null,
        primaryRubric?.slug ?? null,
        primaryRubric?.name ?? null,
        JSON.stringify(company),
      ],
    );

    await client.query("DELETE FROM biznesinfo_company_categories WHERE company_id = $1", [sourceId]);
    await client.query("DELETE FROM biznesinfo_company_rubrics WHERE company_id = $1", [sourceId]);

    const seenCategories = new Set();
    for (let idx = 0; idx < categories.length; idx += 1) {
      const category = categories[idx];
      const slug = String(category?.slug || "").trim();
      if (!slug || seenCategories.has(slug)) continue;
      seenCategories.add(slug);

      const name = String(category?.name || slug).trim() || slug;
      const url = String(category?.url || `/catalog/${slug}`).trim() || `/catalog/${slug}`;

      await client.query(
        `
          INSERT INTO biznesinfo_categories (slug, name, url)
          VALUES ($1, $2, $3)
          ON CONFLICT (slug)
          DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url
        `,
        [slug, name, url],
      );

      await client.query(
        `
          INSERT INTO biznesinfo_company_categories (
            company_id, category_slug, category_name, category_url, position
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (company_id, category_slug)
          DO UPDATE SET
            category_name = EXCLUDED.category_name,
            category_url = EXCLUDED.category_url,
            position = EXCLUDED.position
        `,
        [sourceId, slug, name, url, idx],
      );
    }

    const seenRubrics = new Set();
    for (let idx = 0; idx < rubrics.length; idx += 1) {
      const rubric = rubrics[idx];
      const rubricSlug = String(rubric?.slug || "").trim();
      const categorySlug = String(rubric?.category_slug || "").trim();
      if (!rubricSlug || !categorySlug || seenRubrics.has(rubricSlug)) continue;
      seenRubrics.add(rubricSlug);

      const rubricName = String(rubric?.name || rubricSlug).trim() || rubricSlug;
      const rubricUrl = String(
        rubric?.url || `/catalog/${categorySlug}/${rubricSlug.split("/").slice(1).join("/")}`,
      ).trim() || `/catalog/${categorySlug}/${rubricSlug.split("/").slice(1).join("/")}`;
      const categoryName = String(rubric?.category_name || categorySlug).trim() || categorySlug;

      await client.query(
        `
          INSERT INTO biznesinfo_rubrics (slug, name, url, category_slug, category_name)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (slug)
          DO UPDATE SET
            name = EXCLUDED.name,
            url = EXCLUDED.url,
            category_slug = EXCLUDED.category_slug,
            category_name = EXCLUDED.category_name
        `,
        [rubricSlug, rubricName, rubricUrl, categorySlug, categoryName],
      );

      await client.query(
        `
          INSERT INTO biznesinfo_company_rubrics (
            company_id, rubric_slug, rubric_name, rubric_url,
            category_slug, category_name, position
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (company_id, rubric_slug)
          DO UPDATE SET
            rubric_name = EXCLUDED.rubric_name,
            rubric_url = EXCLUDED.rubric_url,
            category_slug = EXCLUDED.category_slug,
            category_name = EXCLUDED.category_name,
            position = EXCLUDED.position
        `,
        [sourceId, rubricSlug, rubricName, rubricUrl, categorySlug, categoryName, idx],
      );
    }
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
    || path.join(process.cwd(), "public", "data", "biznesinfo", "companies.jsonl");

  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL not found: ${jsonlPath}`);
  }

  console.log("=".repeat(70));
  console.log("Rebuild Biznesinfo PostgreSQL catalog from JSONL (stream)");
  console.log("=".repeat(70));
  console.log(`Source: ${jsonlPath}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    console.log("Truncating catalog tables...");
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE TABLE biznesinfo_company_rubrics, biznesinfo_company_categories, biznesinfo_rubrics, biznesinfo_categories, biznesinfo_companies RESTART IDENTITY",
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }

  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  let totalLines = 0;
  let invalidLines = 0;
  let parsedCompanies = 0;
  let batches = 0;
  const batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await upsertCompanyBatch(c, batch);
      await c.query("COMMIT");
      batches += 1;
      parsedCompanies += batch.length;
      console.log(`[batch ${batches}] upserted ${batch.length} companies (total ${parsedCompanies})`);
    } catch (error) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    } finally {
      c.release();
      batch.length = 0;
    }
  };

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    totalLines += 1;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.source_id) {
        invalidLines += 1;
        continue;
      }
      batch.push(parsed);
      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    } catch {
      invalidLines += 1;
    }
  }
  await flush();

  const stats = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM biznesinfo_companies) AS companies_total,
        (SELECT COUNT(*)::int FROM biznesinfo_categories) AS categories_total,
        (SELECT COUNT(*)::int FROM biznesinfo_rubrics) AS rubrics_total
    `,
  );

  console.log("=".repeat(70));
  console.log(`Read lines: ${totalLines}`);
  console.log(`Invalid skipped: ${invalidLines}`);
  console.log(`Batches: ${batches}`);
  console.log("Final totals:", stats.rows[0]);
  console.log("Done.");
  console.log("=".repeat(70));

  await pool.end();
}

main().catch((error) => {
  console.error("Catalog rebuild failed:", error);
  process.exit(1);
});

