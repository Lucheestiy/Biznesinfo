#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="${ROOT_DIR}/.biznesinfo-password.lock"
REPO_NGINX_CONF="${ROOT_DIR}/nginx/conf.d/default.conf"
REPO_HTPASSWD="${ROOT_DIR}/nginx/conf.d/.htpasswd"
REPO_LOGIN_PAGE="${ROOT_DIR}/nginx/conf.d/portal-login.html"
REPO_AUTH_OK="${ROOT_DIR}/nginx/conf.d/portal-auth-ok.json"
HOST_SITE_CONF="/etc/nginx/sites-available/biznesinfo.lucheestiy.com"
HOST_SITE_LINK="/etc/nginx/sites-enabled/biznesinfo.lucheestiy.com"
LOCKED_REPO_TEMPLATE="${ROOT_DIR}/ops/auth-lock/internal-default.conf.locked"
LOCKED_HOST_TEMPLATE="${ROOT_DIR}/ops/auth-lock/host-biznesinfo-site.locked.conf"
LOCKED_LOGIN_TEMPLATE="${ROOT_DIR}/ops/auth-lock/portal-login.html"
LOCKED_AUTH_OK_TEMPLATE="${ROOT_DIR}/ops/auth-lock/portal-auth-ok.json"
NGINX_BIN="${NGINX_BIN:-$(command -v nginx || echo /usr/sbin/nginx)}"
HOST_PORT="${HOST_PORT:-8116}"

resolve_tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | head -n1 || true
  fi
}

TAILSCALE_BIND_IP="${TAILSCALE_BIND_IP:-$(resolve_tailscale_ip)}"
if [[ -n "$TAILSCALE_BIND_IP" ]]; then
  export TAILSCALE_BIND_IP
fi

log() {
  echo "[biznesinfo-auth-lock] $*"
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "[biznesinfo-auth-lock] root privileges are required" >&2
    exit 1
  fi
}

has_immutable_bit() {
  local target="$1"
  [[ -e "$target" ]] || return 1
  command -v lsattr >/dev/null 2>&1 || return 1
  lsattr -d "$target" 2>/dev/null | awk '{print $1}' | grep -q 'i'
}

make_mutable() {
  local target="$1"
  [[ -e "$target" ]] || return 0
  command -v chattr >/dev/null 2>&1 || return 0
  if has_immutable_bit "$target"; then
    chattr -i "$target"
  fi
}

make_immutable() {
  local target="$1"
  [[ -e "$target" ]] || return 0
  command -v chattr >/dev/null 2>&1 || return 0
  if ! has_immutable_bit "$target"; then
    chattr +i "$target"
  fi
}

sync_file() {
  local src="$1"
  local dst="$2"
  local mode="$3"
  mkdir -p "$(dirname "$dst")"
  if [[ ! -f "$dst" ]] || ! cmp -s "$src" "$dst"; then
    make_mutable "$dst"
    install -m "$mode" "$src" "$dst"
    log "synced $(basename "$dst") from template"
  fi
  make_immutable "$dst"
}

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "[biznesinfo-auth-lock] ${label}: expected HTTP ${expected}, got ${actual}" >&2
    exit 1
  fi
}

reload_host_nginx() {
  "$NGINX_BIN" -t >/dev/null
  systemctl reload nginx
}

reload_container_nginx() {
  if ! docker compose ps --status running nginx >/dev/null 2>&1; then
    docker compose up -d nginx
  fi
  docker compose exec -T nginx nginx -t >/dev/null
  docker compose exec -T nginx nginx -s reload >/dev/null
}

main() {
  if [[ ! -f "$LOCK_FILE" ]]; then
    log "lock file absent; password lock is intentionally disabled"
    exit 0
  fi

  require_root

  if [[ ! -f "$REPO_HTPASSWD" ]]; then
    echo "[biznesinfo-auth-lock] missing htpasswd file: ${REPO_HTPASSWD}" >&2
    exit 1
  fi

  sync_file "$LOCKED_REPO_TEMPLATE" "$REPO_NGINX_CONF" 0644
  sync_file "$LOCKED_HOST_TEMPLATE" "$HOST_SITE_CONF" 0600
  sync_file "$LOCKED_LOGIN_TEMPLATE" "$REPO_LOGIN_PAGE" 0644
  sync_file "$LOCKED_AUTH_OK_TEMPLATE" "$REPO_AUTH_OK" 0644
  ln -sfn "$HOST_SITE_CONF" "$HOST_SITE_LINK"
  make_immutable "$LOCK_FILE"
  make_immutable "$REPO_HTPASSWD"

  reload_host_nginx
  reload_container_nginx

  local internal_status
  internal_status="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/" || true)"
  assert_status "docker nginx" "302" "$internal_status"

  local internal_login_status
  internal_login_status="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/__portal-login" || true)"
  assert_status "docker nginx login page" "200" "$internal_login_status"

  if [[ -n "$TAILSCALE_BIND_IP" ]]; then
    local tailscale_status
    tailscale_status="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://${TAILSCALE_BIND_IP}:${HOST_PORT}/" || true)"
    assert_status "tailscale docker nginx" "302" "$tailscale_status"
  fi

  local host_http_status
  host_http_status="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H 'Host: biznesinfo.lucheestiy.com' http://127.0.0.1/ || true)"
  assert_status "host nginx" "302" "$host_http_status"

  local host_login_status
  host_login_status="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H 'Host: biznesinfo.lucheestiy.com' http://127.0.0.1/__portal-login || true)"
  assert_status "host nginx login page" "200" "$host_login_status"

  log "password lock is enforced"
}

main "$@"
