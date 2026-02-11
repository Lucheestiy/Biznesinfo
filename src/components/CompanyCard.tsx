"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import AIAssistant from "./AIAssistant";
import MessageModal from "./MessageModal";
import type { BiznesinfoCompanySummary } from "@/lib/biznesinfo/types";
import { BIZNESINFO_CATEGORY_ICONS } from "@/lib/biznesinfo/icons";
import { buildHighlightRegex, highlightText } from "@/lib/utils/highlight";

const LOGO_PROXY_VERSION = "3";

interface CompanyCardProps {
  company: BiznesinfoCompanySummary;
  showCategory?: boolean;
  variant?: "default" | "search";
  highlightNameTokens?: string[];
  highlightServiceTokens?: string[];
  highlightLocationTokens?: string[];
}

function logoProxyUrl(companyId: string, rawLogoUrl: string): string {
  const logoUrl = (rawLogoUrl || "").trim();
  if (!logoUrl) return "";
  if (logoUrl.startsWith("/api/biznesinfo/logo")) return logoUrl;
  if (logoUrl.startsWith("/") && !logoUrl.startsWith("/images/")) return logoUrl;

  const pathname = (() => {
    try {
      const u = new URL(logoUrl);
      return u.pathname || "";
    } catch {
      return logoUrl.split("?")[0] || "";
    }
  })();

  if (!pathname.startsWith("/images/")) return "";
  return `/api/biznesinfo/logo?id=${encodeURIComponent(companyId)}&path=${encodeURIComponent(pathname)}&v=${LOGO_PROXY_VERSION}`;
}

function displayUrl(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.hostname || s;
  } catch {
    return s.replace(/^https?:\/\//i, "").split("/")[0] || s;
  }
}

function normalizeWebsiteHref(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const candidate = s.split(/[\s,;]+/)[0] || "";
  if (!candidate) return null;

  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    try {
      const u = new URL(`https://${candidate}`);
      return u.toString();
    } catch {
      return null;
    }
  }
}

function normalizeWhitespace(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function firstHighlightMatch(text: string, tokens: string[]): { index: number; length: number } | null {
  const value = normalizeWhitespace(text);
  if (!value) return null;
  if (!tokens || tokens.length === 0) return null;
  const regex = buildHighlightRegex(tokens);
  if (!regex) return null;
  regex.lastIndex = 0;
  const match = regex.exec(value);
  if (!match) return null;
  const index = typeof match.index === "number" ? match.index : -1;
  if (index < 0) return null;
  return { index, length: (match[0] || "").length };
}

function excerptAroundMatch(text: string, matchIndex: number, matchLength: number, maxChars: number): string {
  const value = normalizeWhitespace(text);
  if (!value) return "";
  if (value.length <= maxChars) return value;

  const before = Math.max(40, Math.floor(maxChars * 0.35));
  let start = Math.max(0, matchIndex - before);
  let end = Math.min(value.length, start + maxChars);
  if (end - start < maxChars && end >= value.length) {
    start = Math.max(0, end - maxChars);
  }

  if (start > 0) {
    const windowStart = Math.max(0, matchIndex - 240);
    const period = value.lastIndexOf(". ", matchIndex);
    const exclaim = value.lastIndexOf("! ", matchIndex);
    const question = value.lastIndexOf("? ", matchIndex);
    const cut = Math.max(period, exclaim, question);
    if (cut >= Math.max(start, windowStart)) start = cut + 2;
  }

  if (end < value.length) {
    const candidates = [value.indexOf(". ", matchIndex + matchLength), value.indexOf("! ", matchIndex + matchLength), value.indexOf("? ", matchIndex + matchLength)]
      .filter((idx) => idx >= 0)
      .sort((a, b) => a - b);
    const nextSentence = candidates.length ? candidates[0] : -1;
    if (nextSentence >= 0 && nextSentence < end) end = nextSentence + 1;
  }

  if (start > 0 && !/\s/gu.test(value[start])) {
    const nextSpace = value.indexOf(" ", start);
    if (nextSpace > start && nextSpace - start < 20) start = nextSpace + 1;
  }

  if (end < value.length && !/\s/gu.test(value[end - 1])) {
    const lastSpace = value.lastIndexOf(" ", end);
    if (lastSpace > start && end - lastSpace < 20) end = lastSpace;
  }

  let snippet = value.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < value.length) snippet = `${snippet}…`;
  return snippet;
}

function buildSearchSnippet(raw: string, maxChars: number, highlightTokens: string[] = []): string {
  const text = normalizeWhitespace(raw);
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const match = firstHighlightMatch(text, highlightTokens);
  if (match) {
    return excerptAroundMatch(text, match.index, match.length, maxChars);
  }

  const sentences = text
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean) || [];

  const picked: string[] = [];
  for (const sentence of sentences) {
    const next = picked.length ? `${picked.join(" ")} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    picked.push(sentence);
  }
  if (picked.length > 0) return picked.join(" ").trim();

  const truncated = text.slice(0, maxChars);
  const lastHardStop = Math.max(truncated.lastIndexOf("."), truncated.lastIndexOf("!"), truncated.lastIndexOf("?"));
  if (lastHardStop >= Math.floor(maxChars * 0.6)) {
    return truncated.slice(0, lastHardStop + 1).trim();
  }

  const lastSoftStop = Math.max(truncated.lastIndexOf(";"), truncated.lastIndexOf(":"));
  if (lastSoftStop >= Math.floor(maxChars * 0.7)) {
    return truncated.slice(0, lastSoftStop + 1).trim();
  }

  const lastComma = truncated.lastIndexOf(",");
  if (lastComma >= Math.floor(maxChars * 0.75)) {
    return truncated.slice(0, lastComma).trim();
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) return truncated.slice(0, lastSpace).trim();
  return truncated.trim();
}

function normalizePhoneHref(raw: string): string {
  return (raw || "").replace(/[^\d+]/g, "");
}

/**
 * Extracts products/services info from company "about" text.
 * Removes company name references, history, location info.
 * Returns a short characterization (max 150 chars) or empty string.
 */
function extractProductsServices(about: string, companyName: string): string {
  if (!about || about.trim().length === 0) return "";
  
  let text = about;
  
  // Remove company name and common legal forms
  const nameParts = companyName
    .toLowerCase()
    .replace(/[«»"'“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  for (const part of nameParts) {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=[^\\p{L}\\p{N}]|$)`, "giu"), "$1");
  }
  text = text.replace(
    new RegExp(`(^|[^\\p{L}\\p{N}])(ООО|ОАО|ЗАО|ИП|УП|КСУП|ЧТУП|ЧПУП|РУП|СООО|СП)(?=[^\\p{L}\\p{N}]|$)`, "giu"),
    "$1",
  );
  text = text.replace(/[«»"'“”„]/g, "");
  
  // Remove history/foundation phrases
  text = text.replace(/образован[оа]?\s*(в\s*)?\d{4}\s*(году?)?\.?/gi, '');
  text = text.replace(/основан[оа]?\s*(в\s*)?\d{4}\s*(году?)?\.?/gi, '');
  text = text.replace(/с\s*\d{4}\s*(года?)?/gi, '');
  text = text.replace(/на\s+протяжении\s+\d+\s+лет/gi, '');
  text = text.replace(/более\s+\d+\s+лет/gi, '');
  
  // Remove location phrases
  text = text.replace(/расположен[оа]?\s+в\s+[^.]+\./gi, '');
  text = text.replace(/находи[тм]ся\s+в\s+[^.]+\./gi, '');
  text = text.replace(/по\s+адресу\s+[^.]+\./gi, '');
  text = text.replace(/в\s+\d+-?х?\s+километрах?\s+от\s+[^.]+\./gi, '');
  
  // Find sentences with products/services keywords
  const keywords = [
    'производ', 'выпуска', 'изготов', 'предлага', 'оказыва', 'предоставля',
    'продукци', 'товар', 'услуг', 'специализ', 'занима', 'реализу',
    'выращива', 'поставля', 'продаж', 'ассортимент'
  ];
  
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  const relevantSentences: string[] = [];
  
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (keywords.some(kw => lower.includes(kw))) {
      relevantSentences.push(sentence);
      if (relevantSentences.join('. ').length > 120) break;
    }
  }
  
  let result = relevantSentences.join('. ').trim();
  
  // Clean up multiple spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  // Truncate if too long - try to end at sentence boundary
  if (result.length > 150) {
    // Find last period within limit
    const truncated = result.substring(0, 150);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastExclaim = truncated.lastIndexOf('!');
    const lastQuestion = truncated.lastIndexOf('?');
    const lastSentenceEnd = Math.max(lastPeriod, lastExclaim, lastQuestion);
    
    if (lastSentenceEnd > 50) {
      // End at sentence boundary
      result = result.substring(0, lastSentenceEnd + 1);
    } else {
      // No good sentence break, truncate at word boundary
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 100) {
        result = result.substring(0, lastSpace) + '...';
      } else {
        result = truncated + '...';
      }
    }
  }
  
  // Add period if missing
  if (result && !result.endsWith('.') && !result.endsWith('...')) {
    result += '.';
  }
  
  return result;
}

function SearchCompanyCard({
  company,
  showCategory = false,
  highlightNameTokens = [],
  highlightServiceTokens = [],
  highlightLocationTokens = [],
}: CompanyCardProps) {
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);

  const companyHref = `/company/${encodeURIComponent(company.id)}`;
  const favorite = isFavorite(company.id);
  const icon = company.primary_category_slug ? BIZNESINFO_CATEGORY_ICONS[company.primary_category_slug] || "🏢" : "🏢";
  const logoUrl = (company.logo_url || "").trim();
  const logoSrc = useMemo(() => (logoUrl ? logoProxyUrl(company.id, logoUrl) : ""), [company.id, logoUrl]);
  const showLogo = Boolean(logoUrl) && !logoFailed;

  const initials = useMemo(() => {
    const name = company.name || "";
    const cleaned = name
      .replace(/[«»"'""„]/g, "")
      .replace(/(ООО|ОАО|ЗАО|ИП|УП|КСУП|ЧТУП|ЧПУП|РУП|СООО|СП|МАГАЗИН|ФИЛИАЛ|Ф-Л)/gi, "")
      .trim();
    const words = cleaned.split(/[\s-]+/).filter((w) => w.length > 1);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    if (words.length === 1 && words[0].length >= 2) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }, [company.name]);

  const initialsColor = useMemo(() => {
    const colors = [
      "from-blue-500 to-blue-600",
      "from-green-500 to-green-600",
      "from-purple-500 to-purple-600",
      "from-orange-500 to-orange-600",
      "from-pink-500 to-pink-600",
      "from-teal-500 to-teal-600",
      "from-indigo-500 to-indigo-600",
      "from-rose-500 to-rose-600",
    ];
    let hash = 0;
    for (let i = 0; i < company.name.length; i++) {
      hash = company.name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }, [company.name]);

  const industryText = useMemo(() => {
    const rubric = (company.primary_rubric_name || "").trim();
    const category = (company.primary_category_name || "").trim();
    if (showCategory) return rubric || category;
    return category || rubric;
  }, [company.primary_category_name, company.primary_rubric_name, showCategory]);

  const shortDescription = useMemo(() => {
    const tokens = highlightServiceTokens || [];
    const maxChars = 250;

    const description = (company.description || "").trim();
    const about = (company.about || "").trim();

    if (tokens.length > 0) {
      if (firstHighlightMatch(description, tokens)) {
        return buildSearchSnippet(description, maxChars, tokens);
      }
      if (firstHighlightMatch(about, tokens)) {
        return buildSearchSnippet(about, maxChars, tokens);
      }
    }

    const source = description || about;
    return buildSearchSnippet(source, maxChars, tokens);
  }, [company.about, company.description, highlightServiceTokens]);

  const address = (company.address || company.city || "").trim();

  const phones = useMemo(() => {
    const list = (company.phones_ext && company.phones_ext.length > 0)
      ? company.phones_ext.map((p) => p.number)
      : (company.phones || []);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      const number = (raw || "").trim();
      if (!number) continue;
      if (seen.has(number)) continue;
      seen.add(number);
      out.push(number);
      if (out.length >= 2) break;
    }
    return out;
  }, [company.phones, company.phones_ext]);

  const email = (company.emails?.[0] || "").trim();

  useEffect(() => {
    setLogoFailed(false);
    setLogoLoaded(false);
  }, [logoSrc]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border-2 border-[#820251] hover:shadow-md transition-shadow overflow-hidden flex flex-col h-full">
      <div className="bg-gradient-to-r from-[#820251] to-[#6a0143] p-3.5">
        <div className="flex items-start gap-4">
          {/* Logo (must stay as implemented) */}
          <Link
            href={companyHref}
            aria-label={t("company.details")}
            className="block w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 shadow-md focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            {showLogo ? (
              <div className="w-full h-full relative flex items-center justify-center bg-white">
                <span
                  className={`text-[#820251] text-3xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}
                >
                  {icon}
                </span>
                <img
                  src={logoSrc}
                  alt={company.name}
                  className={`absolute inset-0 w-full h-full object-contain p-1 transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                  decoding="async"
                  loading="lazy"
                  onLoad={() => setLogoLoaded(true)}
                  onError={() => setLogoFailed(true)}
                />
              </div>
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${initialsColor} flex items-center justify-center`}>
                <span className="text-white text-2xl font-bold tracking-wide">{initials}</span>
              </div>
            )}
          </Link>

          <div className="min-w-0 flex-1">
            <h3 className="text-[18px] font-bold text-white leading-tight">
              <Link
                href={companyHref}
                className="hover:underline focus:outline-none focus:ring-2 focus:ring-white/70 rounded-sm"
              >
                {highlightText(company.name, highlightNameTokens)}
              </Link>
            </h3>
            {industryText && (
              <div className="mt-2">
                <span className="inline-block bg-white/10 text-white text-[13px] leading-tight font-semibold px-2 py-1 rounded-md">
                  {highlightText(industryText, highlightServiceTokens)}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            aria-pressed={favorite}
            aria-label={favorite ? t("favorites.remove") : t("favorites.add")}
            onClick={() => toggleFavorite(company.id)}
            title={favorite ? t("favorites.remove") : t("favorites.add")}
            className={`shrink-0 w-10 h-10 rounded-xl transition-colors flex items-center justify-center ${
              favorite ? "bg-white/20" : "bg-white/10 hover:bg-white/15 active:bg-white/20"
            }`}
          >
            <svg
              className={`w-6 h-6 ${favorite ? "text-red-400 fill-current" : "text-white"}`}
              fill={favorite ? "currentColor" : "none"}
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-3.5 bg-gradient-to-br from-white to-[#820251]/5 flex-1 flex flex-col">
        {shortDescription && (
          <p className="text-[15px] text-gray-900 leading-tight font-medium">
            {highlightText(shortDescription, highlightServiceTokens)}
          </p>
        )}

        {address && (
          <div className={`${shortDescription ? "mt-2.5" : ""} text-[13px] text-gray-800 leading-tight whitespace-pre-line break-words`}>
            {highlightText(address, highlightLocationTokens)}
          </div>
        )}

        <div className="mt-2.5 space-y-1.5">
          <div className="space-y-1">
            <a
              href={phones[0] ? `tel:${normalizePhoneHref(phones[0])}` : undefined}
              className="block text-[15px] text-[#820251] font-semibold hover:underline"
            >
              {phones[0] || "—"}
            </a>
            <a
              href={phones[1] ? `tel:${normalizePhoneHref(phones[1])}` : undefined}
              className="block text-[15px] text-[#820251] font-semibold hover:underline"
            >
              {phones[1] || "—"}
            </a>
          </div>

          <a
            href={email ? `mailto:${email}` : undefined}
            className="block text-[13px] text-gray-800 hover:text-[#820251] hover:underline break-words"
          >
            {email || "—"}
          </a>
        </div>

        <div className="mt-auto pt-2.5 flex justify-end">
          <Link
            href={`/company/${encodeURIComponent(company.id)}`}
            className="inline-flex items-center justify-center bg-[#820251] text-white px-4 py-1.5 rounded-lg text-[15px] font-bold shadow-sm hover:bg-[#6a0143] active:bg-[#520031] transition-colors"
          >
            {t("company.details")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function FullCompanyCard({ company, showCategory = false }: CompanyCardProps) {
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [phonesExpanded, setPhonesExpanded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);

  const favorite = isFavorite(company.id);
  const primaryWebsite = company.websites?.[0] || "";
  const primaryWebsiteHref = useMemo(() => normalizeWebsiteHref(primaryWebsite), [primaryWebsite]);
  const primaryEmail = company.emails?.[0] || "";
  const primaryPhone = company.phones?.[0] || company.phones_ext?.[0]?.number || "";

  const phones = useMemo(() => {
    if (company.phones_ext && company.phones_ext.length > 0) return company.phones_ext;
    return (company.phones || []).map((number) => ({ number, labels: [] as string[] }));
  }, [company.phones, company.phones_ext]);

  const workStatus = (company.work_hours?.status || "").trim();
  const workTime = (company.work_hours?.work_time || "").trim();
  const workHoursText = [workStatus, workTime && !workStatus.includes(workTime) ? workTime : ""].filter(Boolean).join(" • ");

  const icon = company.primary_category_slug ? BIZNESINFO_CATEGORY_ICONS[company.primary_category_slug] || "🏢" : "🏢";
  const logoUrl = (company.logo_url || "").trim();
  const logoSrc = useMemo(() => (logoUrl ? logoProxyUrl(company.id, logoUrl) : ""), [company.id, logoUrl]);
  const showLogo = Boolean(logoUrl) && !logoFailed;
  
  // Generate initials for companies without logo
  const initials = useMemo(() => {
    const name = company.name || "";
    // Remove legal forms and get meaningful words
    const cleaned = name
      .replace(/[«»"'""„]/g, "")
      .replace(/(ООО|ОАО|ЗАО|ИП|УП|КСУП|ЧТУП|ЧПУП|РУП|СООО|СП|МАГАЗИН|ФИЛИАЛ|Ф-Л)/gi, "")
      .trim();
    const words = cleaned.split(/[\s-]+/).filter(w => w.length > 1);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1 && words[0].length >= 2) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }, [company.name]);
  
  // Generate a consistent color based on company name
  const initialsColor = useMemo(() => {
    const colors = [
      "from-blue-500 to-blue-600",
      "from-green-500 to-green-600", 
      "from-purple-500 to-purple-600",
      "from-orange-500 to-orange-600",
      "from-pink-500 to-pink-600",
      "from-teal-500 to-teal-600",
      "from-indigo-500 to-indigo-600",
      "from-rose-500 to-rose-600",
    ];
    let hash = 0;
    for (let i = 0; i < company.name.length; i++) {
      hash = company.name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }, [company.name]);
  
  // Extract products/services info from "about" field
  const servicesInfo = useMemo(() => extractProductsServices(company.about || "", company.name), [company.about, company.name]);

  useEffect(() => {
    setLogoFailed(false);
    setLogoLoaded(false);
  }, [logoSrc]);

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 hover:shadow-lg transition-all overflow-hidden relative flex flex-col h-full">
        {/* Favorite button */}
        <button
          onClick={() => toggleFavorite(company.id)}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm hover:shadow-md transition-all"
          title={favorite ? t("favorites.remove") : t("favorites.add")}
        >
          <svg
            className={`w-5 h-5 ${favorite ? "text-red-500 fill-current" : "text-gray-400"}`}
            fill={favorite ? "currentColor" : "none"}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        </button>

        {/* Header */}
        <div className="bg-gradient-to-r from-[#820251] to-[#6a0143] p-4 pr-12">
          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 shadow-md">
              {showLogo ? (
                <div className="w-full h-full relative flex items-center justify-center bg-white">
                  <span
                    className={`text-[#820251] text-3xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}
                  >
                    {icon}
                  </span>
                  <img
                    src={logoSrc}
                    alt={company.name}
                    className={`absolute inset-0 w-full h-full object-contain p-1 transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                    decoding="async"
                    loading="lazy"
                    onLoad={() => setLogoLoaded(true)}
                    onError={() => setLogoFailed(true)}
                  />
                </div>
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${initialsColor} flex items-center justify-center`}>
                  <span className="text-white text-2xl font-bold tracking-wide">{initials}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-white text-lg leading-tight">
                {company.name}
              </h3>
              {showCategory && company.primary_rubric_name && (
                <span className="inline-block mt-2 text-xs text-pink-200 bg-white/10 px-2 py-1 rounded">
                  {company.primary_rubric_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col">
          {/* Products/Services info line */}
          {servicesInfo && (
            <div className="flex items-start gap-2 mb-3 text-sm">
              <span className="text-[#820251] mt-0.5">🛠️</span>
              <span className="text-gray-700 leading-tight line-clamp-2">{servicesInfo}</span>
            </div>
          )}
          
          {/* Address */}
          <div className="flex items-start gap-2 mb-3 text-sm">
            <span className="text-[#820251] mt-0.5">📍</span>
            <span className="text-gray-700 leading-tight">{company.address || company.city}</span>
          </div>

          {(company.work_hours?.status || company.work_hours?.work_time) && (
            <div className="flex items-start gap-2 mb-3 text-sm">
              <span className="text-[#820251] mt-0.5">⏰</span>
              <span className="text-gray-700 leading-tight line-clamp-2">
                {workHoursText}
              </span>
            </div>
          )}

          {company.description && (
            <div className="text-sm text-gray-600 line-clamp-2">{company.description}</div>
          )}

          <div className="border-t border-gray-100 my-3"></div>

          {/* Contacts */}
          <div className="space-y-2 text-sm mb-4">
            {primaryWebsiteHref && (
              <div className="flex items-center gap-2">
                <span className="text-[#820251] w-5 text-center">🌐</span>
                <a
                  href={primaryWebsiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#820251] font-medium hover:underline truncate"
                >
                  {displayUrl(primaryWebsiteHref)}
                </a>
              </div>
            )}

            {primaryEmail && (
              <div className="flex items-center gap-2">
                <span className="text-[#820251] w-5 text-center">✉️</span>
                <a
                  href={`https://mail.yandex.ru/compose?to=${encodeURIComponent(primaryEmail)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-700 hover:text-[#820251] truncate"
                >
                  {primaryEmail}
                </a>
              </div>
            )}

            {phones.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[#820251] w-5 text-center mt-0.5">📞</span>
                <div className="flex flex-col gap-1">
                  {(phonesExpanded ? phones : phones.slice(0, 3)).map((p, idx) => (
                    <a
                      key={idx}
                      href={`tel:${p.number}`}
                      className="text-[#820251] font-medium hover:underline"
                    >
                      {p.number}
                      {p.labels && p.labels.length > 0 && (
                        <span className="text-gray-500 font-normal"> ({p.labels.join(", ")})</span>
                      )}
                    </a>
                  ))}
                  {phones.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setPhonesExpanded((v) => !v)}
                      className="text-left text-xs text-gray-400 hover:text-[#820251] hover:underline"
                    >
                      {phonesExpanded ? t("common.hide") : `+${phones.length - 3} ${t("common.more")}`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-auto">
            <a
              href={primaryPhone ? `tel:${primaryPhone}` : undefined}
              className="flex-1 min-w-[100px] bg-green-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-green-700 transition-colors text-center"
            >
              {t("company.call")}
            </a>
            <button
              onClick={() => setMessageModalOpen(true)}
              className="flex-1 min-w-[100px] border-2 border-[#820251] text-[#820251] px-3 py-2 rounded text-sm font-medium hover:bg-[#820251] hover:text-white transition-colors"
            >
              {t("company.write")}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          <AIAssistant companyName={company.name} companyId={company.id} isActive={false} />
          <Link
            href={`/company/${encodeURIComponent(company.id)}`}
            className="bg-[#820251] text-white px-4 py-2 rounded text-sm font-medium hover:bg-[#6a0143] transition-colors"
          >
            {t("company.details")}
          </Link>
        </div>

      </div>

      <MessageModal
        isOpen={messageModalOpen}
        onClose={() => setMessageModalOpen(false)}
        companyName={company.name}
        companyId={company.id}
        email={primaryEmail || undefined}
        phone={primaryPhone || undefined}
        hasAI={false}
      />
    </>
  );
}

export default function CompanyCard(props: CompanyCardProps) {
  if (props.variant === "search") return <SearchCompanyCard {...props} />;
  return <FullCompanyCard {...props} />;
}
