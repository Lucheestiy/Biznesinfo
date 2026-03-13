import enNameOverrides from "./catalog-name-overrides.en.json";
import zhNameOverrides from "./catalog-name-overrides.zh.json";

export type CatalogLanguage = "ru" | "en" | "be" | "zh";

type CatalogNameOverrides = {
  categoryBySlug?: Record<string, string>;
  rubricBySlug?: Record<string, string>;
};

const LANGUAGE_OVERRIDES: Partial<Record<CatalogLanguage, CatalogNameOverrides>> = {
  en: enNameOverrides as CatalogNameOverrides,
  zh: zhNameOverrides as CatalogNameOverrides,
};

function localizeBySlug(
  language: CatalogLanguage,
  key: string,
  fallbackName: string,
  kind: keyof CatalogNameOverrides,
): string {
  const overrides = LANGUAGE_OVERRIDES[language];
  if (!overrides) return fallbackName;
  const bySlug = overrides[kind] || {};
  if (!key) return fallbackName;
  return bySlug[key] || fallbackName;
}

export function localizeCatalogCategoryName(
  language: CatalogLanguage,
  categorySlug: string,
  fallbackName: string,
): string {
  const key = String(categorySlug || "").trim();
  return localizeBySlug(language, key, fallbackName, "categoryBySlug");
}

export function localizeCatalogRubricName(
  language: CatalogLanguage,
  rubricSlug: string,
  fallbackName: string,
): string {
  const key = String(rubricSlug || "").trim();
  return localizeBySlug(language, key, fallbackName, "rubricBySlug");
}
