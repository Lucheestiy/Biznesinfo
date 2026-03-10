#!/bin/sh
set -eu

PRISMA_PACKAGE="prisma@6.16.3"
PRISMA_SCHEMA="prisma/schema.prisma"
BASELINE_MIGRATION_ID="20260217_03_companies_services_baseline"

run_prisma() {
  npx "$PRISMA_PACKAGE" "$@" --schema "$PRISMA_SCHEMA"
}

if output="$(run_prisma migrate deploy 2>&1)"; then
  echo "$output"
  exit 0
fi

echo "$output"

if ! echo "$output" | grep -q "P3005"; then
  exit 1
fi

echo "Detected non-empty schema (P3005), applying baseline marker..."

if resolve_output="$(run_prisma migrate resolve --applied "$BASELINE_MIGRATION_ID" 2>&1)"; then
  echo "$resolve_output"
else
  echo "$resolve_output"
  if ! echo "$resolve_output" | grep -q "P3008"; then
    exit 1
  fi
fi

run_prisma migrate deploy
