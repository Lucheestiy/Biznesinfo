#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const { Pool } = pg;
const LOAD_BATCH_SIZE = Math.max(100, Math.min(1000, Number.parseInt(process.env.BIZNESINFO_STAGING_BATCH_SIZE || "500", 10) || 500));

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
    || path.join(process.cwd(), "public", "data", "biznesinfo", "companies.jsonl");
  if (!fs.existsSync(jsonlPath)) throw new Error(`JSONL not found: ${jsonlPath}`);

  console.log("=".repeat(72));
  console.log("Rebuild Biznesinfo catalog tables (set-based)");
  console.log(`Source: ${jsonlPath}`);
  console.log(`Load batch size: ${LOAD_BATCH_SIZE}`);
  console.log("=".repeat(72));

  const pool = new Pool({ connectionString: databaseUrl });

  await pool.query("DROP TABLE IF EXISTS import_raw");
  await pool.query("CREATE TABLE import_raw(payload jsonb NOT NULL)");

  const insertBatch = async (items) => {
    if (items.length === 0) return;
    const placeholders = items.map((_, i) => `($${i + 1}::jsonb)`).join(", ");
    const sql = `INSERT INTO import_raw(payload) VALUES ${placeholders}`;
    await pool.query(sql, items);
  };

  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  let totalLines = 0;
  let insertedRows = 0;
  let invalidLines = 0;
  let buffer = [];

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
      buffer.push(JSON.stringify(parsed));
      if (buffer.length >= LOAD_BATCH_SIZE) {
        await insertBatch(buffer);
        insertedRows += buffer.length;
        buffer = [];
        if (insertedRows % 5000 === 0) {
          console.log(`Loaded ${insertedRows} rows into import_raw`);
        }
      }
    } catch {
      invalidLines += 1;
    }
  }
  if (buffer.length > 0) {
    await insertBatch(buffer);
    insertedRows += buffer.length;
  }

  console.log(`Read lines: ${totalLines}`);
  console.log(`Inserted to import_raw: ${insertedRows}`);
  console.log(`Invalid skipped: ${invalidLines}`);

  const transformSql = `
    BEGIN;

    TRUNCATE TABLE
      biznesinfo_company_rubrics,
      biznesinfo_company_categories,
      biznesinfo_rubrics,
      biznesinfo_categories,
      biznesinfo_companies
    RESTART IDENTITY;

    INSERT INTO biznesinfo_companies (
      id, source, unp, name, search_text, region_slug, city_norm,
      primary_category_slug, primary_category_name,
      primary_rubric_slug, primary_rubric_name,
      payload, updated_at
    )
    SELECT
      src_id AS id,
      'biznesinfo' AS source,
      regexp_replace(COALESCE(payload->>'unp', ''), '\\D+', '', 'g') AS unp,
      COALESCE(payload->>'name', '') AS name,
      lower(concat_ws(' ',
        payload->>'name',
        payload->>'description',
        payload->>'about',
        payload->>'address'
      )) AS search_text,
      CASE
        WHEN low_region LIKE '%брест%' OR low_city LIKE '%брест%' THEN 'brest'
        WHEN low_region LIKE '%витеб%' OR low_city LIKE '%витеб%' THEN 'vitebsk'
        WHEN low_region LIKE '%гомел%' OR low_city LIKE '%гомел%' THEN 'gomel'
        WHEN low_region LIKE '%гродн%' OR low_city LIKE '%гродн%' THEN 'grodno'
        WHEN low_region LIKE '%могил%' OR low_city LIKE '%могил%' THEN 'mogilev'
        WHEN (low_city LIKE '%минск%') AND (
          low_city LIKE '%р-н%' OR low_city LIKE '%район%' OR low_city LIKE '%обл%' OR low_city LIKE '%область%'
        ) THEN 'minsk-region'
        WHEN (low_region LIKE '%минск%') AND (
          low_region LIKE '%р-н%' OR low_region LIKE '%район%' OR low_region LIKE '%обл%' OR low_region LIKE '%область%'
        ) THEN 'minsk-region'
        WHEN low_city LIKE '%минск%' THEN 'minsk'
        WHEN low_region LIKE '%минск%' THEN 'minsk'
        ELSE NULL
      END AS region_slug,
      lower(replace(trim(COALESCE(payload->>'city', '')), 'ё', 'е')) AS city_norm,
      NULLIF(trim(COALESCE(payload->'categories'->0->>'slug', '')), '') AS primary_category_slug,
      NULLIF(trim(COALESCE(payload->'categories'->0->>'name', '')), '') AS primary_category_name,
      NULLIF(trim(COALESCE(payload->'rubrics'->0->>'slug', '')), '') AS primary_rubric_slug,
      NULLIF(trim(COALESCE(payload->'rubrics'->0->>'name', '')), '') AS primary_rubric_name,
      payload,
      now() AS updated_at
    FROM (
      SELECT
        payload,
        trim(COALESCE(payload->>'source_id', '')) AS src_id,
        lower(COALESCE(payload->>'city', '')) AS low_city,
        lower(COALESCE(payload->>'region', '')) AS low_region
      FROM import_raw
    ) s
    WHERE src_id <> ''
      AND lower(src_id) <> 'biznesinfo-1002';

    INSERT INTO biznesinfo_categories (slug, name, url)
    SELECT DISTINCT
      slug,
      COALESCE(NULLIF(trim(cat->>'name'), ''), slug) AS name,
      COALESCE(NULLIF(trim(cat->>'url'), ''), '/catalog/' || slug) AS url
    FROM import_raw r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'categories', '[]'::jsonb)) cat
    CROSS JOIN LATERAL (SELECT trim(COALESCE(cat->>'slug', '')) AS slug) s
    WHERE s.slug <> ''
    ON CONFLICT (slug)
    DO UPDATE SET
      name = EXCLUDED.name,
      url = EXCLUDED.url;

    INSERT INTO biznesinfo_rubrics (slug, name, url, category_slug, category_name)
    SELECT DISTINCT
      rubric_slug,
      COALESCE(NULLIF(trim(rub->>'name'), ''), rubric_slug) AS name,
      COALESCE(
        NULLIF(trim(rub->>'url'), ''),
        '/catalog/' || category_slug || '/' || COALESCE(NULLIF(regexp_replace(rubric_slug, '^[^/]+/?', ''), ''), rubric_slug)
      ) AS url,
      category_slug,
      COALESCE(NULLIF(trim(rub->>'category_name'), ''), category_slug) AS category_name
    FROM import_raw r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'rubrics', '[]'::jsonb)) rub
    CROSS JOIN LATERAL (
      SELECT
        trim(COALESCE(rub->>'slug', '')) AS rubric_slug,
        COALESCE(
          NULLIF(trim(rub->>'category_slug'), ''),
          NULLIF(split_part(trim(COALESCE(rub->>'slug', '')), '/', 1), '')
        ) AS category_slug
    ) s
    WHERE s.rubric_slug <> ''
      AND s.category_slug <> ''
    ON CONFLICT (slug)
    DO UPDATE SET
      name = EXCLUDED.name,
      url = EXCLUDED.url,
      category_slug = EXCLUDED.category_slug,
      category_name = EXCLUDED.category_name;

    INSERT INTO biznesinfo_company_categories (
      company_id, category_slug, category_name, category_url, position
    )
    SELECT
      src_id AS company_id,
      slug AS category_slug,
      COALESCE(NULLIF(trim(cat->>'name'), ''), slug) AS category_name,
      COALESCE(NULLIF(trim(cat->>'url'), ''), '/catalog/' || slug) AS category_url,
      (ord - 1)::int AS position
    FROM (
      SELECT payload, trim(COALESCE(payload->>'source_id', '')) AS src_id
      FROM import_raw
    ) r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'categories', '[]'::jsonb)) WITH ORDINALITY AS c(cat, ord)
    CROSS JOIN LATERAL (SELECT trim(COALESCE(c.cat->>'slug', '')) AS slug) s
    WHERE r.src_id <> ''
      AND lower(r.src_id) <> 'biznesinfo-1002'
      AND s.slug <> ''
    ON CONFLICT (company_id, category_slug)
    DO UPDATE SET
      category_name = EXCLUDED.category_name,
      category_url = EXCLUDED.category_url,
      position = EXCLUDED.position;

    INSERT INTO biznesinfo_company_rubrics (
      company_id, rubric_slug, rubric_name, rubric_url,
      category_slug, category_name, position
    )
    SELECT
      src_id AS company_id,
      rubric_slug,
      COALESCE(NULLIF(trim(rub->>'name'), ''), rubric_slug) AS rubric_name,
      COALESCE(
        NULLIF(trim(rub->>'url'), ''),
        '/catalog/' || category_slug || '/' || COALESCE(NULLIF(regexp_replace(rubric_slug, '^[^/]+/?', ''), ''), rubric_slug)
      ) AS rubric_url,
      category_slug,
      COALESCE(NULLIF(trim(rub->>'category_name'), ''), category_slug) AS category_name,
      (ord - 1)::int AS position
    FROM (
      SELECT payload, trim(COALESCE(payload->>'source_id', '')) AS src_id
      FROM import_raw
    ) r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'rubrics', '[]'::jsonb)) WITH ORDINALITY AS x(rub, ord)
    CROSS JOIN LATERAL (
      SELECT
        trim(COALESCE(x.rub->>'slug', '')) AS rubric_slug,
        COALESCE(
          NULLIF(trim(x.rub->>'category_slug'), ''),
          NULLIF(split_part(trim(COALESCE(x.rub->>'slug', '')), '/', 1), '')
        ) AS category_slug
    ) s
    WHERE r.src_id <> ''
      AND lower(r.src_id) <> 'biznesinfo-1002'
      AND s.rubric_slug <> ''
      AND s.category_slug <> ''
    ON CONFLICT (company_id, rubric_slug)
    DO UPDATE SET
      rubric_name = EXCLUDED.rubric_name,
      rubric_url = EXCLUDED.rubric_url,
      category_slug = EXCLUDED.category_slug,
      category_name = EXCLUDED.category_name,
      position = EXCLUDED.position;

    COMMIT;
  `;

  console.log("Applying set-based transform into catalog tables...");
  await pool.query(transformSql);

  const totalsRes = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM biznesinfo_companies) AS companies_total,
        (SELECT COUNT(*)::int FROM biznesinfo_categories) AS categories_total,
        (SELECT COUNT(*)::int FROM biznesinfo_rubrics) AS rubrics_total
    `,
  );

  console.log("Final totals:", totalsRes.rows[0]);
  console.log("Done.");

  await pool.end();
}

main().catch((error) => {
  console.error("Catalog rebuild failed:", error);
  process.exit(1);
});

