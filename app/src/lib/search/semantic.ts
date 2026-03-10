type SemanticRule = {
  canonical: string;
  exact: string[];
  prefixes: string[];
};

const SEMANTIC_RULES: SemanticRule[] = [
  {
    canonical: "ресторан",
    exact: [
      "кафе",
      "кафешка",
      "кафешки",
      "бар",
      "бары",
      "паб",
      "бистро",
      "фудкорт",
      "общепит",
      "еда",
      "поесть",
      "покушать",
      "пожевать",
      "перекус",
      "перекусить",
      "пообедать",
      "поужинать",
      "restaurant",
      "cafe",
      "food",
    ],
    prefixes: ["ресторан", "кафеш", "кофейн", "пиццер", "бургер", "суши", "покуш", "поест", "перекус", "пообед", "поужин", "пожев"],
  },
  {
    canonical: "гостиница",
    exact: ["отель", "хостел", "ночлег", "проживание", "апартаменты", "hotel", "hostel"],
    prefixes: ["гостиниц", "отел", "хостел", "ночлег", "переноч", "прожив", "апартамент", "апарт"],
  },
  {
    canonical: "автосервис",
    exact: ["автосервис", "сто", "стоа", "шиномонтаж", "вулканизация", "carservice", "autoservice"],
    prefixes: ["автосервис", "шиномонтаж", "вулканизац", "балансировк", "автомастер", "авторемонт"],
  },
  {
    canonical: "парикмахерская",
    exact: ["парикмахер", "парикмахерская", "барбершоп", "стрижка", "barbershop", "haircut"],
    prefixes: ["парикмах", "барбершоп", "стрижк", "окрашиван", "колорир"],
  },
  {
    canonical: "ветклиника",
    exact: ["ветклиника", "ветеринар", "ветврач", "vet", "veterinary"],
    prefixes: ["ветклин", "ветеринар", "ветврач", "ветиринар", "витеринар"],
  },
  {
    canonical: "молочная",
    exact: ["молоко", "молочка", "молочная", "молочные", "dairy"],
    prefixes: ["молок", "молоч"],
  },
  {
    canonical: "сыр",
    exact: ["сыр", "сыры", "сыра", "cheese"],
    prefixes: ["сыр"],
  },
  {
    canonical: "рыба",
    exact: ["рыба", "рыбка", "морепродукты", "морепродукт", "fish", "seafood"],
    prefixes: ["рыб", "морепродукт"],
  },
  {
    canonical: "хлеб",
    exact: ["хлеб", "батон", "булка", "буханка", "bread"],
    prefixes: ["хлеб", "батон", "булк", "буханк", "пекар"],
  },
  {
    canonical: "доставка",
    exact: ["доставка", "доставить", "привезти", "delivery"],
    prefixes: ["достав", "привез"],
  },
  {
    canonical: "театр",
    exact: ["театр", "спектакль", "филармония", "театр-студия", "theatre"],
    prefixes: ["театр", "спектакл", "филармон"],
  },
  {
    canonical: "кинотеатр",
    exact: ["кино", "кинотеатр", "сеанс", "афиша", "фильм", "cinema", "movie"],
    prefixes: ["кино", "сеанс", "афиш", "фильм"],
  },
  {
    canonical: "автошкола",
    exact: ["автошкола", "вождение", "права", "категория b", "driving school"],
    prefixes: ["автошкол", "вожден", "категори"],
  },
  {
    canonical: "туроператор",
    exact: ["туроператор", "турфирма", "экскурсия", "экскурсионный", "travel agency"],
    prefixes: ["туроперат", "турфир", "экскурс"],
  },
];

function normalizeToken(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е");
}

function uniqueTokens(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const token = normalizeToken(value);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function canonicalizeSemanticTokens(values: string[]): string[] {
  return uniqueTokens(
    (values || [])
      .map((value) => canonicalizeSemanticToken(value))
      .filter((token) => token.length >= 2),
  );
}

const EXACT_CANONICAL_MAP = new Map<string, string>();
const PREFIX_CANONICAL_LIST: Array<{ prefix: string; canonical: string }> = [];
const CANONICAL_CLUSTER_MAP = new Map<string, string[]>();

for (const rule of SEMANTIC_RULES) {
  const canonical = normalizeToken(rule.canonical);
  if (!canonical) continue;
  const cluster = uniqueTokens([canonical, ...(rule.exact || [])]);
  CANONICAL_CLUSTER_MAP.set(canonical, cluster);
  EXACT_CANONICAL_MAP.set(canonical, canonical);
  for (const exact of rule.exact || []) {
    const token = normalizeToken(exact);
    if (!token) continue;
    EXACT_CANONICAL_MAP.set(token, canonical);
  }
  for (const prefixRaw of rule.prefixes || []) {
    const prefix = normalizeToken(prefixRaw);
    if (!prefix || prefix.length < 3) continue;
    PREFIX_CANONICAL_LIST.push({ prefix, canonical });
  }
}

PREFIX_CANONICAL_LIST.sort((a, b) => b.prefix.length - a.prefix.length);

export function canonicalizeSemanticToken(raw: string): string {
  const token = normalizeToken(raw);
  if (!token) return "";

  const exactCanonical = EXACT_CANONICAL_MAP.get(token);
  if (exactCanonical) return exactCanonical;

  for (const item of PREFIX_CANONICAL_LIST) {
    if (token.startsWith(item.prefix)) return item.canonical;
  }

  return token;
}

export function expandSemanticTokens(
  values: string[],
  options?: {
    includeOriginal?: boolean;
    maxPerToken?: number;
  },
): string[] {
  const includeOriginal = options?.includeOriginal !== false;
  const maxPerToken = Math.max(1, Math.min(16, options?.maxPerToken || 8));
  const out: string[] = [];
  const seen = new Set<string>();

  const pushToken = (raw: string) => {
    const token = normalizeToken(raw);
    if (!token || token.length < 2) return;
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  for (const raw of values || []) {
    const original = normalizeToken(raw);
    if (!original) continue;
    const canonical = canonicalizeSemanticToken(original);
    if (includeOriginal) pushToken(original);
    if (canonical) pushToken(canonical);

    const cluster = CANONICAL_CLUSTER_MAP.get(canonical) || [];
    let added = 0;
    for (const token of cluster) {
      if (added >= maxPerToken) break;
      if (token === canonical || token === original) continue;
      const before = out.length;
      pushToken(token);
      if (out.length > before) added += 1;
    }
  }

  return out;
}

export function tokenizeSemanticText(raw: string): string[] {
  const cleaned = normalizeToken(raw)
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function buildSemanticQueryTokens(raw: string): string[] {
  return canonicalizeSemanticTokens(
    tokenizeSemanticText(raw)
      .filter((token) => token.length >= 2),
  );
}

export function normalizeSemanticQueryText(raw: string): string {
  return buildSemanticQueryTokens(raw).join(" ");
}

export function buildSemanticExpansionQuery(
  raw: string,
  options?: {
    maxTokens?: number;
    maxPerToken?: number;
  },
): string {
  const maxTokens = Math.max(1, Math.min(24, options?.maxTokens || 10));
  return expandSemanticTokens(buildSemanticQueryTokens(raw), {
    includeOriginal: true,
    maxPerToken: options?.maxPerToken || 6,
  })
    .slice(0, maxTokens)
    .join(" ");
}

export function semanticTextMatchesAnyToken(text: string, tokens: string[]): boolean {
  const normalizedText = normalizeToken(text)
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ");
  if (!normalizedText.trim()) return false;

  const semanticTokens = canonicalizeSemanticTokens(tokens).filter(Boolean);
  if (semanticTokens.length === 0) return false;

  const textTokens = canonicalizeSemanticTokens(tokenizeSemanticText(normalizedText)).filter(Boolean);
  const textTokenSet = new Set(textTokens);

  return semanticTokens.some((token) => {
    if (normalizedText.includes(token)) return true;
    if (textTokenSet.has(token)) return true;
    return textTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate));
  });
}

export function buildSemanticSynonymsForMeili(): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  for (const cluster of CANONICAL_CLUSTER_MAP.values()) {
    const normalizedCluster = uniqueTokens(cluster).filter((token) => token.length >= 2);
    if (normalizedCluster.length < 2) continue;

    for (const token of normalizedCluster) {
      const variants = normalizedCluster.filter((candidate) => candidate !== token);
      if (variants.length === 0) continue;
      out[token] = variants;
    }
  }

  return out;
}

export function getSemanticCluster(raw: string): string[] {
  const token = normalizeToken(raw);
  if (!token) return [];
  const canonical = canonicalizeSemanticToken(token);
  const cluster = CANONICAL_CLUSTER_MAP.get(canonical) || [];
  if (cluster.length === 0) return canonical ? [canonical] : [];
  if (token === canonical) return cluster;

  const out = [token];
  for (const item of cluster) {
    if (item === token) continue;
    out.push(item);
  }
  return uniqueTokens(out);
}

export function semanticOverlapScore(text: string, tokens: string[]): number {
  const normalizedTokens = canonicalizeSemanticTokens(tokens).filter(Boolean);
  if (normalizedTokens.length === 0) return 0;

  const normalizedTextTokens = canonicalizeSemanticTokens(tokenizeSemanticText(text)).filter(Boolean);
  if (normalizedTextTokens.length === 0) return 0;

  const tokenSet = new Set(normalizedTextTokens);
  let score = 0;

  for (const token of normalizedTokens) {
    if (tokenSet.has(token)) {
      score += 3;
      continue;
    }
    if (normalizedTextTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) {
      score += 2;
      continue;
    }
    const cluster = getSemanticCluster(token);
    if (cluster.some((variant) => tokenSet.has(canonicalizeSemanticToken(variant)))) {
      score += 1;
    }
  }

  return score;
}
