#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_ROUTE_PATH="app/src/app/api/ai/request/route.ts"
APP_ROUTE_REL_FOR_LINT="src/app/api/ai/request/route.ts"

if [[ ! -f "$APP_ROUTE_PATH" ]]; then
  echo "[predeploy-assistant] Ошибка: не найден основной route.ts по пути $APP_ROUTE_PATH" >&2
  exit 1
fi
echo "[predeploy-assistant] 1/5 Проверен основной route.ts (app/src)"

echo "[predeploy-assistant] 2/5 Тесты ассистента"
npm --prefix app run test:assistant

echo "[predeploy-assistant] 3/5 Линт критичных файлов ассистента"
npm --prefix app run lint -- "$APP_ROUTE_REL_FOR_LINT" tests/assistant-regressions.test.ts

echo "[predeploy-assistant] 4/5 Сборка и перезапуск app/nginx"
docker compose build app
docker compose up -d app nginx

echo "[predeploy-assistant] Smoke-check /assistant"
status_code=""
for attempt in {1..15}; do
  status_code="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8116/assistant || true)"
  if [[ "$status_code" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "$status_code" != "200" ]]; then
  echo "[predeploy-assistant] Ошибка: /assistant не прогрелся, последний HTTP ${status_code}" >&2
  exit 1
fi

echo "[predeploy-assistant] 5/5 Quality gate поиска (golden set + метрики)"
npm --prefix app run verify:search-quality

echo "[predeploy-assistant] Готово: /assistant вернул HTTP 200"
