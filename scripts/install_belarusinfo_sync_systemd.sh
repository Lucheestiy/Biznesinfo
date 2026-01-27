#!/usr/bin/env bash
set -euo pipefail

# Installs systemd helpers to keep Biznes updated from Belarusinfo over multi-day runs.
#
# What it does:
# - Creates `import-belarusinfo-into-biznes.service` (oneshot importer).
# - Adds a drop-in for `scrape-belarusinfo.service` so importer runs after each successful scrape run.
# - (Optional) Installs/enables a daily timer to re-run `scrape-belarusinfo.service`.
#
# Usage:
#   sudo /home/mlweb/biznes.lucheestiy.com/app/scripts/install_belarusinfo_sync_systemd.sh --with-daily-timer

WITH_DAILY_TIMER=0
if [[ "${1:-}" == "--with-daily-timer" ]]; then
  WITH_DAILY_TIMER=1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

IMPORTER="/usr/bin/python3 -u /home/mlweb/biznes.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py --in-place"

cat >/etc/systemd/system/import-belarusinfo-into-biznes.service <<EOF
[Unit]
Description=Import Belarusinfo dataset into Biznes JSONL catalog
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

mkdir -p /etc/systemd/system/scrape-belarusinfo.service.d
cat >/etc/systemd/system/scrape-belarusinfo.service.d/10-import-into-biznes.conf <<EOF
[Unit]
OnSuccess=import-belarusinfo-into-biznes.service
EOF

if [[ "${WITH_DAILY_TIMER}" -eq 1 ]]; then
  cat >/etc/systemd/system/scrape-belarusinfo.timer <<'EOF'
[Unit]
Description=Run Belarusinfo scraper daily

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
fi

systemctl daemon-reload
systemctl enable import-belarusinfo-into-biznes.service >/dev/null 2>&1 || true

if [[ "${WITH_DAILY_TIMER}" -eq 1 ]]; then
  systemctl enable --now scrape-belarusinfo.timer
  systemctl list-timers --all --no-pager | grep -F "scrape-belarusinfo.timer" || true
else
  echo "Installed importer + OnSuccess hook. (Timer not installed; pass --with-daily-timer to add it.)"
fi

