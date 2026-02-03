# SQLite → Biznesinfo (biznesinfo.lucheestiy.com) import plan

This directory contains the importer that takes a **local** SQLite dataset and merges it into the **Biznesinfo** catalog JSONL consumed by the site.

## Data flow

1. **Crawler (slow, resumable, polite)**  
   Source: external directory website (company pages + search pages)  
   Output DB: `/home/mlweb/biznesinfo.lucheestiy.com/data/biznesinfo.sqlite3`

2. **Importer (local, idempotent)**  
   Script: `/home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_info_db_into_biznesinfo.py`  
   Input JSONL: `/home/mlweb/biznesinfo.lucheestiy.com/app/public/data/biznesinfo/companies.jsonl`  
   Output JSONL: same file (`--in-place`)

3. **Website**  
   Biznesinfo reads `companies.jsonl` directly from the volume. The API auto-reloads when file mtime changes.

## Import into Biznesinfo

Dry run (no writes):
```bash
python3 /home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_info_db_into_biznesinfo.py --dry-run
```

Write in-place (recommended):
```bash
python3 /home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_info_db_into_biznesinfo.py --in-place --backup
```

## Mapping rules (categories/subcategories)

Biznesinfo uses the existing taxonomy (`category_slug` + `rubric_slug` format `category/rubric`).

Importer behavior:
- If an imported rubric name matches an existing rubric name (case-insensitive), it reuses that rubric slug.
- Otherwise, it creates a rubric slug under a mapped category (see the category map constant in the importer).

## Region filtering (matching existing structure)

Biznesinfo region filtering uses the existing postal-code logic in `biznesinfo.lucheestiy.com/app/src/lib/biznesinfo/store.ts`.

Importer keeps postal codes intact, so the existing logic maps records to:
`minsk`, `minsk-region`, `brest`, `vitebsk`, `gomel`, `grodno`, `mogilev`.

## Duplicate skipping

Importer skips imported companies if they match an existing company by any of:
- phone number (digits-only)
- email (lowercased)
- corporate domain (non-social; excludes common aggregators)
- exact normalized `(name + address)` fallback

## Link sanitization policy

Importer removes source-site links from public fields:
- `websites[]`: removes any URLs pointing to the source site
- `source_url`: stored as an internal `/company/<id>` path
