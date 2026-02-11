import { NextResponse } from "next/server";
import { biznesinfoGetCatalog } from "@/lib/biznesinfo/store";

export const runtime = "nodejs";

const DESCRIPTOR_STOP_WORDS = new Set([
  "компания",
  "компании",
  "компаний",
  "предприятие",
  "предприятия",
  "предприятий",
  "организация",
  "организации",
  "организаций",
  "фирма",
  "фирмы",
  "фирм",
  "завод",
  "завода",
  "заводы",
  "фабрика",
  "фабрики",
  "фабрик",
  "производство",
  "производства",
  "производитель",
  "производители",
  "продукция",
  "продукции",
  "промышленность",
  "промышленности",
  "отрасль",
  "отрасли",
  "направление",
  "направления",
  "товары",
  "товар",
  "услуги",
  "услуга",
  "работы",
  "работа",
]);

const DESCRIPTOR_PREFIXES = [
  "компан",
  "предприят",
  "организац",
  "фирм",
  "завод",
  "фабрик",
  "производств",
  "производител",
  "продукц",
  "промышленност",
  "отрасл",
  "направлен",
  "деятельност",
  "товар",
  "услуг",
  "работ",
];

function normalizeToken(token: string): string {
  const t = safeLower(token)
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9-]+/giu, "")
    .trim();
  if (!t) return "";
  if (t.startsWith("молок")) return "молочная";
  if (t.startsWith("молочн")) return "молочная";
  return t;
}

function isDescriptorToken(token: string): boolean {
  const t = normalizeToken(token);
  if (!t) return false;
  if (DESCRIPTOR_STOP_WORDS.has(t)) return true;
  return DESCRIPTOR_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function tokenize(raw: string): string[] {
  return safeLower(raw)
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/u)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
}

function normalizeQueryTokens(raw: string): string[] {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return [];
  const core = tokens.filter((token) => !isDescriptorToken(token));
  return core.length > 0 ? core : tokens;
}

function tokenMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function scoreNameMatch(name: string, queryTokens: string[], queryCore: string): number {
  const nameTokens = tokenize(name);
  const nameNorm = nameTokens.join(" ");
  if (!nameNorm) return 0;

  let score = 0;
  if (queryCore && nameNorm.includes(queryCore)) score += 100;

  let matched = 0;
  for (const q of queryTokens) {
    if (nameTokens.some((token) => tokenMatch(token, q))) {
      matched += 1;
      score += 20;
    }
  }

  if (matched === 0) return 0;
  if (queryTokens.length > 1 && matched < Math.ceil(queryTokens.length / 2)) return 0;
  return score;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const region = searchParams.get("region") || null;
  
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ query, suggestions: [] });
  }
  const queryTokens = normalizeQueryTokens(q);
  if (queryTokens.length === 0) {
    return NextResponse.json({ query, suggestions: [] });
  }
  const queryCore = queryTokens.join(" ");

  const catalog = await biznesinfoGetCatalog(region);
  const categories = catalog.categories || [];
  
  const suggestions: Array<{
    type: "category" | "rubric";
    slug: string;
    name: string;
    url: string;
    icon: null;
    category_name?: string;
    count?: number;
    _score: number;
  }> = [];
  
  // Search categories and their nested rubrics
  for (const cat of categories) {
    // Check if category name matches
    const categoryScore = scoreNameMatch(cat.name || "", queryTokens, queryCore);
    if (categoryScore > 0) {
      suggestions.push({
        type: "category",
        slug: cat.slug,
        name: cat.name || cat.slug,
        url: `/catalog/${cat.slug}`,
        icon: null,
        count: cat.company_count,
        _score: categoryScore,
      });
    }
    
    // Check nested rubrics within this category
    const rubrics = cat.rubrics || [];
    for (const rubric of rubrics) {
      const rubricScore = scoreNameMatch(rubric.name || "", queryTokens, queryCore);
      if (rubricScore > 0) {
        suggestions.push({
          type: "rubric",
          slug: rubric.slug,
          name: rubric.name || rubric.slug,
          url: `/catalog/${cat.slug}/${rubric.slug.split("/").slice(1).join("/")}`,
          icon: null,
          category_name: cat.name,
          count: rubric.count,
          _score: rubricScore,
        });
      }
    }
  }

  suggestions.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    const aCount = typeof a.count === "number" ? a.count : 0;
    const bCount = typeof b.count === "number" ? b.count : 0;
    if (bCount !== aCount) return bCount - aCount;
    return (a.name || "").localeCompare(b.name || "", "ru");
  });

  return NextResponse.json({
    query,
    suggestions: suggestions.slice(0, 8).map(({ _score, ...rest }) => rest),
  });
}

function safeLower(s: string): string {
  return (s || "").toLowerCase();
}
