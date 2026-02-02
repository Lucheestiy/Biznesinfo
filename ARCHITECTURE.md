# biznesinfo.lucheestiy.com - Architecture Documentation

## Overview

Business information portal that provides company data with search functionality. Uses Next.js frontend, Meilisearch for full-text search, and nginx as reverse proxy.

**Website URL:** https://biznesinfo.lucheestiy.com

## Infrastructure Architecture

```
Internet → Droplet (97.107.142.128) → Tailscale VPN → Local Machine (100.93.127.52)
                     (SSL termination)                         (runs all services)
```

### DNS Configuration

- **Domain:** biznesinfo.lucheestiy.com
- **A Record:** Points to droplet `97.107.142.128`
- **SSL:** Managed by Let's Encrypt on the droplet (Certbot)

### Network Flow

1. User visits https://biznesinfo.lucheestiy.com
2. DNS resolves to droplet (97.107.142.128)
3. Droplet nginx handles SSL termination
4. Proxy passes to local machine via Tailscale (100.93.127.52:8116)
5. Local nginx (in docker) forwards to Next.js app (port 3000)

## Droplet Configuration (Reverse Proxy)

**Server:** root@97.107.142.128

**Nginx Config Path:** `/etc/nginx/sites-enabled/biznesinfo.lucheestiy.com`

```nginx
server {
    server_name biznesinfo.lucheestiy.com;
    
    # SSL Configuration (Let's Encrypt)
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/biznesinfo.lucheestiy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/biznesinfo.lucheestiy.com/privkey.pem;
    
    # Proxy to local machine
    location / {
        proxy_pass http://100.93.127.52:8116;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Next.js static assets
    location ^~ /_next/static/ {
        proxy_pass http://100.93.127.52:8116;
        # ... same headers
    }
}
```

### Common Droplet Commands

```bash
# Check nginx config
ssh root@97.107.142.128 "nginx -t"

# Reload nginx
ssh root@97.107.142.128 "nginx -s reload"

# View error logs
ssh root@97.107.142.128 "tail -f /var/log/nginx/biznesinfo.lucheestiy.com.error.log"

# Check SSL certificate status
ssh root@97.107.142.128 "certbot certificates"

# Renew SSL
ssh root@97.107.142.128 "certbot renew"
```

## Local Machine Configuration

**Location:** `/home/mlweb/biznesinfo.lucheestiy.com`

### Docker Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| biznesinfo-nginx | nginx:1.25-alpine | 8116:80 | Reverse proxy for app |
| biznesinfo-app | biznesinfolucheestiycom-app | 3000 (internal) | Next.js application |
| biznesinfo-meilisearch | getmeili/meilisearch:v1.12 | 7700 (internal) | Search engine |

### Docker Network

- Network: `biznesinfolucheestiycom_biznesinfo-network`
- Driver: bridge

### Port Mapping

- **Host:** 8116 → **Container nginx:** 80 → **App:** 3000

## Application Details

### Technology Stack

- **Frontend:** Next.js 15.5.10 with React 19.2.4
- **Styling:** Tailwind CSS 4
- **Search:** Meilisearch v1.12
- **Language:** TypeScript
- **Runtime:** Node.js 20 (Alpine)

### Environment Variables

Located in `.env`:

```bash
HOST_PORT=8116                           # Local port for nginx
MEILI_MASTER_KEY=***                     # Meilisearch authentication
ADMIN_SECRET=***                         # Admin API secret
NODE_ENV=production
IBIZ_COMPANIES_JSONL_PATH=/app/public/data/ibiz/companies.jsonl
MEILI_HOST=http://meilisearch:7700
```

### Data Volumes

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| ./app/public/data/ibiz | /app/public/data/ibiz | IBIZ company data (read-only) |
| ./app/public/companies | /app/public/companies | Additional company data |
| ./app/.cache/ibiz-logo-cache | /tmp/ibiz-logo-cache | Logo image cache |
| biznesinfo-meilisearch-data (volume) | /meili_data | Meilisearch indexed data |

### Build & Run Scripts

**Recommended: Use the safe rebuild script**

The project includes a robust rebuild script that handles all cleanup and rebuild steps:

```bash
# Standard rebuild (preserves data volumes)
./safe_rebuild_biznesinfo.sh

# Rebuild with logo cache clearing
./safe_rebuild_biznesinfo.sh --clear-logo-cache

# Full rebuild including volumes (DELETES ALL DATA - use with caution!)
./safe_rebuild_biznesinfo.sh --volumes

# Rebuild and follow logs
./safe_rebuild_biznesinfo.sh --logs
```

**Script options:**

| Option | Description |
|--------|-------------|
| `--project-dir DIR` | Override project directory |
| `--volumes` | Remove named/anonymous volumes (DATA LOSS!) |
| `--no-system-prune` | Skip automatic `docker system prune -af` (default is to prune unused images/build cache) |
| `--builder-prune` | Prune Docker build cache before building |
| `--clear-logo-cache` | Wipe logo cache directory |
| `--logs` | Follow logs after startup |
| `-h, --help` | Show help |

**Manual Docker commands (if needed):**

```bash
# Build and start containers
cd /home/mlweb/biznesinfo.lucheestiy.com
docker compose up -d --build

# View logs
docker compose logs -f

# Restart containers
docker compose restart

# Stop containers
docker compose down

# Full rebuild (nuke and recreate)
docker compose down -v
docker compose up -d --build
```

### Available npm Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run sync:ibiz    # Sync IBIZ company data
npm run index:meili  # Re-index Meilisearch
```

## Troubleshooting Checklist

### 1. Site Returns 502/503 Bad Gateway

**Check if containers are running:**
```bash
docker ps | grep biznesinfo
```

**If containers are down:**
```bash
cd /home/mlweb/biznesinfo.lucheestiy.com
docker compose up -d
```

### 2. Containers Running but Site Not Working

**Check container health:**
```bash
docker compose ps
docker logs biznesinfo-nginx
docker logs biznesinfo-app
```

**Check if local port is responding:**
```bash
curl -v http://127.0.0.1:8116/
```

**Check Meilisearch health:**
```bash
curl http://127.0.0.1:8116/api/health  # or check meilisearch directly
docker exec biznesinfo-meilisearch curl http://localhost:7700/health
```

### 3. SSL Certificate Issues

**Check SSL status:**
```bash
ssh root@97.107.142.128 "certbot certificates"
```

**Renew SSL:**
```bash
ssh root@97.107.142.128 "certbot renew --dry-run"
ssh root@97.107.142.128 "certbot renew"
```

**Force reload nginx after SSL update:**
```bash
ssh root@97.107.142.128 "nginx -s reload"
```

### 4. Search Not Working

**Check Meilisearch status:**
```bash
docker exec biznesinfo-meilisearch curl -u MASTER_KEY:http://localhost:7700/health
```

**Re-index data:**
```bash
cd /home/mlweb/biznesinfo.lucheestiy.com
npm run index:meili
```

### 5. Next.js Build Issues

**Clear build cache and rebuild:**
```bash
cd /home/mlweb/biznesinfo.lucheestiy.com
rm -rf .next
docker compose down
docker compose up -d --build
```

### 6. DNS/Connectivity Issues

**Verify DNS resolution:**
```bash
dig +short biznesinfo.lucheestiy.com
# Should return: 97.107.142.128
```

**Check Tailscale connection:**
```bash
tailscale status  # On local machine
```

**Test connectivity from droplet:**
```bash
ssh root@97.107.142.128 "curl -v http://100.93.127.52:8116/"
```

## Log Locations

| Location | Purpose |
|----------|---------|
| `/var/log/nginx/biznesinfo.lucheestiy.com.access.log` | Droplet nginx access |
| `/var/log/nginx/biznesinfo.lucheestiy.com.error.log` | Droplet nginx errors |
| `docker logs biznesinfo-nginx` | Local nginx container |
| `docker logs biznesinfo-app` | Next.js application |
| `docker logs biznesinfo-meilisearch` | Meilisearch instance |

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| White screen on load | Stale cache | Clear browser cache or hard refresh (Ctrl+Shift+R) |
| 502 from droplet | Container not running | Start containers with `docker compose up -d` |
| 504 timeout | App unresponsive | Check `docker logs biznesinfo-app` for errors |
| Search returns no results | Meilisearch empty | Run `npm run index:meili` |
| Images not loading | Missing volume mounts | Verify `./app/public/data` exists |
| SSL expired | Certbot didn't renew | Run `certbot renew` on droplet |

## Security Notes

- **Meilisearch MASTER_KEY** is set in `.env` - keep secure
- **ADMIN_SECRET** for admin API routes - keep secure
- All services run in isolated Docker network
- No direct internet access to internal ports (3000, 7700)

## Quick Reference Commands

```bash
# Full status check
docker ps | grep biznesinfo && \
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8116/ && \
ssh root@97.107.142.128 "curl -s -o /dev/null -w '%{http_code}' http://100.93.127.52:8116/"

# Restart everything
cd /home/mlweb/biznesinfo.lucheestiy.com && \
docker compose restart

# View all logs
docker compose logs -f --tail=100
```

---

## Detailed Data Flow Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                 INTERNET USERS                       │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  Droplet (97.107.142.128)                          │
                    │  - SSL Termination (Let's Encrypt)                 │
                    │  - Reverse Proxy (nginx)                           │
                    │  - /etc/nginx/sites-enabled/                       │
                    └─────────────────────┬───────────────────────────────┘
                                          │ HTTPS (443)
                                          │ via Tailscale VPN
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  Local Machine (100.93.127.52)                     │
                    │  /home/mlweb/biznesinfo.lucheestiy.com             │
                    │                                                     │
                    │  ┌─────────────────────────────────────────────┐   │
                    │  │ Docker Network: biznesinfo-network        │   │
                    │  │                                             │   │
                    │  │  ┌─────────────┐    ┌───────────────────┐  │   │
                    │  │  │ nginx:8116  │───▶│ Next.js App       │  │   │
                    │  │  │ (reverse)   │    │ (port 3000)       │  │   │
                    │  │  └─────────────┘    └─────────┬─────────┘  │   │
                    │  │                               │           │   │
                    │  │  ┌─────────────┐              │           │   │
                    │  │  │ Meilisearch │◀─────────────┘           │   │
                    │  │  │ v1.12      │                          │   │
                    │  │  │ (port 7700)│                          │   │
                    │  │  └─────────────┘                          │   │
                    │  └─────────────────────────────────────────────┘   │
                    │                                                     │
                    │  Data Sources:                                     │
                    │  - ./app/public/data/ibiz/companies.jsonl          │
                    │  - ./app/public/companies/                         │
                    └─────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ibiz/search` | GET | Full-text company search |
| `/api/ibiz/suggest` | GET | Company name suggestions |
| `/api/ibiz/catalog` | GET | Catalog with categories/rubrics |
| `/api/ibiz/catalog/suggest` | GET | Category/rubric suggestions |
| `/api/ibiz/rubric` | GET | Companies in a rubric |
| `/api/ibiz/company/[id]` | GET | Single company details |
| `/api/ibiz/companies` | GET | Multiple companies by IDs |
| `/api/ibiz/logo` | GET | Proxy for company logos (cached) |
| `/api/news` | GET | News feed |

### Admin Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/reindex` | POST | Bearer `ADMIN_SECRET` | Trigger Meilisearch reindex |

**Admin reindex example:**
```bash
curl -X POST http://127.0.0.1:8116/api/admin/reindex \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

---

## Data Synchronization

### IBIZ Data Sync

IBIZ data is sourced from the shared location at `Info-ibiz/output/companies.jsonl`.

**Sync script:** `/home/mlweb/biznesinfo.lucheestiy.com/scripts/sync_ibiz_data.mjs`

**Manual sync:**
```bash
cd /home/mlweb/biznesinfo.lucheestiy.com
npm run sync:ibiz
```

**Note:** This script copies data from the parent `Info-ibiz` directory. Changes to `companies.jsonl` are detected automatically by Next.js.

### Belarusinfo Import

Additional company data is imported from Belarusinfo crawler.

**Crawler location:** `/home/mlweb/Info/scrape_belarusinfo.py`
**Systemd timer:** `scrape-belarusinfo.timer` (runs daily at 03:15)

**Importer:** `/home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py`

**Import command:**
```bash
python3 /home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py --in-place --backup
```

### Meilisearch Indexing

After data updates, Meilisearch must be reindexed.

**Reindex via API (recommended):**
```bash
curl -X POST http://127.0.0.1:8116/api/admin/reindex \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

**Reindex via npm script:**
```bash
cd /home/mlweb/biznesinfo.lucheestiy.com
npm run index:meili
```

**Manual indexer script:**
```bash
npx tsx scripts/index_meilisearch.ts
```

---

## Known Issues & Limitations

| Issue | Status | Workaround |
|-------|--------|------------|
| Daily IBIZ sync fails with permission error | **Open** | Sync runs via systemd timer, manual sync may fail due to volume permissions |
| Logo cache may grow large | Monitor | Clean `./app/.cache/ibiz-logo-cache` periodically |
| Meilisearch may have stale data after JSONL update | Auto-detect | API auto-reloads when file mtime changes, or trigger reindex |

### Resolving Sync Permission Errors

If `npm run sync:ibiz` fails with `EACCES: permission denied`:

```bash
# Check source file
ls -la /home/mlweb/Info-ibiz/output/companies.jsonl

# Manually copy with sudo (if needed)
sudo cp /home/mlweb/Info-ibiz/output/companies.jsonl \
  /home/mlweb/biznesinfo.lucheestiy.com/app/public/data/ibiz/companies.jsonl

# Then trigger reindex
curl -X POST http://127.0.0.1:8116/api/admin/reindex \
  -H "Authorization: Bearer $(cat .env | grep ADMIN_SECRET | cut -d= -f2)"
```

---

## Systemd Timers (Local Machine)

```bash
# View all timers
systemctl list-timers --all

# Check specific timer
systemctl status scrape-belarusinfo.timer

# Manual trigger
systemctl start scrape-belarusinfo.service
```

---

## Comparison with Working Reference (biznes.lucheestiy.com)

| Aspect | biznesinfo (this site) | biznes.lucheestiy.com (reference) |
|--------|------------------------|-----------------------------------|
| Local Port | 8116 | 8115 |
| Container Names | biznesinfo-\* | biznes-\* |
| Network | biznesinfo-network | biznes-network |
| Next.js Port | 3000 | 3000 |
| Meilisearch Port | 7700 | 7700 |
| Droplet Proxy | 100.93.127.52:8116 | 100.93.127.52:8115 |

**Reference working config:**
```bash
# On local machine
docker ps | grep biznes-nginx
# Should show: 0.0.0.0:8115->80/tcp

# On droplet
ssh root@97.107.142.128 "cat /etc/nginx/sites-enabled/biznes.lucheestiy.com"
```
