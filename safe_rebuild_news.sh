#!/usr/bin/env bash
set -euo pipefail

SELF="$(basename "${0}")"

usage() {
  cat <<EOF
Rebuild and restart the news Docker Compose stack with a clean, no-cache build.

Usage:
  ${SELF} [--project-dir DIR] [--volumes] [--builder-prune] [--clear-logo-cache] [--logs]

Options:
  --project-dir DIR     Override project directory (defaults to this script's folder)
  --volumes             Also remove named/anonymous volumes (can delete data)
  --builder-prune       Prune Docker build cache after stopping containers
  --clear-logo-cache    Wipe ./app/.cache/ibiz-logo-cache on the host
  --logs                Follow logs after bringing stack up
  -h, --help            Show this help
EOF
}

die() {
  echo "${SELF}: ${*}" >&2
  exit 1
}

PROJECT_DIR=""
WIPE_VOLUMES=0
PRUNE_BUILDER=0
CLEAR_LOGO_CACHE=0
FOLLOW_LOGS=0

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --project-dir)
      [[ $# -ge 2 ]] || die "--project-dir requires a value"
      PROJECT_DIR="${2}"
      shift 2
      ;;
    --volumes)
      WIPE_VOLUMES=1
      shift
      ;;
    --builder-prune)
      PRUNE_BUILDER=1
      shift
      ;;
    --clear-logo-cache)
      CLEAR_LOGO_CACHE=1
      shift
      ;;
    --logs)
      FOLLOW_LOGS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: ${1} (try --help)"
      ;;
  esac
done

if [[ -z "${PROJECT_DIR}" ]]; then
  SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
  PROJECT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
fi

[[ -d "${PROJECT_DIR}" ]] || die "project dir not found: ${PROJECT_DIR}"

COMPOSE_FILE=""
if [[ -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
  COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
elif [[ -f "${PROJECT_DIR}/compose.yml" ]]; then
  COMPOSE_FILE="${PROJECT_DIR}/compose.yml"
else
  die "no docker-compose.yml or compose.yml found in ${PROJECT_DIR}"
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose --project-directory "${PROJECT_DIR}" -f "${COMPOSE_FILE}")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f "${COMPOSE_FILE}")
else
  die "docker compose is not installed"
fi

echo "==> Project: ${PROJECT_DIR}"
echo "==> Compose: ${COMPOSE_FILE}"

if [[ "${CLEAR_LOGO_CACHE}" -eq 1 ]]; then
  CACHE_DIR="${PROJECT_DIR}/app/.cache/ibiz-logo-cache"
  echo "==> Clearing logo cache: ${CACHE_DIR}"
  rm -rf "${CACHE_DIR}"
  install -d -m 0777 "${CACHE_DIR}"
fi

DOWN_ARGS=(down --remove-orphans --rmi local)
if [[ "${WIPE_VOLUMES}" -eq 1 ]]; then
  DOWN_ARGS+=(--volumes)
fi

echo "==> Stopping/removing containers..."
"${COMPOSE[@]}" "${DOWN_ARGS[@]}"

if [[ "${PRUNE_BUILDER}" -eq 1 ]]; then
  echo "==> Pruning Docker build cache..."
  docker builder prune -af
fi

echo "==> Building (no cache, pull base images)..."
"${COMPOSE[@]}" build --no-cache --pull

echo "==> Starting stack (force recreate)..."
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans

echo "==> Status:"
"${COMPOSE[@]}" ps

if [[ "${FOLLOW_LOGS}" -eq 1 ]]; then
  echo "==> Following logs (Ctrl+C to stop)..."
  "${COMPOSE[@]}" logs -f --tail=200
fi

