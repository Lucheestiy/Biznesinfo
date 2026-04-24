#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNLOCK_TOKEN="${1:-}"
REQUIRED_TOKEN="REMOVE_BIZNESINFO_PASSWORD_NOW"
LOCK_FILE="${ROOT_DIR}/.biznesinfo-password.lock"
REPO_NGINX_CONF="${ROOT_DIR}/nginx/conf.d/default.conf"
REPO_HTPASSWD="${ROOT_DIR}/nginx/conf.d/.htpasswd"
REPO_LOGIN_PAGE="${ROOT_DIR}/nginx/conf.d/portal-login.html"
REPO_AUTH_OK="${ROOT_DIR}/nginx/conf.d/portal-auth-ok.json"
HOST_SITE_CONF="/etc/nginx/sites-available/biznesinfo.lucheestiy.com"
HOST_SITE_LINK="/etc/nginx/sites-enabled/biznesinfo.lucheestiy.com"
UNLOCKED_REPO_TEMPLATE="${ROOT_DIR}/ops/auth-lock/internal-default.conf.unlocked"
UNLOCKED_HOST_TEMPLATE="${ROOT_DIR}/ops/auth-lock/host-biznesinfo-site.unlocked.conf"
NGINX_BIN="${NGINX_BIN:-$(command -v nginx || echo /usr/sbin/nginx)}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[biznesinfo-auth-unlock] root privileges are required" >&2
  exit 1
fi

if [[ "$UNLOCK_TOKEN" != "$REQUIRED_TOKEN" ]]; then
  echo "[biznesinfo-auth-unlock] unlock denied: exact token is required" >&2
  exit 1
fi

if command -v chattr >/dev/null 2>&1; then
  chattr -i "$LOCK_FILE" "$REPO_NGINX_CONF" "$HOST_SITE_CONF" "$REPO_HTPASSWD" "$REPO_LOGIN_PAGE" "$REPO_AUTH_OK" 2>/dev/null || true
fi

install -m 0644 "$UNLOCKED_REPO_TEMPLATE" "$REPO_NGINX_CONF"
install -m 0600 "$UNLOCKED_HOST_TEMPLATE" "$HOST_SITE_CONF"
ln -sfn "$HOST_SITE_CONF" "$HOST_SITE_LINK"
rm -f "$LOCK_FILE"

systemctl disable --now biznesinfo-auth-guard.path biznesinfo-auth-guard.timer >/dev/null 2>&1 || true
systemctl stop biznesinfo-auth-guard.service >/dev/null 2>&1 || true

"$NGINX_BIN" -t >/dev/null
systemctl reload nginx
docker compose exec -T nginx nginx -t >/dev/null
docker compose exec -T nginx nginx -s reload >/dev/null

internal_status="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8116/)"
if [[ "$internal_status" != "200" ]]; then
  echo "[biznesinfo-auth-unlock] expected HTTP 200 from docker nginx, got ${internal_status}" >&2
  exit 1
fi

host_status="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: biznesinfo.lucheestiy.com' http://127.0.0.1/)"
if [[ "$host_status" != "200" ]]; then
  echo "[biznesinfo-auth-unlock] expected HTTP 200 from host nginx, got ${host_status}" >&2
  exit 1
fi

echo "[biznesinfo-auth-unlock] password lock removed"
