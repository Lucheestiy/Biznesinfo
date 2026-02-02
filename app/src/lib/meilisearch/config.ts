import { getMeiliClient, COMPANIES_INDEX } from "./client";
import type { MeiliCompanyDocument } from "./types";

export async function configureCompaniesIndex(): Promise<void> {
  const client = getMeiliClient();

  // Create or get index
  try {
    await client.createIndex(COMPANIES_INDEX, { primaryKey: "id" });
  } catch {
    // Index may already exist
  }

  const index = client.index<MeiliCompanyDocument>(COMPANIES_INDEX);

  // Configure searchable attributes (order = priority)
  await index.updateSearchableAttributes([
    "name",
    "keywords",
    "description",
    "about",
    "category_names",
    "rubric_names",
    "address",
    "city",
    "contact_person",
    "phones",
    "emails",
    "websites",
  ]);

  // Configure filterable attributes
  await index.updateFilterableAttributes([
    "region",
    "city_norm",
    "category_slugs",
    "rubric_slugs",
    "primary_category_slug",
    "source",
  ]);

  // Configure sortable attributes
  await index.updateSortableAttributes([
    "name",
  ]);

  // Configure ranking rules
  await index.updateRankingRules([
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
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

  // Configure synonyms (Russian business terms)
  await index.updateSynonyms({
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
  });

  console.log("Meilisearch companies index configured");
}
