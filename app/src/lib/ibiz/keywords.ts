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
  // Production / sales
  "производств", "выпуск", "изготовлен", "продаж", "оптов", "рознич",
  "поставк", "реализац", "торгов", "ассортимент", "продукц",
  // Services / works (common wording in ibiz/belarusinfo descriptions)
  "услуг", "работ", "выполнен", "монтаж", "демонтаж", "ремонт", "строитель",
  "проектир", "обслуживан", "установк", "пусконалад", "наладк",
];

function extractCompanyNameTokens(companyName: string): Set<string> {
  const raw = (companyName || "").trim();
  if (!raw) return new Set();

  const tokens = raw
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(tokens);
}

function normalizeToken(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/ё/gu, "е");
}

function tokenizeText(raw: string): string[] {
  const cleaned = normalizeToken(raw)
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return [];

  const out: string[] = [];
  for (const token of cleaned.split(" ").filter(Boolean)) {
    out.push(token);
    if (token.includes("-")) {
      const parts = token.split("-").filter(Boolean);
      for (const part of parts) out.push(part);
    }
  }
  return out;
}

function shouldKeepToken(token: string, opts: { minLen: number; excludeTokens?: Set<string> }): boolean {
  if (!token) return false;
  if (token.length < opts.minLen) return false;
  if (STOP_WORDS.has(token)) return false;
  if (opts.excludeTokens?.has(token)) return false;
  return true;
}

function addTokens(
  target: Set<string>,
  tokens: string[],
  opts: { minLen: number; excludeTokens?: Set<string>; maxNewTokens?: number },
): void {
  let added = 0;
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (!shouldKeepToken(token, opts)) continue;
    const before = target.size;
    target.add(token);
    if (target.size > before) {
      added += 1;
      if (opts.maxNewTokens && added >= opts.maxNewTokens) return;
    }
  }
}

function extractProductKeywords(text: string, excludeTokens?: Set<string>): string[] {
  if (!text) return [];

  const words: string[] = [];
  const lower = normalizeToken(text);

  const sentences = lower.split(/[.;:!?]/);

  for (const sentence of sentences) {
    const hasIndicator = PRODUCT_INDICATORS.some((ind) => sentence.includes(ind));
    if (!hasIndicator) continue;

    const sentenceWords = tokenizeText(sentence)
      .map((w) => normalizeToken(w))
      .filter((w) => shouldKeepToken(w, { minLen: 3, excludeTokens }));

    words.push(...sentenceWords);
  }

  return words;
}

export function generateCompanyKeywords(company: IbizCompany): string[] {
  const keywordsSet = new Set<string>();
  const companyNameTokens = extractCompanyNameTokens(company.name || "");

  for (const rubric of company.rubrics || []) {
    addTokens(keywordsSet, tokenizeText(rubric.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
  }

  for (const cat of company.categories || []) {
    addTokens(keywordsSet, tokenizeText(cat.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
  }

  // Structured products/services
  for (const item of company.products || []) {
    addTokens(keywordsSet, tokenizeText(item?.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
    addTokens(keywordsSet, tokenizeText(item?.description || ""), {
      minLen: 3,
      excludeTokens: companyNameTokens,
      maxNewTokens: 24,
    });
  }

  for (const item of company.services_list || []) {
    addTokens(keywordsSet, tokenizeText(item?.name || ""), { minLen: 3, excludeTokens: companyNameTokens });
    addTokens(keywordsSet, tokenizeText(item?.description || ""), {
      minLen: 3,
      excludeTokens: companyNameTokens,
      maxNewTokens: 24,
    });
  }

  // Free-text description/about: indicator-based extraction + small general fallback
  addTokens(keywordsSet, extractProductKeywords(company.description || "", companyNameTokens), { minLen: 3 });
  addTokens(keywordsSet, extractProductKeywords(company.about || "", companyNameTokens), { minLen: 3 });

  addTokens(keywordsSet, tokenizeText(company.description || ""), {
    minLen: 3,
    excludeTokens: companyNameTokens,
    maxNewTokens: 48,
  });
  addTokens(keywordsSet, tokenizeText(company.about || ""), {
    minLen: 3,
    excludeTokens: companyNameTokens,
    maxNewTokens: 48,
  });

  return Array.from(keywordsSet);
}
