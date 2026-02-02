"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AIAssistant from "@/components/AIAssistant";
import MessageModal from "@/components/MessageModal";
import CompanyLocationMap from "@/components/CompanyLocationMap";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import type { IbizCompany, IbizCompanyResponse, IbizPhoneExt } from "@/lib/ibiz/types";
import { IBIZ_CATEGORY_ICONS } from "@/lib/ibiz/icons";
import { IBIZ_ABOUT_OVERRIDES } from "@/lib/ibiz/aboutOverrides";
import { IBIZ_HEADER_OVERRIDES } from "@/lib/ibiz/headerOverrides";
import { IBIZ_LOGO_OVERRIDES } from "@/lib/ibiz/logoOverrides";
import { getCompanyOverride } from "@/lib/companyOverrides";
import { generateCompanyKeywordPhrases } from "@/lib/ibiz/keywords";

interface PageProps {
  params: Promise<{ id: string }>;
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

function normalizePhoneForTel(phone: string): string {
  const trimmed = (phone || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned) return trimmed;
  if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\+/g, "")}`;
  return cleaned.replace(/\+/g, "");
}

function getWorkStatusDotClass(workStatus: { isOpen: boolean }): string {
  if (workStatus.isOpen) {
    return "bg-green-700 animate-pulse shadow-[0_0_10px_rgba(21,128,61,0.35)]";
  }
  return "bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.35)]";
}

/**
 * Determines if the company is currently open based on work_time.
 * Returns { isOpen, statusText, workTime } or null if cannot determine.
 */
function getWorkStatus(workHours: { work_time?: string; break_time?: string; status?: string } | null | undefined): {
  isOpen: boolean;
  statusText: string;
  workTime: string;
} | null {
  if (!workHours?.work_time) return null;
  
  const workTime = workHours.work_time.trim();
  const workTimeLower = workTime.toLowerCase();
  if (
    workTimeLower.includes("круглосуточ") ||
    workTimeLower.includes("24/7") ||
    workTimeLower.includes("24х7") ||
    workTimeLower.includes("24x7")
  ) {
    return { isOpen: true, statusText: "Открыто", workTime };
  }
  
  // Parse time range like "08:00-17:00" or "8:00 - 17:00" or "08.00-17.00"
  const timeMatch = workTime.match(/(\d{1,2})[.:,](\d{2})\s*[-–—]\s*(\d{1,2})[.:,](\d{2})/);
  if (!timeMatch) {
    // Cannot parse, return status from data if available
    return null;
  }
  
  const openHour = parseInt(timeMatch[1], 10);
  const openMin = parseInt(timeMatch[2], 10);
  const closeHour = parseInt(timeMatch[3], 10);
  const closeMin = parseInt(timeMatch[4], 10);
  
  // Get current time in Minsk timezone (UTC+3, no DST).
  // Avoid Intl timeZone conversions here because Safari/WebKit can throw
  // "Invalid time zone specified" depending on ICU/timezone data availability.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const minskDate = new Date(utcMs + 3 * 60 * 60 * 1000);
  const currentHour = minskDate.getUTCHours();
  const currentMin = minskDate.getUTCMinutes();
  
  // Convert to minutes for easier comparison
  const currentMins = currentHour * 60 + currentMin;
  const openMins = openHour * 60 + openMin;
  const closeMins = closeHour * 60 + closeMin;
  
  // Check if currently within work hours
  // Handle overnight schedules (e.g., 22:00-06:00)
  let isOpen: boolean;
  if (closeMins > openMins) {
    // Normal schedule (e.g., 08:00-17:00)
    isOpen = currentMins >= openMins && currentMins < closeMins;
  } else {
    // Overnight schedule (e.g., 22:00-06:00)
    isOpen = currentMins >= openMins || currentMins < closeMins;
  }
  
  // Check for break time
  if (isOpen && workHours.break_time) {
    const breakMatch = workHours.break_time.match(/(\d{1,2})[.:,](\d{2})\s*[-–—]\s*(\d{1,2})[.:,](\d{2})/);
    if (breakMatch) {
      const breakStartMins = parseInt(breakMatch[1], 10) * 60 + parseInt(breakMatch[2], 10);
      const breakEndMins = parseInt(breakMatch[3], 10) * 60 + parseInt(breakMatch[4], 10);
      if (currentMins >= breakStartMins && currentMins < breakEndMins) {
        return {
          isOpen: false,
          statusText: "Перерыв",
          workTime: workHours.break_time,
        };
      }
    }
  }
  
  // Check day of week (0 = Sunday, 6 = Saturday)
  const dayOfWeek = minskDate.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // If status mentions weekend closure and it's weekend
  const statusLower = (workHours.status || "").toLowerCase();
  if (isWeekend && (statusLower.includes("выходн") || statusLower.includes("сб") || statusLower.includes("вс"))) {
    // Check if status indicates weekend work
    if (!statusLower.includes("работ") && !statusLower.includes("откр")) {
      return {
        isOpen: false,
        statusText: "Выходной",
        workTime,
      };
    }
  }
  
  return {
    isOpen,
    statusText: isOpen ? "Открыто" : "Закрыто",
    workTime,
  };
}

// Social media detection
interface SocialLink {
  url: string;
  type: "instagram" | "telegram" | "vk" | "facebook" | "viber" | "whatsapp" | "youtube" | "tiktok" | "linkedin" | "twitter" | "ok";
  name: string;
  icon: string;
  bgClass: string;
}

function detectSocialMedia(url: string): SocialLink | null {
  const lower = url.toLowerCase();
  
  if (lower.includes("instagram.com") || lower.includes("instagram.by")) {
    return { url, type: "instagram", name: "Instagram", icon: "📸", bgClass: "bg-gradient-to-br from-purple-600 to-pink-500" };
  }
  if (lower.includes("t.me") || lower.includes("telegram.me") || lower.includes("telegram.org")) {
    return { url, type: "telegram", name: "Telegram", icon: "✈️", bgClass: "bg-sky-500" };
  }
  if (lower.includes("vk.com") || lower.includes("vkontakte.ru")) {
    return { url, type: "vk", name: "ВКонтакте", icon: "✌️", bgClass: "bg-blue-600" };
  }
  if (lower.includes("facebook.com") || lower.includes("fb.com") || lower.includes("fb.me")) {
    return { url, type: "facebook", name: "Facebook", icon: "👤", bgClass: "bg-blue-700" };
  }
  if (lower.includes("viber") || lower.includes("viber.com")) {
    return { url, type: "viber", name: "Viber", icon: "📞", bgClass: "bg-purple-600" };
  }
  if (lower.includes("wa.me") || lower.includes("whatsapp.com") || lower.includes("api.whatsapp")) {
    return { url, type: "whatsapp", name: "WhatsApp", icon: "💬", bgClass: "bg-green-600" };
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { url, type: "youtube", name: "YouTube", icon: "▶️", bgClass: "bg-red-600" };
  }
  if (lower.includes("tiktok.com")) {
    return { url, type: "tiktok", name: "TikTok", icon: "🎵", bgClass: "bg-gray-900" };
  }
  if (lower.includes("linkedin.com")) {
    return { url, type: "linkedin", name: "LinkedIn", icon: "💼", bgClass: "bg-blue-800" };
  }
  if (lower.includes("twitter.com") || lower.includes("x.com")) {
    return { url, type: "twitter", name: "X", icon: "🐦", bgClass: "bg-gray-900" };
  }
  if (lower.includes("ok.ru") || lower.includes("odnoklassniki.ru")) {
    return { url, type: "ok", name: "Одноклассники", icon: "🟠", bgClass: "bg-orange-500" };
  }
  
  return null;
}

function separateWebsitesAndSocials(websites: string[] | null | undefined): { websites: string[]; socials: SocialLink[] } {
  const regularWebsites: string[] = [];
  const socials: SocialLink[] = [];
  
  if (!websites || !Array.isArray(websites)) {
    return { websites: regularWebsites, socials };
  }
  
  for (const url of websites) {
    if (!url || typeof url !== 'string') continue;
    const social = detectSocialMedia(url);
    if (social) {
      socials.push(social);
    } else {
      regularWebsites.push(url);
    }
  }
  
  return { websites: regularWebsites, socials };
}

function getOptimizedLocalImageSrc(src: string | null | undefined, width: 256 | 384): string | null {
  const raw = (src || "").trim();
  if (!raw) return null;
  if (!raw.startsWith("/")) return raw;
  return `/_next/image?url=${encodeURIComponent(raw)}&w=${width}&q=75`;
}

// Generate up to 10 relevant keywords (comma-style phrases) for search/SEO tags.
function generateKeywords(company: IbizCompany): string[] {
  return generateCompanyKeywordPhrases(company, { maxKeywords: 10 });
}

function generateUniqueDescription(company: {
  name: string;
  city?: string;
  address?: string;
  rubrics?: { name: string; category_name?: string }[];
  categories?: { name: string }[];
  about?: string;
  description?: string;
}): string {
  const name = company.name || "Компания";
  const city = company.city || "";
  const rubrics = company.rubrics || [];
  const categories = company.categories || [];

  const mainCategory = categories[0]?.name || "";
  const services = rubrics.map(r => r.name).slice(0, 5);

  const parts: string[] = [];

  // Intro sentence
  if (city) {
    parts.push(`${name} — надёжная компания${mainCategory ? ` в сфере "${mainCategory}"` : ""}, работающая в городе ${city}.`);
  } else {
    parts.push(`${name} — надёжная компания${mainCategory ? ` в сфере "${mainCategory}"` : ""}, предоставляющая качественные услуги в Беларуси.`);
  }

  // Services
  if (services.length > 0) {
    if (services.length === 1) {
      parts.push(`\n\nОсновное направление деятельности: ${services[0]}.`);
    } else {
      parts.push(`\n\nОсновные направления деятельности:\n• ${services.join("\n• ")}`);
    }
  }

  // Call to action
  parts.push(`\n\nОбращайтесь к нам для получения профессиональной консультации и качественного обслуживания. Мы ценим каждого клиента и гарантируем индивидуальный подход.`);

  return parts.join("");
}

function capitalizeSentenceStart(value: string): string {
  const s = (value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncateDescription(raw: string, maxLength = 250): string {
  const text = capitalizeSentenceStart(raw);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastPunct = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
  if (lastPunct >= Math.floor(maxLength * 0.6)) {
    return slice.slice(0, lastPunct + 1);
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLength * 0.6)) {
    return slice.slice(0, lastSpace);
  }
  return slice;
}

export default function CompanyPage({ params }: PageProps) {
  const { id } = use(params);
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [data, setData] = useState<IbizCompanyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [showAllWebsites, setShowAllWebsites] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLogoFailed(false);
    setLogoLoaded(false);
    setShowAllWebsites(false);
    fetch(`/api/ibiz/company/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: IbizCompanyResponse | null) => {
        if (!isMounted) return;
        setData(resp);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setData(null);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [id]);

  const companyMaybe = data?.company ?? null;
  const logoOverride = useMemo(() => {
    const candidates = [id, companyMaybe?.source_id]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    for (const key of candidates) {
      const hit = IBIZ_LOGO_OVERRIDES[key];
      if (hit) return hit;
    }
    return "";
  }, [id, companyMaybe?.source_id]);
  const logoUrl = (companyMaybe?.logo_url || "").trim();
  const logoSrc = useMemo(() => {
    if (logoOverride) return logoOverride;
    return logoUrl ? `/api/ibiz/logo?u=${encodeURIComponent(logoUrl)}&v=2` : "";
  }, [logoOverride, logoUrl]);

  const phones: IbizPhoneExt[] = useMemo(() => {
    if (!companyMaybe) return [];
    if (companyMaybe.phones_ext && companyMaybe.phones_ext.length > 0) return companyMaybe.phones_ext;
    return (companyMaybe.phones || []).map((number) => ({ number, labels: [] as string[] }));
  }, [companyMaybe]);

  // Separate regular websites from social media links (must be above conditional returns to keep hooks order stable)
  const { websites: regularWebsites, socials } = useMemo(
    () => separateWebsitesAndSocials(companyMaybe?.websites),
    [companyMaybe?.websites]
  );
  const websitesToRender = useMemo(() => {
    if (showAllWebsites) return regularWebsites;
    return regularWebsites.slice(0, 1);
  }, [regularWebsites, showAllWebsites]);
  const hiddenWebsitesCount = useMemo(() => {
    if (showAllWebsites) return 0;
    return Math.max(0, regularWebsites.length - websitesToRender.length);
  }, [regularWebsites.length, showAllWebsites, websitesToRender.length]);

  // Calculate work status based on current time in Minsk (must be above conditional returns to keep hooks order stable)
  const workStatus = useMemo(() => getWorkStatus(companyMaybe?.work_hours), [companyMaybe?.work_hours]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col font-sans bg-gray-100">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#820251] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500">{t("common.loading")}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col font-sans bg-gray-100">
        <Header />
        <main className="flex-grow">
          <div className="container mx-auto py-10 px-4">
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("company.notFound")}</h3>
              <p className="text-gray-500 mb-6">Компания не найдена: {id}</p>
              <Link
                href="/#catalog"
                className="inline-block bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#7a0150] transition-colors"
              >
                {t("nav.catalog")}
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const companyId = data.id;
  const company = data.company;
  const favorite = isFavorite(companyId);

  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;

  const icon = primaryCategory?.slug ? IBIZ_CATEGORY_ICONS[primaryCategory.slug] || "🏢" : "🏢";
  const showLogo = Boolean(logoOverride || logoUrl) && !logoFailed;

  // Company-specific overrides
  const companyOverride = getCompanyOverride(company.source_id);
  const logoPosition = companyOverride?.logoPosition || "left";

  const primaryPhone = phones?.[0]?.number || "";
  const primaryEmail = company.emails?.[0] || "";

  const aboutText = (company.about || "").trim() || (IBIZ_ABOUT_OVERRIDES[company.source_id] || "").trim() || generateUniqueDescription(company);

  const headerOverride =
    IBIZ_HEADER_OVERRIDES[company.source_id] ||
    IBIZ_HEADER_OVERRIDES[String(company.source_id || "").toLowerCase()] ||
    IBIZ_HEADER_OVERRIDES[String(id || "").toLowerCase()] ||
    "";
  const hasHeaderOverride = headerOverride.trim().length > 0;
  const headerDescriptionSource = hasHeaderOverride
    ? headerOverride.trim()
    : (company.description || company.about || "").trim();
  const headerDescription = hasHeaderOverride
    ? headerDescriptionSource
    : truncateDescription(headerDescriptionSource, 250);
  const showHeaderDescription = headerDescription.length > 0;
  const secondaryLabel = primaryRubric?.name || primaryCategory?.name || "";
  const isMsu23 = (() => {
    const keys = [id, company.source_id]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return keys.some((key) => key === "msu-23" || key === "msu23");
  })();

  const servicesList = company.services_list || [];
  const photos = company.photos || [];
  const reviews = company.reviews || [];

  const categoryLink = primaryCategory ? `/catalog/${primaryCategory.slug}` : "/#catalog";
  const rubricSubSlug = primaryRubric ? primaryRubric.slug.split("/").slice(1).join("/") : "";
  const rubricLink = primaryCategory && rubricSubSlug ? `/catalog/${primaryCategory.slug}/${rubricSubSlug}` : categoryLink;

  const hasGeo = company.extra?.lat != null && company.extra?.lng != null;
  const lat = company.extra?.lat ?? null;
  const lng = company.extra?.lng ?? null;

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Breadcrumbs */}
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
              <Link href="/" className="hover:text-[#820251]">{t("common.home")}</Link>
              <span>/</span>
              <Link href="/#catalog" className="hover:text-[#820251]">{t("nav.catalog")}</Link>
              {primaryCategory && (
                <>
                  <span>/</span>
                  <Link href={categoryLink} className="hover:text-[#820251]">{primaryCategory.name}</Link>
                </>
              )}
              {primaryRubric && (
                <>
                  <span>/</span>
                  <Link href={rubricLink} className="hover:text-[#820251]">{primaryRubric.name}</Link>
                </>
              )}
              <span>/</span>
              <span className="text-[#820251] font-medium">{company.name}</span>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#b10a78] via-[#820251] to-[#7a0150]" />
          <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 rounded-full -translate-x-16 -translate-y-16" />
          <div className="absolute top-1/2 right-0 w-24 h-24 bg-white/5 rounded-full translate-x-12" />
          <div className="absolute bottom-0 left-1/4 w-40 h-40 bg-white/5 rounded-full translate-y-20" />
          <div className="absolute top-1/4 right-1/4 w-20 h-20 bg-white/5 rounded-full" />
          {!isMsu23 && company.hero_image && (
            <img
              src={getOptimizedLocalImageSrc(company.hero_image, 384) || company.hero_image}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-15 blur-sm"
              decoding="async"
              loading="lazy"
            />
          )}

          <div className="relative z-10 px-4 md:px-8 py-8 md:py-10">
            {logoPosition === "left" && showLogo ? (
              /* Layout: Logo left + Name right */
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center gap-5 md:gap-8">
                  {/* Logo */}
                  <div className="w-20 h-20 md:w-28 md:h-28 bg-white rounded-xl shadow-lg flex-shrink-0 flex items-center justify-center overflow-hidden">
                    <div className="w-full h-full relative flex items-center justify-center">
                      <span className={`text-2xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}>
                        {icon}
                      </span>
                      <img
                        src={logoSrc}
                        alt={company.name}
                        className={`absolute inset-0 w-full h-full object-contain p-2 transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                        decoding="async"
                        loading="eager"
                        onLoad={() => setLogoLoaded(true)}
                        onError={() => setLogoFailed(true)}
                      />
                    </div>
                  </div>
                  {/* Company info */}
                  <div className="flex-1 min-w-0">
                    <h1 className="text-xl md:text-3xl lg:text-4xl font-bold text-white mb-2 tracking-wide drop-shadow-lg">
                      {company.name}
                    </h1>
                    {secondaryLabel && (
                      <p className="text-white/80 text-sm md:text-base font-medium">
                        {secondaryLabel}
                      </p>
                    )}
                  </div>
                </div>
                {showHeaderDescription && (
                  <p
                    className={`text-white/90 text-sm md:text-base max-w-4xl leading-relaxed mt-5 ${
                      hasHeaderOverride ? "" : "line-clamp-3"
                    }`}
                  >
                    {headerDescription}
                  </p>
                )}
                {/* Share button */}
                <div className="mt-4 flex justify-start gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      const url = window.location.href;
                      const text = `${company.name} — ${primaryCategory?.name || ""}`;
                      if (navigator.share) {
                        navigator.share({ title: company.name, text, url }).catch(() => {});
                      } else {
                        navigator.clipboard.writeText(url).then(() => {
                          alert("Ссылка скопирована!");
                        }).catch(() => {});
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors bg-white/10 text-white hover:bg-white/20 border border-white/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    <span>Поделиться</span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={favorite}
                    aria-label={favorite ? t("favorites.remove") : t("favorites.add")}
                    title={favorite ? t("favorites.remove") : t("favorites.add")}
                    onClick={() => toggleFavorite(companyId)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border border-white/20 text-white ${
                      favorite ? "bg-white/20" : "bg-white/10 hover:bg-white/20"
                    }`}
                  >
                    <svg
                      className={`w-4 h-4 ${favorite ? "text-red-400 fill-current" : "text-white"}`}
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
                    <span className="hidden sm:inline">{t("favorites.title")}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Default layout: Centered */
              <div className="max-w-5xl mx-auto text-center">
                <h1 className="text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-3 tracking-wide drop-shadow-lg">
                  {company.name}
                </h1>
                {secondaryLabel && (
                  <p className="text-white/80 text-base md:text-lg mb-4 font-medium">
                    {secondaryLabel}
                  </p>
                )}
                <div className="flex justify-center mb-5">
                  <div className="w-32 h-1 bg-white/40 rounded-full" />
                </div>
                {showHeaderDescription && (
                  <p
                    className={`text-white/90 text-sm md:text-base max-w-4xl mx-auto leading-relaxed text-left ${
                      hasHeaderOverride ? "" : "line-clamp-3"
                    }`}
                  >
                    {headerDescription}
                  </p>
                )}
                {/* Share button */}
                <div className="mt-4 flex justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      const url = window.location.href;
                      const text = `${company.name} — ${primaryCategory?.name || ""}`;
                      if (navigator.share) {
                        navigator.share({ title: company.name, text, url }).catch(() => {});
                      } else {
                        navigator.clipboard.writeText(url).then(() => {
                          alert("Ссылка скопирована!");
                        }).catch(() => {});
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors bg-white/10 text-white hover:bg-white/20 border border-white/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    <span>Поделиться</span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={favorite}
                    aria-label={favorite ? t("favorites.remove") : t("favorites.add")}
                    title={favorite ? t("favorites.remove") : t("favorites.add")}
                    onClick={() => toggleFavorite(companyId)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border border-white/20 text-white ${
                      favorite ? "bg-white/20" : "bg-white/10 hover:bg-white/20"
                    }`}
                  >
                    <svg
                      className={`w-4 h-4 ${favorite ? "text-red-400 fill-current" : "text-white"}`}
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
                    <span className="hidden sm:inline">{t("favorites.title")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Anchor Menu */}
        <div
          id="company-menu"
          className="sticky top-0 z-[60] bg-gradient-to-r from-[#820251] to-[#9a0660] shadow-lg"
        >
          <div className="container mx-auto px-4">
            <nav className="flex items-center justify-center gap-1 md:gap-2 py-3 overflow-x-auto">
              <a
                href="#contacts"
                className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
              >
                <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3 5.18 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.72 12.36 12.36 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.1 10.9a16 16 0 0 0 4 4l1.26-1.15a2 2 0 0 1 2.11-.45 12.36 12.36 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span className="block text-center font-serif tracking-wide">Контакты</span>
              </a>
              <span className="text-white/30 text-xl">|</span>
              <a
                href="#about"
                className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
              >
                <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M16 13H8" />
                  <path d="M16 17H8" />
                  <path d="M10 9H8" />
                </svg>
                <span className="block text-center font-serif tracking-wide">О компании</span>
              </a>
              {servicesList.length > 0 && (
                <>
                  <span className="text-white/30 text-xl">|</span>
                  <a
                    href="#services"
                    className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
                  >
                    <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    <span className="block text-center font-serif tracking-wide">Наши услуги</span>
                  </a>
                </>
              )}
              {photos.length > 0 && (
                <>
                  <span className="text-white/30 text-xl">|</span>
                  <a
                    href="#photos"
                    className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
                  >
                    <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    <span className="block text-center font-serif tracking-wide">Фото</span>
                  </a>
                </>
              )}
              {reviews.length > 0 && (
                <>
                  <span className="text-white/30 text-xl">|</span>
                  <a
                    href="#reviews"
                    className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
                  >
                    <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
                    </svg>
                    <span className="block text-center font-serif tracking-wide">Отзывы</span>
                  </a>
                </>
              )}
              <span className="text-white/30 text-xl">|</span>
              <a
                href="#keywords"
                className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
              >
                <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20.59 13.41L11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82z" />
                  <path d="M7 7h.01" />
                </svg>
                <span className="block text-center font-serif tracking-wide">Ключевые слова</span>
              </a>
              <span className="text-white/30 text-xl">|</span>
              <a
                href="#map"
                className="group flex items-center gap-1.5 px-3 md:px-4 py-2 bg-white/90 rounded-lg text-sm font-semibold text-[#820251] hover:bg-[#820251] hover:text-white transition-colors whitespace-nowrap border border-[#820251]/30"
              >
                <svg className="w-4 h-4 text-[#D97706] group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="block text-center font-serif tracking-wide">Карта</span>
              </a>
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-8">
              {/* Logo - only show here if not in header */}
              {showLogo && logoPosition !== "left" && (
                <div className="bg-white rounded-lg shadow-sm p-6 flex justify-center">
                  <div className="w-32 h-32 md:w-44 md:h-44 bg-white rounded-xl shadow-md flex items-center justify-center overflow-hidden">
                    <div className="w-full h-full relative flex items-center justify-center">
                      <span className={`text-3xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}>
                        {icon}
                      </span>
                      <img
                        src={logoSrc}
                        alt={company.name}
                        className={`absolute inset-0 w-full h-full object-contain p-3 transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                        decoding="async"
                        loading="eager"
                        onLoad={() => setLogoLoaded(true)}
                        onError={() => setLogoFailed(true)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Contacts */}
              <div id="contacts" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#820251]">
                <h2 className="text-xl font-bold text-[#14532d] mb-4 flex items-center gap-2">
                  <span className="text-2xl">📞</span>
                  {t("company.contacts")}
                </h2>

                <div className="flex flex-col md:flex-row gap-6">
                  {/* Contacts - full width now that logo is in header */}
                  <div className="flex-1 space-y-4">
                    {company.address && (
                      <div>
                        <div className="text-gray-500 text-sm mb-1">{t("company.address")}</div>
                        <div className="flex items-start gap-2">
                          <span className="text-[#820251]">📍</span>
                          <span className="text-gray-700">{company.address}</span>
                        </div>
                      </div>
                    )}

                    {phones && phones.length > 0 && (
                      <div>
                        <div className="text-gray-500 text-sm mb-2">{t("company.phone")}</div>
                        <div className="space-y-2">
                          {phones.map((p, idx) => (
                            <div key={`${p.number}-${idx}`} className="flex items-start gap-2">
                              <div className="flex items-center gap-3 w-full flex-nowrap">
                                <a
                                  href={`tel:${normalizePhoneForTel(p.number) || p.number}`}
                                  className="flex items-start gap-2 text-[#820251] font-semibold text-base md:text-lg hover:underline whitespace-nowrap"
                                >
                                  <svg
                                    className="w-4 h-4 text-[#14532d] mt-1"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3 5.18 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.72 12.36 12.36 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.1 10.9a16 16 0 0 0 4 4l1.26-1.15a2 2 0 0 1 2.11-.45 12.36 12.36 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                  </svg>
                                  <span>{p.number}</span>
                                </a>
                                {p.labels && p.labels.length > 0 && (
                                  <div className="text-sm md:text-base text-gray-500 ml-auto text-right whitespace-nowrap">{p.labels.join(", ")}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {regularWebsites.length > 0 && (
                      <div>
                        <div className="text-gray-500 text-sm mb-1">{t("company.website")}</div>
                        <div className="space-y-1">
                          {websitesToRender.map((w) => (
                            <a
                              key={w}
                              href={w}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 min-w-0 text-[#820251] font-bold hover:underline"
                            >
                              <span aria-hidden className="text-[#820251]">🌐</span>
                              <span className="truncate">{displayUrl(w)}</span>
                            </a>
                          ))}
                          {hiddenWebsitesCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowAllWebsites(true)}
                              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
                            >
                              {t("common.more")} {hiddenWebsitesCount}
                            </button>
                          )}
                          {showAllWebsites && regularWebsites.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setShowAllWebsites(false)}
                              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
                            >
                              {t("common.hide")}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {company.emails && company.emails.length > 0 && (
                      <div>
                        <div className="text-gray-500 text-sm mb-1">{t("company.email")}</div>
                        <div className="space-y-1">
                          {company.emails.map((e) => (
                            <a
                              key={e}
                              href={`https://mail.yandex.ru/compose?to=${encodeURIComponent(e)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 min-w-0 text-[#820251] hover:underline"
                            >
                              <svg
                                className="w-4 h-4 text-[#14532d] flex-shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                                <path d="M22 6l-10 7L2 6" />
                              </svg>
                              <span className="truncate">{e}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {socials.length > 0 && (
                      <div>
                        <div className="text-gray-500 text-sm mb-2">Социальные сети</div>
                        <div className="space-y-2">
                          {socials.map((social, idx) => (
                            <a
                              key={`${social.type}-${idx}`}
                              href={social.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#820251] hover:bg-gray-50 transition-all group"
                            >
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg ${social.bgClass}`}>
                                {social.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-800 group-hover:text-[#820251] transition-colors">
                                  {social.name}
                                </div>
                                <div className="text-sm text-gray-400 truncate">
                                  {social.url.replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/')}
                                </div>
                              </div>
                              <svg className="w-5 h-5 text-[#820251] group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                  {(company.unp || company.contact_person) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {company.unp && (
                        <div>
                          <div className="text-gray-500 text-sm mb-1">УНП</div>
                          <div className="text-gray-700 font-medium">{company.unp}</div>
                        </div>
                      )}
                      {company.contact_person && (
                        <div>
                          <div className="text-gray-500 text-sm mb-1">Контактное лицо</div>
                          <div className="text-gray-700 font-medium">{company.contact_person}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {company.work_hours &&
                    (company.work_hours.work_time || company.work_hours.break_time || company.work_hours.status) && (
                      <div>
                        <div className="text-gray-500 text-sm mb-1">{t("company.workHours")}</div>
                        <div className="text-gray-700 space-y-1">
                          {company.work_hours.work_time && (
                            <div className="flex items-center gap-2">
                              {workStatus && (
                                <span
                                  className={`inline-block w-2.5 h-2.5 rounded-full ${getWorkStatusDotClass(workStatus)}`}
                                  role="img"
                                  aria-label={workStatus.isOpen ? "Открыто" : "Закрыто"}
                                />
                              )}
                              <span>{company.work_hours.work_time}</span>
                            </div>
                          )}
                          {company.work_hours.break_time && <div>Перерыв: {company.work_hours.break_time}</div>}
                          {company.work_hours.status && <div className="text-sm text-gray-500">{company.work_hours.status}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-3 mt-6">
                  <button
                    onClick={() => setMessageModalOpen(true)}
                    className="flex-1 min-w-[140px] border-2 border-[#14532d] text-[#14532d] py-3 rounded-lg font-semibold hover:bg-[#14532d] hover:text-white transition-colors"
                  >
                    {t("company.write")}
                  </button>
                  <div className="w-full sm:w-auto">
                    <AIAssistant companyName={company.name} companyId={company.source_id} isActive={false} />
                  </div>
                </div>
              </div>

              {/* Divider between Contacts and About */}
              <div className="h-3 bg-gradient-to-r from-[#820251]/10 via-[#820251]/20 to-[#820251]/10 rounded-full" aria-hidden="true" />

              {/* About */}
              <div id="about" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#820251]">
                <h2 className="text-xl font-bold text-[#14532d] mb-4 flex items-center gap-2">
                  <span className="text-2xl">📋</span>
                  {t("company.about")}
                </h2>
                <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                  {aboutText || "—"}
                </p>
              </div>

              {/* Services - only show if has actual services */}
              {servicesList.length > 0 && (
                <>
                  {/* Divider */}
	                  <div className="flex items-center justify-center gap-3" aria-hidden="true">
	                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
	                    <span className="text-[#820251]/40">✦</span>
	                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
	                  </div>
	                  <div id="services" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#b10a78]">
	                  <h2 className="text-xl font-bold text-[#14532d] mb-4 flex items-center gap-2">
	                    <span className="text-2xl">⚡</span>
	                    Наши услуги
	                  </h2>
	                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {servicesList.map((service, idx) => (
                      <div
                        key={`${service.name}-${idx}`}
                        className="group rounded-xl border border-gray-100 bg-gradient-to-r from-gray-50 to-white p-4 hover:border-[#820251]/30 hover:shadow-md transition-all"
                      >
                        {service.image_url ? (
                          <div className="w-full h-32 rounded-lg overflow-hidden bg-gray-100 mb-3">
                            <img
                              src={getOptimizedLocalImageSrc(service.image_url, 384) || service.image_url}
                              alt={service.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="w-full h-32 rounded-lg bg-[#820251]/10 flex items-center justify-center text-2xl mb-3">
                            ⚙️
                          </div>
                        )}
                        <div className="font-semibold text-gray-800 mb-1">{service.name}</div>
                        {service.description && (
                          <div className="text-sm text-gray-600 line-clamp-3">{service.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                </>
              )}

              {/* Photos - only show if has photos */}
              {photos.length > 0 && (
                <>
                  {/* Divider */}
                  <div className="flex items-center justify-center gap-3" aria-hidden="true">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                    <span className="text-[#820251]/40">✦</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                  </div>
	                  <div id="photos" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#7a0150]">
	                    <h2 className="text-xl font-bold text-[#14532d] mb-4 flex items-center gap-2">
	                      <span className="text-2xl">🖼️</span>
	                      Фотогалерея
	                    </h2>
	                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {photos.map((photo, idx) => (
                        <div key={`${photo.url}-${idx}`} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                          <img
                            src={getOptimizedLocalImageSrc(photo.url, 256) || photo.url}
                            alt={photo.alt || company.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Reviews - only show if has reviews */}
              {reviews.length > 0 && (
                <>
                  {/* Divider */}
                  <div className="flex items-center justify-center gap-3" aria-hidden="true">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                    <span className="text-[#820251]/40">✦</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                  </div>
                  <div id="reviews" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#820251]">
                    <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <span className="text-2xl">⭐</span>
                      Отзывы
                    </h2>
                    <div className="space-y-4">
                      {reviews.map((review, idx) => (
                        <div key={`${review.author}-${idx}`} className="p-4 border border-gray-100 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-800">{review.author}</div>
                            {review.date && <div className="text-sm text-gray-400">{review.date}</div>}
                          </div>
                          {typeof review.rating === "number" && (
                            <div className="text-sm text-yellow-600 mb-2">Рейтинг: {review.rating}/5</div>
                          )}
                          <div className="text-gray-700">{review.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Divider before Keywords */}
              <div className="flex items-center justify-center gap-3" aria-hidden="true">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                <span className="text-[#820251]/40">✦</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
              </div>

              {/* Keywords / SEO Tags */}
              <div id="keywords" className="bg-white rounded-xl shadow-md p-6 border-l-4 border-[#b10a78]">
                <h2 className="text-xl font-bold text-[#14532d] mb-4 flex items-center gap-2">
                  <span className="text-2xl">🏷️</span>
                  Ключевые слова
                </h2>
                <div className="flex flex-wrap gap-2">
                  {generateKeywords(company).map((keyword, idx) => (
                    <Link
                      key={idx}
                      href={`/search?service=${encodeURIComponent(keyword)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#820251]/10 to-[#820251]/5 text-[#820251] rounded-full text-sm font-medium hover:from-[#820251]/20 hover:to-[#820251]/10 transition-all hover:shadow-sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {keyword}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Divider before Map */}
              <div className="flex items-center justify-center gap-3" aria-hidden="true">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
                <span className="text-[#820251]/40">✦</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#820251]/20 to-transparent" />
              </div>
            </div>

          </div>

          {/* Map */}
          <div id="map">
            <CompanyLocationMap
              companyName={company.name}
              address={company.address}
              lat={hasGeo ? lat : null}
              lng={hasGeo ? lng : null}
            />
          </div>

          {/* Back link */}
          <div className="mt-8">
            <Link
              href={rubricLink}
              className="inline-flex items-center gap-2 text-[#820251] hover:underline"
            >
              ← {t("catalog.backToCategory")} {primaryRubric ? primaryRubric.name : primaryCategory?.name || t("nav.catalog")}
            </Link>
          </div>
        </div>
      </main>

      {/* Floating menu / scroll-to-top button */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-6 right-4 z-[70] flex items-center gap-2 px-4 py-2 rounded-full bg-[#820251] text-white shadow-lg hover:bg-[#7a0150] transition-colors"
        aria-label="Наверх"
      >
        <span className="text-sm font-semibold">Меню</span>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>

      <Footer />

      <MessageModal
        isOpen={messageModalOpen}
        onClose={() => setMessageModalOpen(false)}
        companyName={company.name}
        companyId={company.source_id}
        email={primaryEmail || undefined}
        phone={primaryPhone || undefined}
        hasAI={false}
      />
    </div>
  );
}
