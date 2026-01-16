# Belarusinfo → Biznes (biznes.lucheestiy.com) import plan

This directory contains the importer that takes the **local** Belarusinfo dataset (SQLite) and merges it into the **Biznes** catalog JSONL consumed by the site.

## Data flow

1. **Crawler (slow, resumable, polite)**  
   Source: `https://www.belarusinfo.by/ru/company/…` + `https://www.belarusinfo.by/ru/poisk/<id>.html`  
   Script: `/home/mlweb/Info/scrape_belarusinfo.py`  
   DB: `/home/mlweb/Info/belarusinfo.sqlite3`

2. **Importer (local, idempotent)**  
   Script: `/home/mlweb/biznes.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py`  
   Input JSONL: `/home/mlweb/biznes.lucheestiy.com/app/public/data/ibiz/companies.jsonl`  
   Output JSONL: same file (`--in-place`)

3. **Website**  
   Biznes reads `companies.jsonl` directly from the volume. The API auto-reloads when file mtime changes.

## One-time setup (already present on this machine)

Check current crawler progress:
```bash
cd /home/mlweb
python3 Info/scrape_belarusinfo.py status
```

## Multi-day “accuracy first” crawl (recommended)

This machine already has a systemd unit:
```bash
systemctl status scrape-belarusinfo.service --no-pager
systemctl restart scrape-belarusinfo.service
```

Notes:
- It only fetches **company detail pages** that are not `done` yet (`status != 'done'`).
- It is resumable: safe to restart any time.

## Import into Biznes

Dry run (no writes):
```bash
python3 /home/mlweb/biznes.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py --dry-run
```

Write in-place (recommended):
```bash
python3 /home/mlweb/biznes.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py --in-place --backup
```

## Mapping rules (categories/subcategories)

Biznes uses the existing IBIZ taxonomy (`category_slug` + `rubric_slug` format `category/rubric`).

Importer behavior:
- If a Belarusinfo rubric name matches an existing IBIZ rubric name (case-insensitive), it reuses that IBIZ rubric slug.
- Otherwise, it creates a rubric slug under a mapped IBIZ category:
  - Belarusinfo top category → IBIZ category (see `BELARUSINFO_CATEGORY_TO_IBIZ_CATEGORY` in the importer).
  - Some Belarusinfo categories are split by rubric keywords (finance, medicine, printing, building materials, etc).

## Region filtering (matching existing structure)

Biznes region filtering uses the existing postal-code logic in `biznes.lucheestiy.com/app/src/lib/ibiz/store.ts`.

Importer ensures Belarusinfo addresses keep postal codes intact, so the existing logic maps records to:
`minsk`, `minsk-region`, `brest`, `vitebsk`, `gomel`, `grodno`, `mogilev`.

## Duplicate skipping

Importer skips Belarusinfo companies if they match an existing company by any of:
- phone number (digits-only)
- email (lowercased)
- corporate domain (non-social; excludes common aggregators)
- exact normalized `(name + address)` fallback

## No belarusinfo.by links policy

Importer removes Belarusinfo links from public fields:
- `websites[]`: removes anything containing `belarusinfo.by`
- `source_url`: always blank for Belarusinfo records
- `description/about`: strips `belarusinfo.by` URLs and bare mentions

## Visual marker (subtle)

Biznes renders a small semi-transparent dot for `source === "belarusinfo"` in:
- company cards (lists/search results)
- company page header

This makes imported companies recognizable to trained eyes without calling attention for regular visitors.

