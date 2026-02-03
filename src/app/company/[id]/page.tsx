"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AIAssistant from "@/components/AIAssistant";
import MessageModal from "@/components/MessageModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import type { BiznesinfoCompanyResponse, BiznesinfoPhoneExt } from "@/lib/biznesinfo/types";
import { BIZNESINFO_CATEGORY_ICONS } from "@/lib/biznesinfo/icons";
import { BIZNESINFO_ABOUT_OVERRIDES } from "@/lib/biznesinfo/aboutOverrides";

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

// Generate 5 mid-frequency keywords based on company rubrics and category
function generateKeywords(company: {
  rubrics?: { name: string; category_name?: string }[];
  categories?: { name: string }[];
  description?: string;
}): string[] {
  const keywords: string[] = [];
  const rubrics = company.rubrics || [];
  const categories = company.categories || [];
  const description = company.description || "";

  // Keywords mapping by category/rubric type
  const keywordsByCategory: Record<string, string[]> = {
    // Автомобили
    "автозапчасти": ["купить запчасти", "автозапчасти оптом", "запчасти для авто", "автомагазин", "детали для машин"],
    "автосервис": ["ремонт авто", "СТО Беларусь", "техобслуживание", "диагностика авто", "автомастерская"],
    "грузоперевозки": ["доставка грузов", "транспортные услуги", "перевозка товаров", "логистика", "грузовое такси"],
    // Строительство
    "строительство": ["строительные услуги", "ремонт под ключ", "строительная компания", "отделочные работы", "капитальный ремонт"],
    "проектные работы": ["проектирование зданий", "архитектурный проект", "строительный проект", "чертежи", "проектная документация"],
    "стройматериалы": ["купить стройматериалы", "строительные материалы", "оптом стройматериалы", "доставка материалов", "склад стройматериалов"],
    // Недвижимость
    "недвижимость": ["аренда помещений", "продажа недвижимости", "коммерческая недвижимость", "офис в аренду", "складские помещения"],
    // Сельское хозяйство
    "сельское хозяйство": ["сельхозпродукция", "фермерское хозяйство", "агропромышленный комплекс", "продукция АПК", "сельхозтехника"],
    "животноводство": ["крупный рогатый скот", "молочная продукция", "мясо оптом", "фермерское мясо", "молоко оптом"],
    "растениеводство": ["зерновые культуры", "семена оптом", "урожай зерна", "сельхозкультуры", "рапс подсолнечник"],
    "лесное хозяйство": ["лесоматериалы", "древесина оптом", "пиломатериалы", "круглый лес", "лесозаготовка"],
    // Деревообработка
    "деревообработка": ["изделия из дерева", "деревянные конструкции", "столярные изделия", "мебель на заказ", "обработка древесины"],
    "пиломатериалы": ["доска обрезная", "брус строительный", "вагонка", "пиломатериалы оптом", "сухая древесина"],
    "деревянные дома": ["дом из бруса", "сруб под ключ", "деревянная баня", "строительство дома", "каркасный дом"],
    // Промышленность
    "оборудование": ["промышленное оборудование", "станки и машины", "техника для производства", "оборудование оптом", "монтаж оборудования"],
    "холодильное": ["холодильные установки", "рефрижераторы", "промышленное охлаждение", "холодильные камеры", "климатическое оборудование"],
    // Продукты питания
    "продукты питания": ["продукты оптом", "пищевая продукция", "оптовая база продуктов", "поставки продуктов", "продовольственные товары"],
    "молочные продукты": ["молоко оптом", "сыр масло", "кисломолочные продукты", "молочная продукция", "творог сметана"],
    "мясные продукты": ["мясо оптом", "колбасные изделия", "мясная продукция", "полуфабрикаты", "свинина говядина"],
    // Услуги
    "юридические услуги": ["консультация юриста", "правовая помощь", "юридическое сопровождение", "адвокат Беларусь", "регистрация фирмы"],
    "бухгалтерские услуги": ["ведение бухгалтерии", "бухгалтер на аутсорсе", "налоговый учет", "финансовая отчетность", "аудит компании"],
    "it услуги": ["разработка сайтов", "программное обеспечение", "IT поддержка", "автоматизация бизнеса", "цифровые решения"],
    // Торговля
    "оптовая торговля": ["товары оптом", "оптовые поставки", "дистрибьютор", "оптовый склад", "закупки оптом"],
    "розничная торговля": ["магазин", "торговая точка", "розничные продажи", "потребительские товары", "ритейл"],
    // Медицина
    "медицинские услуги": ["клиника", "медицинский центр", "врач специалист", "диагностика", "лечение"],
    "аптека": ["лекарства", "медикаменты", "фармацевтика", "аптечная сеть", "препараты"],
    // Образование
    "образование": ["курсы обучения", "повышение квалификации", "тренинги", "обучающие программы", "сертификация"],
    // Туризм
    "туризм": ["туристические услуги", "путевки", "экскурсии", "отдых в Беларуси", "туроператор"],
    "гостиницы": ["бронирование номеров", "отель", "гостиничный комплекс", "проживание", "размещение"],
    // Реклама
    "реклама": ["рекламные услуги", "маркетинг", "продвижение бизнеса", "наружная реклама", "digital маркетинг"],
    "полиграфия": ["печать", "типография", "визитки буклеты", "рекламная продукция", "широкоформатная печать"],
    // Безопасность
    "охрана": ["охранные услуги", "безопасность объекта", "видеонаблюдение", "пожарная сигнализация", "контроль доступа"],
    // Клининг
    "клининг": ["уборка помещений", "клининговые услуги", "чистка", "профессиональная уборка", "мойка окон"],
    // Металл
    "металлопрокат": ["металл оптом", "арматура", "трубы металлические", "листовой металл", "металлоизделия"],
    // Электрика
    "электрооборудование": ["электротовары", "кабельная продукция", "электромонтаж", "освещение", "электроустановки"],
    // Текстиль
    "текстиль": ["ткани оптом", "швейная продукция", "текстильные изделия", "спецодежда", "постельное белье"],
  };

  // Find matching keywords based on rubrics and categories
  const allText = [
    ...rubrics.map(r => r.name.toLowerCase()),
    ...categories.map(c => c.name.toLowerCase()),
    description.toLowerCase()
  ].join(" ");

  // Check each category for keyword matches
  for (const [key, words] of Object.entries(keywordsByCategory)) {
    if (allText.includes(key)) {
      keywords.push(...words);
      if (keywords.length >= 5) break;
    }
  }

  // If not enough keywords, generate from rubric names
  if (keywords.length < 5) {
    for (const rubric of rubrics) {
      const rubricName = rubric.name.toLowerCase();
      if (!keywords.some(k => k.toLowerCase().includes(rubricName.split(" ")[0]))) {
        keywords.push(`${rubric.name} Беларусь`);
      }
      if (keywords.length >= 5) break;
    }
  }

  // If still not enough, add generic business keywords
  const genericKeywords = ["услуги в Беларуси", "компания Минск", "заказать услугу", "цены на услуги", "качественный сервис"];
  while (keywords.length < 5) {
    const generic = genericKeywords[keywords.length];
    if (generic && !keywords.includes(generic)) {
      keywords.push(generic);
    } else {
      break;
    }
  }

  return keywords.slice(0, 5);
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

export default function CompanyPage({ params }: PageProps) {
  const { id } = use(params);
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [data, setData] = useState<BiznesinfoCompanyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLogoFailed(false);
    setLogoLoaded(false);
    fetch(`/api/biznesinfo/company/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: BiznesinfoCompanyResponse | null) => {
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
  const logoUrl = (companyMaybe?.logo_url || "").trim();
  const logoSrc = useMemo(() => {
    if (!logoUrl) return "";
    const companyId = companyMaybe?.source_id || "";
    if (!companyId) return "";

    const pathname = (() => {
      try {
        const u = new URL(logoUrl);
        return u.pathname || "";
      } catch {
        return logoUrl.split("?")[0] || "";
      }
    })();

    if (!pathname.startsWith("/images/")) return "";
    return `/api/biznesinfo/logo?id=${encodeURIComponent(companyId)}&path=${encodeURIComponent(pathname)}`;
  }, [companyMaybe?.source_id, logoUrl]);

  const phones: BiznesinfoPhoneExt[] = useMemo(() => {
    if (!companyMaybe) return [];
    if (companyMaybe.phones_ext && companyMaybe.phones_ext.length > 0) return companyMaybe.phones_ext;
    return (companyMaybe.phones || []).map((number) => ({ number, labels: [] as string[] }));
  }, [companyMaybe]);

  // Separate regular websites from social media links (must be above conditional returns to keep hooks order stable)
  const { websites: regularWebsites, socials } = useMemo(
    () => separateWebsitesAndSocials(companyMaybe?.websites),
    [companyMaybe?.websites]
  );

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

  const company = data.company;
  const favorite = isFavorite(company.source_id);

  const primaryCategory = company.categories?.[0] ?? null;
  const primaryRubric = company.rubrics?.[0] ?? null;

  const icon = primaryCategory?.slug ? BIZNESINFO_CATEGORY_ICONS[primaryCategory.slug] || "🏢" : "🏢";
  const showLogo = Boolean(logoUrl) && !logoFailed;

  const primaryPhone = phones?.[0]?.number || "";
  const primaryEmail = company.emails?.[0] || "";

  const aboutText = (BIZNESINFO_ABOUT_OVERRIDES[company.source_id] || "").trim() || generateUniqueDescription(company);

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
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white pt-6 pb-8">
          <div className="w-full px-4">
            {/* Logo - centered at top */}
            <div className="flex justify-center mb-4">
              <div className="w-20 h-20 bg-white rounded-xl shadow-lg flex items-center justify-center overflow-hidden">
                {showLogo ? (
                  <div className="w-full h-full relative flex items-center justify-center">
                    <span
                      className={`text-3xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}
                    >
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
                ) : (
                  <span className="text-3xl">{icon}</span>
                )}
              </div>
            </div>

            {/* Company name - below logo */}
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-center tracking-wide" style={{ wordSpacing: '0.3em' }}>
                {company.name}
              </h1>
              {/* Rubric under company name - smaller and less contrasting */}
              <p className="text-pink-200/80 mt-2 text-center text-base md:text-lg font-normal">
                {primaryCategory ? primaryCategory.name : ""}
                {primaryRubric ? ` → ${primaryRubric.name}` : ""}
                {company.city ? ` • ${company.city}` : ""}
              </p>
            </div>

            {/* Favorite button - right aligned */}
            <div className="w-full flex justify-end">
              <button
                onClick={() => toggleFavorite(company.source_id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  favorite ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <svg
                  className="w-4 h-4"
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
                <span>{favorite ? t("favorites.remove") : t("favorites.add")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-6">
              {/* Contacts with Logo */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  {t("company.contacts")}
                </h2>

                <div className="flex flex-col md:flex-row gap-6">
                  {/* Contacts - full width now that logo is in header */}
                  <div className="flex-1 space-y-4">
                  {/* Regular websites (not social media) */}
                  {regularWebsites.length > 0 && (
                    <div>
                      <div className="text-gray-500 text-sm mb-1">{t("company.website")}</div>
                      <div className="space-y-1">
                        {regularWebsites.map((w) => (
                          <div key={w} className="flex items-center gap-2">
                            <span className="text-[#820251]">🌐</span>
                            <a
                              href={w}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#820251] font-bold hover:underline truncate"
                            >
                              {displayUrl(w)}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Social media links - separate section */}
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
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {company.emails && company.emails.length > 0 && (
                    <div>
                      <div className="text-gray-500 text-sm mb-1">{t("company.email")}</div>
                      <div className="space-y-1">
                        {company.emails.map((e) => (
                          <div key={e} className="flex items-center gap-2">
                            <span className="text-[#820251]">✉️</span>
                            <a
                              href={`https://mail.yandex.ru/compose?to=${encodeURIComponent(e)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#820251] hover:underline truncate"
                            >
                              {e}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {phones && phones.length > 0 && (
                    <div>
                      <div className="text-gray-500 text-sm mb-2">{t("company.phone")}</div>
                      <div className="space-y-2">
                        {phones.map((p, idx) => (
                          <div key={`${p.number}-${idx}`} className="flex items-start gap-2">
                            <span className="text-[#820251] mt-0.5">📞</span>
                            <div>
                              <a href={`tel:${p.number}`} className="text-[#820251] font-bold hover:underline">
                                {p.number}
                              </a>
                              {p.labels && p.labels.length > 0 && (
                                <div className="text-sm text-gray-500">{p.labels.join(", ")}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {company.address && (
                    <div>
                      <div className="text-gray-500 text-sm mb-1">{t("company.address")}</div>
                      <div className="flex items-start gap-2">
                        <span className="text-[#820251]">📍</span>
                        <span className="text-gray-700">{company.address}</span>
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
                          {company.work_hours.work_time && <div>{company.work_hours.work_time}</div>}
                          {company.work_hours.break_time && <div>Перерыв: {company.work_hours.break_time}</div>}
                          {company.work_hours.status && <div className="text-sm text-gray-500">{company.work_hours.status}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-3 mt-6">
                  <a
                    href={primaryPhone ? `tel:${primaryPhone}` : undefined}
                    className="flex-1 min-w-[140px] bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors text-center"
                  >
                    {t("company.call")}
                  </a>
                  <button
                    onClick={() => setMessageModalOpen(true)}
                    className="flex-1 min-w-[140px] border-2 border-[#820251] text-[#820251] py-3 rounded-lg font-semibold hover:bg-[#820251] hover:text-white transition-colors"
                  >
                    {t("company.write")}
                  </button>
                  <div className="w-full sm:w-auto">
                    <AIAssistant companyName={company.name} companyId={company.source_id} isActive={false} />
                  </div>
                </div>
              </div>

              {/* About */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  {t("company.about")}
                </h2>
                <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                  {aboutText || "—"}
                </p>
              </div>

              {/* Additional Services / Rubrics */}
              {company.rubrics && company.rubrics.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Услуги компании
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {company.rubrics.map((rubric, idx) => {
                      const catSlug = rubric.category_slug;
                      const rubricSubSlug = rubric.slug.split("/").slice(1).join("/");
                      const rubricHref = catSlug && rubricSubSlug ? `/catalog/${catSlug}/${rubricSubSlug}` : `/catalog/${catSlug}`;
                      const catIcon = catSlug ? BIZNESINFO_CATEGORY_ICONS[catSlug] || "📋" : "📋";

                      return (
                        <Link
                          key={`${rubric.slug}-${idx}`}
                          href={rubricHref}
                          className="group flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-gray-50 to-white border border-gray-100 hover:border-[#820251]/30 hover:shadow-md transition-all"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#820251]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#820251]/20 transition-colors">
                            <span className="text-lg">{catIcon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-800 group-hover:text-[#820251] transition-colors truncate">
                              {rubric.name}
                            </div>
                            <div className="text-xs text-gray-400 truncate">
                              {rubric.category_name}
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 group-hover:text-[#820251] transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Keywords / SEO Tags */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  Ключевые слова
                </h2>
                <div className="flex flex-wrap gap-2">
                  {generateKeywords(company).map((keyword, idx) => (
                    <Link
                      key={idx}
                      href={`/?q=${encodeURIComponent(keyword)}`}
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
            </div>

          </div>

          {/* Map */}
          {hasGeo && lat != null && lng != null && (
            <div className="mt-8 bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  {t("company.locationOnMap")}
                </h2>
                <a
                  href={`https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#820251] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#7a0150] transition-colors text-sm"
                >
                  {t("company.buildRoute")}
                </a>
              </div>
              <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                <iframe
                  src={`https://yandex.ru/map-widget/v1/?ll=${lng}%2C${lat}&z=16&pt=${lng}%2C${lat}%2Cpm2rdm`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  allowFullScreen
                  className="w-full h-full"
                ></iframe>
              </div>
            </div>
          )}

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
