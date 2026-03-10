CREATE TABLE IF NOT EXISTS "companies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "normalized_name" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "city" TEXT NOT NULL DEFAULT '',
  "postal_code" TEXT NOT NULL DEFAULT '',
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "logo_url" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "services" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "services_company_id_fkey"
    FOREIGN KEY ("company_id")
    REFERENCES "companies"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "companies_region_idx"
  ON "companies"("region");

CREATE INDEX IF NOT EXISTS "companies_city_idx"
  ON "companies"("city");

CREATE INDEX IF NOT EXISTS "companies_normalized_name_idx"
  ON "companies"("normalized_name");

CREATE INDEX IF NOT EXISTS "companies_status_idx"
  ON "companies"("status");

CREATE INDEX IF NOT EXISTS "services_company_id_idx"
  ON "services"("company_id");

CREATE INDEX IF NOT EXISTS "services_title_idx"
  ON "services"("title");
