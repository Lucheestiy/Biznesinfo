#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${ROOT_DIR}/ops/auth-lock/systemd"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[biznesinfo-auth-lock] root privileges are required" >&2
  exit 1
fi

install -m 0644 "${SYSTEMD_DIR}/biznesinfo-auth-guard.service" /etc/systemd/system/biznesinfo-auth-guard.service
install -m 0644 "${SYSTEMD_DIR}/biznesinfo-auth-guard.timer" /etc/systemd/system/biznesinfo-auth-guard.timer
install -m 0644 "${SYSTEMD_DIR}/biznesinfo-auth-guard.path" /etc/systemd/system/biznesinfo-auth-guard.path
systemctl daemon-reload
