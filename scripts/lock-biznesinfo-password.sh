#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="${ROOT_DIR}/.biznesinfo-password.lock"
INSTALLER="${ROOT_DIR}/scripts/install-biznesinfo-auth-guard.sh"
ENFORCER="${ROOT_DIR}/scripts/enforce-biznesinfo-password-lock.sh"
LOCK_TEMPLATE="${ROOT_DIR}/ops/auth-lock/password-lock.state"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[biznesinfo-auth-lock] root privileges are required" >&2
  exit 1
fi

if [[ ! -f "$LOCK_FILE" ]]; then
  install -m 0644 "$LOCK_TEMPLATE" "$LOCK_FILE"
fi

"$INSTALLER"
systemctl daemon-reload
systemctl disable --now biznesinfo-auth-guard.path >/dev/null 2>&1 || true
systemctl enable --now biznesinfo-auth-guard.timer
systemctl reset-failed biznesinfo-auth-guard.service >/dev/null 2>&1 || true
systemctl start biznesinfo-auth-guard.service
"$ENFORCER"
