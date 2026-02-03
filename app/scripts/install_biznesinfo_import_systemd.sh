#!/usr/bin/env bash
set -euo pipefail

# Installs systemd helpers to keep Biznesinfo updated from a local SQLite dataset over multi-day runs.
#
# What it does:
# - Creates `import-info-db-into-biznesinfo.service` (oneshot importer).
# - Adds a drop-in for `scrape-info-db.service` so importer runs after each successful scrape run.
# - (Optional) Installs/enables a daily timer to re-run `scrape-info-db.service`.
#
# Usage:
#   sudo /home/mlweb/biznesinfo.lucheestiy.com/app/scripts/install_biznesinfo_import_systemd.sh --with-daily-timer

WITH_DAILY_TIMER=0
if [[ "${1:-}" == "--with-daily-timer" ]]; then
  WITH_DAILY_TIMER=1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

IMPORTER="/usr/bin/python3 -u /home/mlweb/biznesinfo.lucheestiy.com/app/scripts/import_info_db_into_biznesinfo.py --in-place"

cat >/etc/systemd/system/import-info-db-into-biznesinfo.service <<EOF
[Unit]
Description=Import SQLite dataset into Biznesinfo JSONL catalog
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/home/mlweb
ExecStart=${IMPORTER}
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=0
EOF

mkdir -p /etc/systemd/system/scrape-info-db.service.d
cat >/etc/systemd/system/scrape-info-db.service.d/10-import-into-biznesinfo.conf <<EOF
[Unit]
OnSuccess=import-info-db-into-biznesinfo.service
EOF

if [[ "${WITH_DAILY_TIMER}" -eq 1 ]]; then
  cat >/etc/systemd/system/scrape-info-db.timer <<'EOF'
[Unit]
Description=Run SQLite scraper daily

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
fi

systemctl daemon-reload
systemctl enable import-info-db-into-biznesinfo.service >/dev/null 2>&1 || true

if [[ "${WITH_DAILY_TIMER}" -eq 1 ]]; then
  systemctl enable --now scrape-info-db.timer
  systemctl list-timers --all --no-pager | grep -F "scrape-info-db.timer" || true
else
  echo "Installed importer + OnSuccess hook. (Timer not installed; pass --with-daily-timer to add it.)"
fi
