#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_ROUTE_PATH="app/src/app/api/ai/request/route.ts"
APP_ROUTE_REL_FOR_LINT="src/app/api/ai/request/route.ts"
AUTH_ENFORCER="${ROOT_DIR}/scripts/enforce-biznesinfo-password-lock.sh"

resolve_tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | head -n1 || true
  fi
}

TAILSCALE_BIND_IP="${TAILSCALE_BIND_IP:-$(resolve_tailscale_ip)}"
if [[ -n "$TAILSCALE_BIND_IP" ]]; then
  export TAILSCALE_BIND_IP
  echo "[predeploy-assistant] Tailscale bind IP: ${TAILSCALE_BIND_IP}"
fi

if [[ ! -f "$APP_ROUTE_PATH" ]]; then
  echo "[predeploy-assistant] Ошибка: не найден основной route.ts по пути $APP_ROUTE_PATH" >&2
  exit 1
fi
echo "[predeploy-assistant] 0/7 Проверка password lock"
"$AUTH_ENFORCER"

echo "[predeploy-assistant] 1/7 Проверен основной route.ts (app/src)"

echo "[predeploy-assistant] 2/7 Тесты ассистента"
npm --prefix app run test:assistant

echo "[predeploy-assistant] 3/7 Линт критичных файлов ассистента"
npm --prefix app run lint -- "$APP_ROUTE_REL_FOR_LINT" tests/assistant-regressions.test.ts

echo "[predeploy-assistant] 4/7 Сборка и перезапуск app/nginx"
docker compose build app
docker compose up -d app nginx

echo "[predeploy-assistant] 5/7 Повторная проверка password lock после деплоя"
"$AUTH_ENFORCER"

echo "[predeploy-assistant] Smoke-check /assistant"
status_code=""
for attempt in {1..15}; do
  status_code="$(
    docker compose exec -T nginx sh -lc \
      "wget -q -S -O /dev/null http://app:3000/assistant 2>&1 | awk '/HTTP\\// {print \\$2; exit}'" \
      || true
  )"
  if [[ "$status_code" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "$status_code" != "200" ]]; then
  echo "[predeploy-assistant] Ошибка: /assistant не прогрелся, последний HTTP ${status_code}" >&2
  exit 1
fi

echo "[predeploy-assistant] 6/7 Quality gate поиска (golden set + метрики)"
npm --prefix app run verify:search-quality

echo "[predeploy-assistant] 7/7 Готово: /assistant вернул HTTP 200"
