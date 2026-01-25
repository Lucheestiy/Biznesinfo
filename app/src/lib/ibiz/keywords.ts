import type { IbizCompany } from "./types";

const STOP_WORDS = new Set([
  "и", "в", "на", "с", "по", "для", "из", "к", "от", "до", "о", "об", "при",
  "за", "под", "над", "без", "через", "между", "а", "но", "или", "либо",
  "то", "как", "что", "это", "так", "же", "бы", "ли", "не", "ни", "да", "нет",
  "все", "вся", "всё", "его", "её", "их", "ее", "другие", "другое", "прочие", "прочее",
  "оао", "ооо", "зао", "чуп", "уп", "ип", "тел", "факс", "email", "www", "http",
  "беларусь", "республика", "область", "район", "город", "минск", "брест", "гомель",
  "витебск", "гродно", "могилев", "могилёв", "улица", "проспект", "переулок",
  "компания", "предприятие", "организация", "фирма", "завод", "филиал",
  "продукция", "производство", "изготовление", "выпуск", "услуги", "работы", "деятельность",
  "продажа", "оптовая", "розничная", "торговля", "поставка", "реализация",
  "сырье", "сырьё", "вторичное", "материалы", "комплектующие",
]);

const PRODUCT_INDICATORS = [
  "производство", "выпуск", "изготовление", "продажа", "оптовая", "розничная",
  "поставка", "реализация", "торговля", "ассортимент", "продукция",
];

function extractCompanyNameTokens(companyName: string): Set<string> {
  const raw = (companyName || "").trim();
  if (!raw) return new Set();

  const tokens = raw
    .toLowerCase()
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(tokens);
}

function extractProductKeywords(text: string, excludeTokens?: Set<string>): string[] {
  if (!text) return [];

  const words: string[] = [];
  const lower = text.toLowerCase();

  const sentences = lower.split(/[.;:!?]/);

  for (const sentence of sentences) {
    const hasIndicator = PRODUCT_INDICATORS.some((ind) => sentence.includes(ind));
    if (!hasIndicator) continue;

    const sentenceWords = sentence
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !excludeTokens?.has(w));

    words.push(...sentenceWords);
  }

  return words;
}

export function generateCompanyKeywords(company: IbizCompany): string[] {
  const keywordsSet = new Set<string>();
  const companyNameTokens = extractCompanyNameTokens(company.name || "");

  for (const rubric of company.rubrics || []) {
    const words = (rubric.name || "")
      .toLowerCase()
      .replace(/[^\wа-яё\s-]/gi, " ")
      .split(/\s+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    words.forEach((w) => keywordsSet.add(w));
  }

  for (const cat of company.categories || []) {
    const words = (cat.name || "")
      .toLowerCase()
      .replace(/[^\wа-яё\s-]/gi, " ")
      .split(/\s+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    words.forEach((w) => keywordsSet.add(w));
  }

  extractProductKeywords(company.description || "", companyNameTokens).forEach((w) => keywordsSet.add(w));
  extractProductKeywords(company.about || "", companyNameTokens).forEach((w) => keywordsSet.add(w));

  return Array.from(keywordsSet);
}

