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

// Слова, которые нужно исключить из ключевых слов (не релевантные для SEO)
const TECHNICAL_WORDS = new Set([
  // Из истории компании
  "строительство", "возведение", "реконструировались", "достраивались", "отделы",
  "корпуса", "модернизировалось", "оборудование", "здание", "цеха", "years", "годы",
  "именно", "тогда", "началось", "сегодня", "завода", "сухого", "обезжиренного",
  "высоких", "требованиях", "качественных", "вкусовых", "показателях", "неоднократно",
  "становилась", "победителем", "различных", "региональных", "республиканских",
  "международных", "конкурсах", "обустроены", "современным", "импортным",
  "последних", "технологиях", "сохранением", "традиционных", "характеристик",
  "обладает", "высокой", "производительностью", "сутки", "производится",
  "тонн", "расширить", "географию", "экспортных", "поставок", "будем",
  "рады", "сотрудничеству", "вами", "история", "предприятия", "филиал",
  "ведёт", "отсчёт", "1973", "длилось", "более", "последующие", "достраивались",
  // Из общих описаний компании
  "успешно", "работает", "наша", "компания", "предлагает", "следующие",
  "оказывает", "предоставляет", "занимается", "осуществляет", "выполняет",
  "имеет", "является", "находится", "расположена", "действует",
  "международная", "транспортная", "опыт", "года", "2010", "более",
  "клиентов", "партнёров", "заказчиков", "людей", "сотрудников",
  "квалифицированных", "профессиональных", "опытных", "индивидуальный",
  "подход", "качественный", "надёжный", "современный", "новейший",
  "полный", "весь", "весьма", "весьма", "разнообразный", "широкий",
]);

// Слова, которые НЕ являются релевантными ключевыми словами (более строгий фильтр)
const BAD_KEYWORDS = new Set([
  "компании", "компания", "организации", "организация", "фирмы", "фирма",
  "предприятия", "предприятие", "завода", "завод", "производства", "производство",
  "услуги", "услуг", "работы", "работ", "деятельности", "деятельность",
  "товары", "товаров", "продукты", "продуктов", "продукции",
  "транспортная", "транспортного", "транспортные", "транспортных",
  "международная", "международного", "международные", "международных",
  "наша", "нашей", "нашем", "наши", "ваших", "ваша", "вашей",
  "успешно", "успешного", "успешные", "успешных",
  "качественный", "качественного", "качественные", "качественных",
  "надёжный", "надёжного", "надёжные", "надёжных",
  "современный", "современного", "современные", "современных",
]);

const PRODUCT_INDICATORS = [
  "производство", "выпуск", "изготовление", "продажа", "оптовая", "розничная",
  "поставка", "реализация", "торговля", "ассортимент", "продукция",
];

// Релевантные ключевые слова для разных категорий
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "молочная": ["молоко оптом", "молочные продукты", "кисломолочные продукты", "молочная продукция", "творог", "сметана", "масло сливочное"],
  "мясная": ["мясо оптом", "мясные продукты", "колбасные изделия", "мясная продукция", "свинина", "говядина"],
  "хлебная": ["хлеб оптом", "хлебобулочные изделия", "выпечка", "булки", "батоны"],
  "пищевая": ["продукты питания", "пищевая продукция", "оптом продукты", "продовольственные товары"],
  "сельскохозяйственная": ["сельхозпродукция", "агропромышленность", "фермерские продукты", "сельхозтехника"],
  "сельское хозяйство": ["сельхозпродукция", "фермерское хозяйство", "агропромышленный комплекс"],
  // Транспорт и логистика
  "транспорт": ["грузоперевозки", "доставка грузов", "транспортные услуги", "экспедирование", "перевозка грузов"],
  "логистика": ["грузоперевозки", "доставка грузов", "транспортная логистика", "грузовое такси", "логистические услуги"],
  "перевозки": ["грузоперевозки", "доставка грузов", "транспортные услуги", "международные перевозки", "экспедирование грузов"],
};

function isBadKeyword(word: string): boolean {
  const lower = word.toLowerCase();
  return BAD_KEYWORDS.has(lower);
}

function extractCompanyNameTokens(companyName: string): Set<string> {
  const raw = (companyName || "").trim();
  if (!raw) return new Set();

  const tokens = raw
    .toLowerCase()
    .replace(/[«»"'""'']/g, " ")
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
      .filter((w) => w.length > 3 && 
        !STOP_WORDS.has(w) && 
        !TECHNICAL_WORDS.has(w) && 
        !isBadKeyword(w) &&
        !excludeTokens?.has(w));

    words.push(...sentenceWords);
  }

  return words;
}

function getCategoryKeywords(categoryName: string, rubricName: string): string[] {
  const lowerCategory = categoryName.toLowerCase();
  const lowerRubric = rubricName.toLowerCase();
  
  // Ищем совпадение в CATEGORY_KEYWORDS
  for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lowerCategory.includes(key) || lowerRubric.includes(key)) {
      return keywords;
    }
  }
  
  return [];
}

export function generateCompanyKeywords(company: IbizCompany): string[] {
  const keywordsSet = new Set<string>();
  const companyNameTokens = extractCompanyNameTokens(company.name || "");
  const city = company.city || "";

  // 1. Сначала добавляем релевантные ключевые слова из категорий/рубрик
  for (const rubric of company.rubrics || []) {
    const categoryName = company.categories?.[0]?.name || "";
    const categoryKeywords = getCategoryKeywords(categoryName, rubric.name);
    if (categoryKeywords.length > 0) {
      categoryKeywords.forEach(k => keywordsSet.add(k));
    } else {
      // Если нет стандартных ключевых слов, берём из названия рубрики (с фильтрацией)
      const words = (rubric.name || "")
        .toLowerCase()
        .replace(/[^\wа-яё\s-]/gi, " ")
        .split(/\s+/u)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !isBadKeyword(w));
      words.forEach((w) => keywordsSet.add(w));
    }
  }

  for (const cat of company.categories || []) {
    const words = (cat.name || "")
      .toLowerCase()
      .replace(/[^\wа-яё\s-]/gi, " ")
      .split(/\s+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !isBadKeyword(w));
    words.forEach((w) => keywordsSet.add(w));
  }

  // 2. Продуктовые слова из description (с фильтрацией)
  extractProductKeywords(company.description || "", companyNameTokens).forEach((w) => keywordsSet.add(w));

  // 3. Добавляем город к ключевым словам (для геопривязки)
  if (keywordsSet.size > 0 && city) {
    const firstKeywords = Array.from(keywordsSet).slice(0, 2);
    firstKeywords.forEach(kw => {
      if (!kw.toLowerCase().includes(city.toLowerCase()) && kw.length > 3) {
        keywordsSet.add(`${kw} ${city}`);
      }
    });
  }

  // 4. Если мало ключевых слов, добавляем общие
  const genericKeywords = ["товары и услуги", "оптом от производителя", "купить в Беларуси", "качественная продукция"];
  while (keywordsSet.size < 5) {
    const generic = genericKeywords[keywordsSet.size];
    if (generic) {
      keywordsSet.add(generic);
    } else {
      break;
    }
  }

  return Array.from(keywordsSet).slice(0, 10);
}
