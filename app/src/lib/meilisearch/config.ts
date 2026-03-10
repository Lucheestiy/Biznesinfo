import { getMeiliClient, COMPANIES_INDEX } from "./client";
import type { MeiliCompanyDocument } from "./types";
import { buildSemanticSynonymsForMeili } from "@/lib/search/semantic";

function mergeSynonymMaps(...maps: Array<Record<string, string[]>>): Record<string, string[]> {
  const merged = new Map<string, Set<string>>();

  const normalize = (value: string): string =>
    (value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/gu, "е");

  for (const map of maps) {
    for (const [rawKey, rawValues] of Object.entries(map || {})) {
      const key = normalize(rawKey);
      if (!key) continue;

      let bucket = merged.get(key);
      if (!bucket) {
        bucket = new Set<string>();
        merged.set(key, bucket);
      }

      for (const rawValue of rawValues || []) {
        const value = normalize(rawValue);
        if (!value || value === key) continue;
        bucket.add(value);
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const [key, values] of merged.entries()) {
    if (values.size === 0) continue;
    out[key] = Array.from(values);
  }
  return out;
}

export async function configureCompaniesIndex(): Promise<void> {
  const client = getMeiliClient();

  // Create or get index
  try {
    await client.createIndex(COMPANIES_INDEX, { primaryKey: "id" });
  } catch {
    // Index may already exist
  }

  const index = client.index<MeiliCompanyDocument>(COMPANIES_INDEX);

  // Configure searchable attributes (order = priority).
  // Required by TЗ-3: name, description, servicesText, categoryNames, region, city.
  await index.updateSearchableAttributes([
    "name",
    "normalizedName",
    // Stage 4 ranking: business fields are strongest.
    "serviceTitles",
    "serviceCategories",
    "serviceTokens",
    "servicesText",
    "keywords",
    "categoryNames",
    "category_names",
    "rubric_names",
    "categoryTokens",
    "domainTags",
    // Supportive relevance fields.
    "nameTokens",
    "region",
    "city",
    // Lowest-priority broad text to reduce noisy matches.
    "description",
    "about",
    "address",
  ]);

  // Required filterable attributes by TЗ-3: region, city, status.
  await index.updateFilterableAttributes([
    "region",
    "city",
    "status",
    "domainTags",
    "serviceCategories",
    "categoryNames",
    "data_quality_tier",
    // Geo support.
    "_geo",
    // Legacy compatibility filters.
    "city_norm",
    "category_slugs",
    "rubric_slugs",
    "source",
  ]);

  // Required sortable attributes by TЗ-3: logo_rank, createdAt.
  await index.updateSortableAttributes([
    "data_quality_score",
    "logo_rank",
    "createdAt",
    "updatedAt",
    "_geo",
    // Legacy compatibility sort.
    "name",
  ]);

  // Configure geo-search settings
  await index.updateSearchCutoffMs(100);
  console.log("Geo-search enabled with _geo filter");

  // Configure ranking rules
  await index.updateRankingRules([
    "words",
    "typo",
    "proximity",
    "attribute",
    "exactness",
    "sort",
    "data_quality_score:desc",
    "updatedAt:desc",
    "createdAt:desc",
    "logo_rank:desc",
  ]);

  // Configure typo tolerance
  await index.updateTypoTolerance({
    enabled: true,
    // Make company name search stricter (typos in name can lead to irrelevant matches)
    disableOnAttributes: ["name"],
    minWordSizeForTypos: {
      oneTypo: 4,
      twoTypos: 8,
    },
  });

  // Configure synonyms (Russian business terms + shared semantic clusters).
  const manualSynonyms = {
    "ооо": ["общество с ограниченной ответственностью", "llc"],
    "оао": ["открытое акционерное общество"],
    "зао": ["закрытое акционерное общество"],
    "чуп": ["частное унитарное предприятие"],
    "ип": ["индивидуальный предприниматель"],
    "уп": ["унитарное предприятие"],
    "ремонт": ["починка", "восстановление"],
    "строительство": ["стройка", "строить"],
    // Product synonyms (word forms)
    "молоко": ["молочная", "молочные", "молочный", "молочное", "молока", "молоком"],
    "мясо": ["мясная", "мясные", "мясной", "мясное", "мяса", "мясом"],
    "хлеб": ["хлебная", "хлебные", "хлебный", "хлебобулочные", "хлебопекарня", "хлеба"],
    "рыба": ["рыбная", "рыбные", "рыбный", "рыболовство", "рыбы", "рыбой"],
    "овощи": ["овощная", "овощные", "овощной", "овощей"],
    "фрукты": ["фруктовая", "фруктовые", "фруктовый", "фруктов"],
    "одежда": ["одежная", "швейная", "швейные", "текстиль", "одежды"],
    "мебель": ["мебельная", "мебельные", "мебельный", "мебели"],
    "авто": ["автомобильная", "автомобильные", "автомобильный", "автосервис"],
    "компьютер": ["компьютерная", "компьютерные", "компьютерный", "it"],
    // Cheese synonyms (all forms)
    "сыр": ["сыры", "сыра", "сыру", "сыром", "сыре", "сыров", "сырам", "сырами", "сырах", "сырный", "сыродел", "сыродельный"],
    "сыра": ["сыр", "сыры", "сыров", "сырный"],
    "сыры": ["сыр", "сыра", "сыров", "сырный"],
  };
  const semanticSynonyms = buildSemanticSynonymsForMeili();
  await index.updateSynonyms(mergeSynonymMaps(manualSynonyms, semanticSynonyms));

  console.log("Meilisearch companies index configured");
}
