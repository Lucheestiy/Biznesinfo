# Meilisearch Implementation Plan for biznesinfo.lucheestiy.com

## Project Overview

**Current State:**
- Next.js 16.1.1 + React 19 + TypeScript + Tailwind CSS
- ~87,000 companies stored in JSONL file (`public/data/biznesinfo/companies.jsonl`)
- In-memory search using simple substring matching in `src/lib/biznesinfo/store.ts`
- Docker deployment: app + nginx containers on port 8102

**Goal:** Replace current in-memory search with Meilisearch for faster, typo-tolerant, relevance-ranked search.

---

## Phase 1: Infrastructure Setup

### 1.1 Update docker-compose.yml

Add Meilisearch service with persistent storage:

```yaml
services:
  meilisearch:
    image: getmeili/meilisearch:v1.12
    container_name: biznes-meilisearch
    restart: unless-stopped
    environment:
      MEILI_ENV: production
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-your-secure-master-key-here}
      MEILI_NO_ANALYTICS: true
    volumes:
      - meilisearch-data:/meili_data
    networks:
      - biznes-network
    expose:
      - "7700"

volumes:
  meilisearch-data:
```

### 1.2 Update App Service Environment

Add Meilisearch connection variables to app service:

```yaml
environment:
  NODE_ENV: production
  BIZNESINFO_COMPANIES_JSONL_PATH: /app/public/data/biznesinfo/companies.jsonl
  MEILI_HOST: http://meilisearch:7700
  MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-your-secure-master-key-here}
```

### 1.3 Create .env File Template

Create `.env.example`:
```
MEILI_MASTER_KEY=change-this-to-a-secure-random-key-min-16-chars
```

---

## Phase 2: Dependencies & Types

### 2.1 Install Meilisearch SDK

```bash
cd /home/mlweb/biznes.lucheestiy.com/app
npm install meilisearch
```

### 2.2 Create Types File

Create `src/lib/meilisearch/types.ts`:

```typescript
// Document structure for Meilisearch index
export interface MeiliCompanyDocument {
  id: string;                    // source_id (primary key)
  source: "biznesinfo";
  name: string;
  description: string;
  about: string;
  address: string;
  city: string;
  region: string;               // normalized slug (minsk, brest, etc.)
  phones: string[];
  emails: string[];
  websites: string[];
  logo_url: string;
  contact_person: string;

  // Categories & Rubrics (denormalized for filtering)
  category_slugs: string[];
  category_names: string[];
  rubric_slugs: string[];
  rubric_names: string[];
  primary_category_slug: string | null;
  primary_category_name: string | null;
  primary_rubric_slug: string | null;
  primary_rubric_name: string | null;

  // Geo (for future geo-search)
  _geo?: { lat: number; lng: number } | null;

  // Work hours (stored but not searched)
  work_hours_status: string | null;
  work_hours_time: string | null;
}

export interface MeiliSearchParams {
  query: string;
  region?: string | null;
  categorySlug?: string | null;
  rubricSlug?: string | null;
  offset?: number;
  limit?: number;
}

export interface MeiliSearchResult {
  hits: MeiliCompanyDocument[];
  query: string;
  processingTimeMs: number;
  limit: number;
  offset: number;
  estimatedTotalHits: number;
}
```

---

## Phase 3: Meilisearch Client & Configuration

### 3.1 Create Client Module

Create `src/lib/meilisearch/client.ts`:

```typescript
import { MeiliSearch, Index } from 'meilisearch';
import type { MeiliCompanyDocument } from './types';

const MEILI_HOST = process.env.MEILI_HOST || 'http://localhost:7700';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || '';

let clientInstance: MeiliSearch | null = null;

export function getMeiliClient(): MeiliSearch {
  if (!clientInstance) {
    clientInstance = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_MASTER_KEY,
    });
  }
  return clientInstance;
}

export const COMPANIES_INDEX = 'companies';

export function getCompaniesIndex(): Index<MeiliCompanyDocument> {
  return getMeiliClient().index<MeiliCompanyDocument>(COMPANIES_INDEX);
}
```

### 3.2 Create Index Configuration

Create `src/lib/meilisearch/config.ts`:

```typescript
import { getMeiliClient, COMPANIES_INDEX } from './client';
import type { MeiliCompanyDocument } from './types';

export async function configureCompaniesIndex(): Promise<void> {
  const client = getMeiliClient();

  // Create or get index
  await client.createIndex(COMPANIES_INDEX, { primaryKey: 'id' });
  const index = client.index<MeiliCompanyDocument>(COMPANIES_INDEX);

  // Configure searchable attributes (order = priority)
  await index.updateSearchableAttributes([
    'name',
    'description',
    'about',
    'category_names',
    'rubric_names',
    'address',
    'city',
    'contact_person',
    'phones',
    'emails',
    'websites',
  ]);

  // Configure filterable attributes
  await index.updateFilterableAttributes([
    'region',
    'category_slugs',
    'rubric_slugs',
    'primary_category_slug',
    'source',
  ]);

  // Configure sortable attributes
  await index.updateSortableAttributes([
    'name',
  ]);

  // Configure ranking rules
  await index.updateRankingRules([
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness',
  ]);

  // Configure typo tolerance
  await index.updateTypoTolerance({
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 8,
    },
  });

  // Configure synonyms (Russian business terms)
  await index.updateSynonyms({
    'ооо': ['общество с ограниченной ответственностью', 'llc'],
    'оао': ['открытое акционерное общество'],
    'зао': ['закрытое акционерное общество'],
    'чуп': ['частное унитарное предприятие'],
    'ип': ['индивидуальный предприниматель'],
    'уп': ['унитарное предприятие'],
    'ремонт': ['починка', 'восстановление'],
    'строительство': ['стройка', 'строить'],
  });

  console.log('Meilisearch companies index configured');
}
```

---

## Phase 4: Indexing Script

### 4.1 Create Indexer Module

Create `src/lib/meilisearch/indexer.ts`:

```typescript
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { getMeiliClient, COMPANIES_INDEX } from './client';
import { configureCompaniesIndex } from './config';
import type { MeiliCompanyDocument } from './types';
import type { BiznesinfoCompany } from '../biznesinfo/types';

// Reuse region normalization from store.ts
function normalizeRegionSlug(city: string, region: string, address: string): string | null {
  const cityLow = (city || '').toLowerCase();
  const regionLow = (region || '').toLowerCase();
  const addressLow = (address || '').toLowerCase();

  if (regionLow.includes('брест')) return 'brest';
  if (regionLow.includes('витеб')) return 'vitebsk';
  if (regionLow.includes('гомел')) return 'gomel';
  if (regionLow.includes('гродн')) return 'grodno';
  if (regionLow.includes('могил')) return 'mogilev';

  if (cityLow.includes('брест')) return 'brest';
  if (cityLow.includes('витеб')) return 'vitebsk';
  if (cityLow.includes('гомел')) return 'gomel';
  if (cityLow.includes('гродн')) return 'grodno';
  if (cityLow.includes('могил')) return 'mogilev';

  const minskDistrictRe = /минск(?:ий|ого|ому|ом)?\s*(?:р-н|район)/i;
  const minskOblastRe = /минск(?:ая|ой|ую|ом)?\s*(?:обл\.?|область)/i;

  const isMinskRegion =
    minskDistrictRe.test(cityLow) ||
    minskOblastRe.test(cityLow) ||
    minskDistrictRe.test(regionLow) ||
    minskOblastRe.test(regionLow) ||
    minskDistrictRe.test(addressLow) ||
    minskOblastRe.test(addressLow);

  if (isMinskRegion) return 'minsk-region';

  if (cityLow.includes('минск')) return 'minsk';
  if (regionLow.includes('минск')) return 'minsk';

  return null;
}

function companyToDocument(company: BiznesinfoCompany): MeiliCompanyDocument {
  const regionSlug = normalizeRegionSlug(company.city, company.region, company.address);
  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;

  return {
    id: company.source_id,
    source: company.source,
    name: company.name || '',
    description: company.description || '',
    about: company.about || '',
    address: company.address || '',
    city: company.city || '',
    region: regionSlug || '',
    phones: company.phones || [],
    emails: company.emails || [],
    websites: company.websites || [],
    logo_url: company.logo_url || '',
    contact_person: company.contact_person || '',

    category_slugs: (company.categories || []).map(c => c.slug),
    category_names: (company.categories || []).map(c => c.name),
    rubric_slugs: (company.rubrics || []).map(r => r.slug),
    rubric_names: (company.rubrics || []).map(r => r.name),
    primary_category_slug: primaryCategory?.slug ?? null,
    primary_category_name: primaryCategory?.name ?? null,
    primary_rubric_slug: primaryRubric?.slug ?? null,
    primary_rubric_name: primaryRubric?.name ?? null,

    _geo: (company.extra?.lat && company.extra?.lng)
      ? { lat: company.extra.lat, lng: company.extra.lng }
      : null,

    work_hours_status: company.work_hours?.status ?? null,
    work_hours_time: company.work_hours?.work_time ?? null,
  };
}

export async function indexCompanies(jsonlPath: string): Promise<{ total: number; indexed: number }> {
  // Configure index first
  await configureCompaniesIndex();

  const index = getMeiliClient().index<MeiliCompanyDocument>(COMPANIES_INDEX);

  // Clear existing documents
  await index.deleteAllDocuments();

  const input = fs.createReadStream(jsonlPath, { encoding: 'utf-8' });
  const rl = createInterface({ input, crlfDelay: Infinity });

  const documents: MeiliCompanyDocument[] = [];
  const BATCH_SIZE = 5000;
  let total = 0;
  let indexed = 0;

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    try {
      const company = JSON.parse(raw) as BiznesinfoCompany;
      if (!company.source_id) continue;

      documents.push(companyToDocument(company));
      total++;

      if (documents.length >= BATCH_SIZE) {
        const task = await index.addDocuments(documents);
        await getMeiliClient().waitForTask(task.taskUid);
        indexed += documents.length;
        console.log(`Indexed ${indexed} documents...`);
        documents.length = 0;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Index remaining documents
  if (documents.length > 0) {
    const task = await index.addDocuments(documents);
    await getMeiliClient().waitForTask(task.taskUid);
    indexed += documents.length;
  }

  console.log(`Indexing complete: ${indexed}/${total} documents`);
  return { total, indexed };
}
```

### 4.2 Create CLI Indexing Script

Create `scripts/index_meilisearch.mjs`:

```javascript
#!/usr/bin/env node

import { indexCompanies } from '../src/lib/meilisearch/indexer.js';
import path from 'node:path';

const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
  || path.join(process.cwd(), 'public', 'data', 'biznesinfo', 'companies.jsonl');

console.log(`Starting Meilisearch indexing from: ${jsonlPath}`);

try {
  const result = await indexCompanies(jsonlPath);
  console.log(`Success! Indexed ${result.indexed} of ${result.total} companies`);
  process.exit(0);
} catch (error) {
  console.error('Indexing failed:', error);
  process.exit(1);
}
```

Add to package.json scripts:
```json
"scripts": {
  "index:meili": "node scripts/index_meilisearch.mjs"
}
```

---

## Phase 5: Search API Integration

### 5.1 Create Search Service

Create `src/lib/meilisearch/search.ts`:

```typescript
import { getCompaniesIndex } from './client';
import type { MeiliSearchParams, MeiliSearchResult, MeiliCompanyDocument } from './types';
import type { BiznesinfoCompanySummary, BiznesinfoSearchResponse, BiznesinfoSuggestResponse } from '../biznesinfo/types';

function documentToSummary(doc: MeiliCompanyDocument): BiznesinfoCompanySummary {
  return {
    id: doc.id,
    source: doc.source,
    name: doc.name,
    address: doc.address,
    city: doc.city,
    region: doc.region,
    work_hours: {
      status: doc.work_hours_status || undefined,
      work_time: doc.work_hours_time || undefined,
    },
    phones_ext: [],  // Not stored in Meili for simplicity
    phones: doc.phones,
    emails: doc.emails,
    websites: doc.websites,
    description: doc.description,
    logo_url: doc.logo_url,
    primary_category_slug: doc.primary_category_slug,
    primary_category_name: doc.primary_category_name,
    primary_rubric_slug: doc.primary_rubric_slug,
    primary_rubric_name: doc.primary_rubric_name,
  };
}

export async function meiliSearch(params: MeiliSearchParams): Promise<BiznesinfoSearchResponse> {
  const index = getCompaniesIndex();

  const filter: string[] = [];

  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }
  if (params.categorySlug) {
    filter.push(`category_slugs = "${params.categorySlug}"`);
  }
  if (params.rubricSlug) {
    filter.push(`rubric_slugs = "${params.rubricSlug}"`);
  }

  const result = await index.search(params.query, {
    offset: params.offset || 0,
    limit: params.limit || 24,
    filter: filter.length > 0 ? filter : undefined,
    attributesToRetrieve: [
      'id', 'source', 'name', 'description', 'address', 'city', 'region',
      'phones', 'emails', 'websites', 'logo_url',
      'primary_category_slug', 'primary_category_name',
      'primary_rubric_slug', 'primary_rubric_name',
      'work_hours_status', 'work_hours_time',
    ],
  });

  return {
    query: params.query,
    total: result.estimatedTotalHits || 0,
    companies: result.hits.map(documentToSummary),
  };
}

export async function meiliSuggest(params: {
  query: string;
  region?: string | null;
  limit?: number;
}): Promise<BiznesinfoSuggestResponse> {
  const index = getCompaniesIndex();

  const filter: string[] = [];
  if (params.region) {
    filter.push(`region = "${params.region}"`);
  }

  const result = await index.search(params.query, {
    limit: params.limit || 8,
    filter: filter.length > 0 ? filter : undefined,
    attributesToRetrieve: [
      'id', 'name', 'address', 'city',
      'primary_category_slug', 'primary_category_name',
    ],
  });

  const suggestions: BiznesinfoSuggestResponse['suggestions'] = result.hits.map(hit => ({
    type: 'company' as const,
    id: hit.id,
    name: hit.name,
    url: `/company/${hit.id}`,
    icon: null,
    subtitle: hit.address || hit.city || '',
  }));

  return {
    query: params.query,
    suggestions,
  };
}
```

### 5.2 Update Search API Route

Modify `src/app/api/biznesinfo/search/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { meiliSearch } from "@/lib/meilisearch/search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const region = searchParams.get("region") || null;
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "24", 10);

  try {
    const data = await meiliSearch({
      query,
      region,
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 24,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Meilisearch error:', error);
    // Fallback to in-memory search if Meilisearch fails
    const { biznesinfoSearch } = await import("@/lib/biznesinfo/store");
    const data = await biznesinfoSearch({
      query,
      region,
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 24,
    });
    return NextResponse.json(data);
  }
}
```

### 5.3 Update Suggest API Route

Modify `src/app/api/biznesinfo/suggest/route.ts` similarly with Meilisearch integration.

---

## Phase 6: Admin/Reindexing API (Optional)

### 6.1 Create Admin Reindex Endpoint

Create `src/app/api/admin/reindex/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { indexCompanies } from "@/lib/meilisearch/indexer";

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-secret';

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jsonlPath = process.env.BIZNESINFO_COMPANIES_JSONL_PATH
    || '/app/public/data/biznesinfo/companies.jsonl';

  try {
    const result = await indexCompanies(jsonlPath);
    return NextResponse.json({
      success: true,
      indexed: result.indexed,
      total: result.total,
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Indexing failed',
      message: String(error),
    }, { status: 500 });
  }
}
```

---

## Phase 7: Deployment Steps

### 7.1 Pre-Deployment Checklist

1. Generate secure master key:
   ```bash
   openssl rand -hex 32
   ```

2. Create `/home/mlweb/biznes.lucheestiy.com/.env`:
   ```
   MEILI_MASTER_KEY=<generated-key>
   ADMIN_SECRET=<another-secure-key>
   ```

### 7.2 Deployment Commands

```bash
cd /home/mlweb/biznes.lucheestiy.com

# Stop current containers
docker compose down

# Rebuild with new config
docker compose up -d --build

# Wait for Meilisearch to start
sleep 10

# Run initial indexing (from inside container)
docker compose exec app npm run index:meili

# Or trigger via API
curl -X POST http://localhost:8102/api/admin/reindex \
  -H "Authorization: Bearer <ADMIN_SECRET>"
```

### 7.3 Verify Deployment

```bash
# Check Meilisearch health
docker compose exec meilisearch curl http://localhost:7700/health

# Check index stats
docker compose exec meilisearch curl http://localhost:7700/indexes/companies/stats \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>"

# Test search
curl "http://localhost:8102/api/biznesinfo/search?q=ремонт"
```

---

## Phase 8: Data Sync Strategy

### 8.1 Automatic Reindexing on Data Update

Option A: **File watcher** - Watch for changes to companies.jsonl and trigger reindex.

Option B: **Cron job** - Run reindexing script daily.

Option C: **Manual trigger** - Use admin API when data is updated.

### 8.2 Recommended: Startup Sync

Add to `docker-compose.yml` app service:

```yaml
app:
  command: sh -c "npm run index:meili && node server.js"
```

Or create `scripts/startup.sh`:
```bash
#!/bin/sh
echo "Starting Meilisearch indexing..."
npm run index:meili || echo "Indexing failed, continuing..."
echo "Starting Next.js server..."
exec node server.js
```

---

## File Changes Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `src/lib/meilisearch/types.ts` | Type definitions |
| `src/lib/meilisearch/client.ts` | Meilisearch client singleton |
| `src/lib/meilisearch/config.ts` | Index configuration |
| `src/lib/meilisearch/indexer.ts` | Indexing logic |
| `src/lib/meilisearch/search.ts` | Search functions |
| `scripts/index_meilisearch.mjs` | CLI indexing script |
| `src/app/api/admin/reindex/route.ts` | Admin reindex endpoint |
| `.env.example` | Environment template |

### Files to Modify

| File | Changes |
|------|---------|
| `docker-compose.yml` | Add meilisearch service, volume, env vars |
| `package.json` | Add meilisearch dependency, index:meili script |
| `src/app/api/biznesinfo/search/route.ts` | Use Meilisearch with fallback |
| `src/app/api/biznesinfo/suggest/route.ts` | Use Meilisearch with fallback |

---

## Benefits After Implementation

1. **Typo Tolerance**: "рмонт" will find "ремонт"
2. **Relevance Ranking**: Best matches first, not just substring matches
3. **Faster Search**: Sub-50ms response times even with 87k+ documents
4. **Filter Combinations**: Region + category + text in single query
5. **Synonyms**: Business abbreviations automatically expanded
6. **Faceted Search Ready**: Can add category/region counts in results
7. **Geo Search Ready**: Can add distance-based search later

---

## Testing Checklist

- [ ] Meilisearch container starts and is healthy
- [ ] Initial indexing completes without errors
- [ ] Search returns relevant results
- [ ] Typo tolerance works (test "рмонт" → "ремонт")
- [ ] Region filtering works
- [ ] Suggest endpoint returns quick results
- [ ] Fallback to in-memory search works when Meili is down
- [ ] Reindexing API works with auth
- [ ] Data persists across container restarts

---

## Rollback Plan

If issues occur:

1. Comment out Meilisearch environment variables in docker-compose.yml
2. Revert API routes to original in-memory search
3. Restart: `docker compose up -d --build`

The fallback in API routes ensures graceful degradation if Meilisearch is unavailable.
