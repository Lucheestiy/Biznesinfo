import type { BiznesinfoCompany } from "./types";
import { generateCompanyKeywordPhrases, generateCompanyKeywords } from "./keywords";
import { BIZNESINFO_LOGO_OVERRIDES } from "./logoOverrides";

const MIN_DESCRIPTION_LEN = 40;
const MAX_DESCRIPTION_LEN = 180;

const PLACEHOLDER_RE =
  /(в данном разделе пока ничего нет|в данном разделе нет информации|описание отсутствует|нет описания|нет информации)/iu;

function decodeHtmlEntities(raw: string): string {
  const text = raw || "";
  if (!text.includes("&")) return text;

  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#34;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
  };

  let out = text;
  for (const [k, v] of Object.entries(named)) {
    out = out.replaceAll(k, v);
  }

  out = out
    .replace(/&#x([0-9a-f]+);/giu, (_m, hex) => {
      const code = parseInt(String(hex), 16);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/gu, (_m, dec) => {
      const code = parseInt(String(dec), 10);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    });

  return out;
}

function stripHtmlTags(raw: string): string {
  return (raw || "").replace(/<[^>]*>/g, " ");
}

function stripEmoji(raw: string): string {
  return (raw || "").replace(/\p{Extended_Pictographic}/gu, "");
}

function normalizeWhitespace(raw: string): string {
  return (raw || "").replace(/\s+/gu, " ").trim();
}

function cleanupPreviewText(raw: string): string {
  let text = decodeHtmlEntities(raw || "");
  text = stripHtmlTags(text);
  text = stripEmoji(text);

  text = text
    .replace(/[«»]/gu, '"')
    .replace(/\u00ad/gu, "") // soft hyphen
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s*\|\s*/gu, " ")
    .replace(/\s*·\s*/gu, " ")
    .replace(/\s*•\s*/gu, " ")
    .replace(/\s+/gu, " ");

  return normalizeWhitespace(text);
}

function stripCompanyIntro(raw: string): string {
  return (raw || "")
    .replace(/^\s*о\s+компании[:.\-\s]+/iu, "")
    .replace(/^\s*описание[:.\-\s]+/iu, "")
    .trim();
}

function looksLikeJunkDescription(text: string): boolean {
  const t = cleanupPreviewText(text);
  if (!t) return true;
  if (PLACEHOLDER_RE.test(t)) return true;
  if (t.length < MIN_DESCRIPTION_LEN) return true;
  return false;
}

function splitToSentences(text: string): string[] {
  return (
    cleanupPreviewText(text)
      .match(/[^.!?]+[.!?]+|[^.!?]+$/gu)
      ?.map((s) => s.trim())
      .filter(Boolean) || []
  );
}

function sentenceHasLocationOrHistory(sentence: string): boolean {
  const s = (sentence || "").toLowerCase().replace(/ё/gu, "е");
  if (!s) return true;

  // Postal codes, years, phone-like blocks.
  if (/\b2\d{5}\b/gu.test(s)) return true;
  if (/\b(19|20)\d{2}\b/gu.test(s)) return true;
  if (/\+?\d[\d\s().-]{7,}\d/gu.test(s)) return true;

  // Address / geography / contact patterns (avoid for preview).
  const bad = [
    "адрес",
    "ул ",
    "улиц",
    "проспект",
    "пр-т",
    "переул",
    "пер.",
    "дом",
    "офис",
    "факс",
    "тел",
    "наход",
    "располож",
    "город",
    "область",
    "район",
    "республика",
    "беларус",
    "минск",
    "брест",
    "гомел",
    "витеб",
    "гродн",
    "могил",
  ];
  if (bad.some((t) => s.includes(t))) return true;

  // Company history markers.
  const history = ["основан", "основана", "создан", "создана", "история", "сегодня", "на сегодня", "за годы"];
  if (history.some((t) => s.includes(t))) return true;

  return false;
}

function clampDescription(text: string): string {
  const value = normalizeWhitespace(text);
  if (!value) return "";
  if (value.length <= MAX_DESCRIPTION_LEN) return value;

  const slice = value.slice(0, MAX_DESCRIPTION_LEN);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastStop >= Math.floor(MAX_DESCRIPTION_LEN * 0.6)) {
    return slice.slice(0, lastStop + 1).trim();
  }
  const lastComma = slice.lastIndexOf(", ");
  if (lastComma >= Math.floor(MAX_DESCRIPTION_LEN * 0.75)) {
    return slice.slice(0, lastComma).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

function buildFromText(company: BiznesinfoCompany): string {
  const primary = stripCompanyIntro(cleanupPreviewText(company.description || "")) || "";
  const secondary = stripCompanyIntro(cleanupPreviewText(company.about || "")) || "";

  const raw = !looksLikeJunkDescription(primary) ? primary : secondary;
  if (looksLikeJunkDescription(raw)) return "";

  const sentences = splitToSentences(raw);
  const good = sentences.filter((s) => !sentenceHasLocationOrHistory(s));

  const picked: string[] = [];
  for (const s of good) {
    const next = picked.length ? `${picked.join(" ")} ${s}` : s;
    if (next.length > MAX_DESCRIPTION_LEN) break;
    picked.push(s);
    if (picked.length >= 2) break;
  }

  const combined = picked.join(" ").trim();
  if (!combined) return "";
  return clampDescription(combined);
}

function buildFromKeywords(company: BiznesinfoCompany): string {
  const phrases = generateCompanyKeywordPhrases(company, { maxKeywords: 10 });
  const unique: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const v = cleanupPreviewText(raw);
    if (!v) return;
    const key = v.toLowerCase().replace(/ё/gu, "е");
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(v);
  };

  for (const phrase of phrases) add(phrase);

  if (unique.length < 3) {
    for (const r of company.rubrics || []) add(r?.name || "");
  }
  if (unique.length < 3) {
    for (const c of company.categories || []) add(c?.name || "");
  }

  // Last-resort: single-word tokens (better than empty).
  if (unique.length < 3) {
    for (const token of generateCompanyKeywords(company).slice(0, 12)) add(token);
  }

  const tryJoin = (n: number): string => unique.slice(0, n).join(", ").trim();
  let result = "";
  for (let n = Math.min(6, unique.length); n >= 1; n -= 1) {
    const candidate = tryJoin(n);
    if (!candidate) continue;
    if (candidate.length <= MAX_DESCRIPTION_LEN) {
      result = candidate;
      break;
    }
  }

  if (!result) result = tryJoin(3);
  result = clampDescription(result);
  if (result && !/[.!?]$/u.test(result)) result += ".";
  return result;
}

export function buildCompanyShortDescription(company: BiznesinfoCompany): string {
  const fromText = buildFromText(company);
  if (fromText) return fromText;
  return buildFromKeywords(company);
}

function isAbsoluteUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function normalizeLogoUrl(raw: string): string {
  const url = (raw || "").trim();
  if (!url) return "";
  const low = url.toLowerCase();
  if (low.endsWith("/images/icons/og-icon.png")) return "";
  if (low.includes("/images/logo/no-logo")) return "";
  if (low.includes("/images/logo/no_logo")) return "";
  return url;
}

export function getCompanyOgImagePath(company: BiznesinfoCompany): string | null {
  const override = BIZNESINFO_LOGO_OVERRIDES[company.source_id] || "";
  const rawLogo = normalizeLogoUrl(override || company.logo_url || "");
  if (!rawLogo) return null;

  if (rawLogo.startsWith("/api/biznesinfo/logo")) return rawLogo;
  if (rawLogo.startsWith("/companies/")) return rawLogo;
  if (rawLogo.startsWith("/images/")) {
    const id = (company.source_id || "").trim().toLowerCase();
    if (!id || id.length > 63 || !/^[a-z0-9-]+$/u.test(id)) return null;
    return `/api/biznesinfo/logo?id=${encodeURIComponent(id)}&path=${encodeURIComponent(rawLogo)}&v=3`;
  }

  if (isAbsoluteUrl(rawLogo)) return rawLogo;
  if (rawLogo.startsWith("/")) return rawLogo;
  return null;
}
