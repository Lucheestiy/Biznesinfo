import { meiliSearch } from "@/lib/meilisearch/search";

export interface RequestIntent {
  originalText: string;
  keywords: string[];
  category?: string;
  serviceType?: string;
  urgency?: "low" | "medium" | "high";
  location?: string;
  budget?: string;
}

export interface MatchedCompany {
  id: string;
  name: string;
  relevanceScore: number;
  matchReason: string;
  contactInfo: {
    phones: string[];
    emails: string[];
    website?: string;
  };
}

/**
 * Анализирует текст запроса пользователя с помощью AI
 * Извлекает ключевые слова, категорию, срочность
 */
export async function analyzeRequestIntent(message: string): Promise<RequestIntent> {
  const lowerMessage = message.toLowerCase();
  
  // Извлекаем ключевые слова
  const keywords = extractKeywords(message);
  
  // Определяем категорию
  const category = detectCategory(lowerMessage);
  
  // Определяем тип услуги
  const serviceType = detectServiceType(lowerMessage);
  
  // Определяем срочность
  const urgency = detectUrgency(lowerMessage);
  
  // Извлекаем локацию
  const location = extractLocation(lowerMessage);
  
  return {
    originalText: message,
    keywords,
    category,
    serviceType,
    urgency,
    location,
  };
}

/**
 * Ищет подходящие компании на основе анализа запроса
 */
export async function findMatchingCompanies(
  intent: RequestIntent,
  options: {
    targetCompanyId?: string;
    limit?: number;
    region?: string;
  }
): Promise<MatchedCompany[]> {
  const { targetCompanyId, limit = 10, region } = options;
  
  // Если указана конкретная компания — возвращаем только её
  if (targetCompanyId) {
    const company = await getCompanyById(targetCompanyId);
    if (company) {
      return [{
        id: company.id,
        name: company.name,
        relevanceScore: 100,
        matchReason: "Прямой запрос к компании",
        contactInfo: {
          phones: company.phones || [],
          emails: company.emails || [],
          website: company.websites?.[0],
        },
      }];
    }
  }
  
  // Формируем поисковый запрос
  const searchQuery = intent.keywords.join(" ");
  
  // Определяем категорию для фильтрации
  const categoryFilter = intent.category || undefined;
  
  // Ищем через Meilisearch
  const searchResults = await meiliSearch({
    query: "",  // Название компании не важно
    service: searchQuery,  // Ищем по услугам/keywords
    region: region || intent.location || null,
    category: categoryFilter,  // Фильтруем по категории если определена
    limit: limit * 3,  // Берём с запасом для фильтрации
  });
  
  // Сортируем по релевантности и форматируем результат
  const matched = (searchResults.companies || [])
    .map(company => ({
      id: company.id,
      name: company.name,
      relevanceScore: calculateRelevanceScore(company, intent),
      matchReason: generateMatchReason(company, intent),
      contactInfo: {
        phones: company.phones || [],
        emails: company.emails || [],
        website: company.websites?.[0],
      },
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
  
  return matched;
}

// ===== Вспомогательные функции =====

function extractKeywords(message: string): string[] {
  // Убираем стоп-слова и извлекаем ключевые термины
  const stopWords = new Set([
    "нужен", "нужна", "нужно", "ищу", "ищем", "хочу", "хотим",
    "пожалуйста", "спасибо", "здравствуйте", "добрый", "день",
    "можно", "будет", "очень", "какой", "какая", "какие",
    "купить", "приобрести", "заказать", "нужно", "надо",
  ]);
  
  const words = message
    .toLowerCase()
    .replace(/[^\w\sа-яё0-9-]/gi, " ")  // Сохраняем цифры!
    .split(/\s+/)
    .filter(w => (w.length > 2 || /^\d+$/.test(w)) && !stopWords.has(w));  // Числа тоже важны!
  
  // Добавляем словосочетания (биграммы) для лучшего matching'а
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  
  // Удаляем дубликаты
  return [...new Set([...words, ...bigrams])];
}

function detectCategory(message: string): string | undefined {
  const categories: Record<string, string[]> = {
    "молочная": ["молоко", "молочные", "творог", "сметана", "сыр", "кефир", "йогурт", "ряженка", "простокваша", "масло сливочное"],
    "мясная": ["мясо", "колбаса", "свинина", "говядина", "курица", "мясные"],
    "ремонт": ["ремонт", "строительство", "отделка", "штукатур", "маляр"],
    "транспорт": ["грузоперевозки", "доставка", "такси", "перевозка"],
    "продовольствие": ["продукты", "хлеб", "канцтовары"],
    "it": ["сайт", "программирование", "разработка", "приложение"],
    "медицина": ["врач", "клиника", "анализ", "лечение"],
    "образование": ["курсы", "обучение", "репетитор", "тренинг"],
    "юридические": ["юрист", "адвокат", "договор", "консультация"],
  };
  
  // Проверяем в порядке приоритета (молочная и мясная - первые)
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(k => message.includes(k))) {
      return category;
    }
  }
  
  return undefined;
}

function detectServiceType(message: string): string | undefined {
  if (message.includes("купить") || message.includes("приобрести")) {
    return "purchase";
  }
  if (message.includes("заказать") || message.includes("услуга")) {
    return "service";
  }
  if (message.includes("ремонт") || message.includes("починить")) {
    return "repair";
  }
  if (message.includes("доставка") || message.includes("привезти")) {
    return "delivery";
  }
  return undefined;
}

function detectUrgency(message: string): "low" | "medium" | "high" {
  const urgentWords = ["срочно", "быстро", "сегодня", "немедленно", "asap", "авария"];
  const mediumWords = ["завтра", "неделя", "скоро"];
  
  if (urgentWords.some(w => message.includes(w))) return "high";
  if (mediumWords.some(w => message.includes(w))) return "medium";
  return "low";
}

function extractLocation(message: string): string | undefined {
  const cities = ["минск", "брест", "витебск", "гомель", "гродно", "могилев"];
  
  for (const city of cities) {
    if (message.includes(city)) {
      return city;
    }
  }
  
  return undefined;
}

function calculateRelevanceScore(company: any, intent: RequestIntent): number {
  let score = 50;  // Базовый балл
  
  const companyCategory = (company.primary_category_name || "").toLowerCase();
  const companyText = [
    company.name,
    company.description,
    company.primary_category_name,
    company.primary_rubric_name,
  ].join(" ").toLowerCase();
  
  // Критически важно: проверяем категорию
  if (intent.category) {
    const categoryMatch = companyCategory.includes(intent.category) ||
                         companyCategory.includes(getCategorySynonym(intent.category));
    
    if (categoryMatch) {
      score += 40;  // Большой бонус за правильную категорию
    } else {
      // Штраф за явно неправильную категорию
      const wrongCategories: Record<string, string[]> = {
        "молочная": ["сельхозмашин", "трактор", "комбайн", "оборудование"],
        "мясная": ["канцтовар", "бумага", "ручки"],
      };
      
      const wrongForCategory = wrongCategories[intent.category] || [];
      if (wrongForCategory.some(w => companyCategory.includes(w) || companyText.includes(w))) {
        score -= 30;  // Штраф за нерелевантную категорию
      }
    }
  }
  
  // +25 за каждое совпадающее ключевое слово (было 20)
  let keywordMatches = 0;
  for (const keyword of intent.keywords) {
    if (companyText.includes(keyword.toLowerCase())) {
      score += 25;
      keywordMatches++;
    }
  }
  
  // Бонус за множественные совпадения keywords
  if (keywordMatches >= 2) score += 10;
  if (keywordMatches >= 3) score += 15;
  
  // +10 если есть логотип (более заполненный профиль)
  if (company.logo_url) {
    score += 10;
  }
  
  return Math.min(Math.max(score, 0), 100);  // 0-100 с защитой от отрицательных
}

function getCategorySynonym(category: string): string {
  const synonyms: Record<string, string> = {
    "молочная": "молок",
    "мясная": "мяс",
    "ремонт": "строитель",
  };
  return synonyms[category] || category;
}

function generateMatchReason(company: any, intent: RequestIntent): string {
  const reasons: string[] = [];
  
  if (company.primary_category_name) {
    reasons.push(`Категория: ${company.primary_category_name}`);
  }
  
  const matchedKeywords = intent.keywords.filter(k => 
    company.name?.toLowerCase().includes(k) ||
    company.description?.toLowerCase().includes(k)
  );
  
  if (matchedKeywords.length > 0) {
    reasons.push(`Совпадения: ${matchedKeywords.join(", ")}`);
  }
  
  return reasons.join(" • ") || "Подходящий подрядчик";
}

async function getCompanyById(id: string) {
  // Заглушка — нужно реализовать реальное получение из БД
  return {
    id,
    name: "Компания",
    phones: [],
    emails: [],
    websites: [],
  };
}
