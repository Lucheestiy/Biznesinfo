"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AIAssistant from "@/components/AIAssistant";
import MessageModal from "@/components/MessageModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import type { IbizCompanyResponse, IbizPhoneExt, IbizPhoto, IbizService, IbizProduct, IbizReview } from "@/lib/ibiz/types";
import { IBIZ_CATEGORY_ICONS } from "@/lib/ibiz/icons";
import { IBIZ_ABOUT_OVERRIDES } from "@/lib/ibiz/aboutOverrides";

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
  const [data, setData] = useState<IbizCompanyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLogoFailed(false);
    setLogoLoaded(false);
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
  const logoUrl = (companyMaybe?.logo_url || "").trim();
  // Use local path directly if it starts with /, otherwise use proxy for external URLs
  const logoSrc = useMemo(() => {
    if (!logoUrl) return "";
    if (logoUrl.startsWith("/")) return logoUrl;
    return `/api/ibiz/logo?u=${encodeURIComponent(logoUrl)}`;
  }, [logoUrl]);

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

  const icon = primaryCategory?.slug ? IBIZ_CATEGORY_ICONS[primaryCategory.slug] || "🏢" : "🏢";
  const showLogo = Boolean(logoUrl) && !logoFailed;

  const primaryPhone = phones?.[0]?.number || "";
  const primaryEmail = company.emails?.[0] || "";

  // Priority: 1) company.about from API, 2) manual overrides, 3) auto-generated
  const aboutText = (company.about || "").trim() || (IBIZ_ABOUT_OVERRIDES[company.source_id] || "").trim() || generateUniqueDescription(company);

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

        {/* Hero Banner - like belarusinfo.by */}
        {company.hero_image ? (
          <div className="relative overflow-hidden">
            {/* Hero image with blur */}
            <div className="absolute inset-0 opacity-15">
              <div 
                className="absolute inset-0 bg-cover bg-center blur-sm"
                style={{ backgroundImage: `url(${company.hero_image})` }}
              />
            </div>
            {/* Beautiful gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#9a0660] via-[#820251] to-[#5a0138]" />
            {/* Decorative circles */}
            <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 rounded-full -translate-x-16 -translate-y-16" />
            <div className="absolute top-1/2 right-0 w-24 h-24 bg-white/5 rounded-full translate-x-12" />
            <div className="absolute bottom-0 left-1/4 w-40 h-40 bg-white/5 rounded-full translate-y-20" />
            
            {/* Content */}
            <div className="relative z-10 px-4 md:px-8 py-8 md:py-10 pb-24">
              <div className="max-w-5xl mx-auto text-center">
                {/* Large company name */}
                <h1 className="text-2xl md:text-4xl font-bold text-white mb-2 tracking-wide drop-shadow-lg">
                  {company.name}
                </h1>
                {/* Main rubric - smaller and less contrast */}
                {primaryRubric && (
                  <p className="text-white/60 text-sm md:text-base mb-4 font-medium">
                    {primaryRubric.name}
                  </p>
                )}
                {/* Divider line */}
                <div className="flex justify-center mb-5">
                  <div className="w-24 h-1 bg-white/40 rounded-full" />
                </div>
                {/* Description */}
                {company.description && (
                  <p className="text-white/90 text-sm md:text-base max-w-4xl mx-auto leading-relaxed">
                    {company.description}
                  </p>
                )}
              </div>
            </div>
            
            {/* Logo positioned on the border */}
            <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-1/2 z-20">
              <div className="w-36 h-40 md:w-40 md:h-44 bg-white rounded-lg flex items-center justify-center overflow-hidden
                border-4 border-white shadow-[0_15px_50px_rgba(0,0,0,0.35),0_0_60px_rgba(177,10,120,0.25)]
                hover:shadow-[0_20px_70px_rgba(0,0,0,0.45),0_0_100px_rgba(177,10,120,0.35)]
                transition-all duration-500 transform hover:-translate-y-3 hover:scale-[1.02]">
                {showLogo ? (
                  <div className="w-full h-full relative flex items-center justify-center p-2">
                    <span className={`text-5xl md:text-6xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}>
                      {icon}
                    </span>
                    <img
                      src={logoSrc}
                      alt={company.name}
                      className={`absolute inset-2 w-[calc(100%-1rem)] h-[calc(100%-1rem)] object-contain transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                      decoding="async"
                      loading="eager"
                      onLoad={() => setLogoLoaded(true)}
                      onError={() => setLogoFailed(true)}
                    />
                  </div>
                ) : (
                  <span className="text-5xl md:text-6xl">{icon}</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white pt-8 pb-20 md:pt-10 md:pb-24">
            {/* Decorative circles */}
            <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 rounded-full -translate-x-16 -translate-y-16" />
            <div className="absolute top-1/2 right-0 w-24 h-24 bg-white/5 rounded-full translate-x-12" />
            <div className="absolute bottom-0 left-1/4 w-40 h-40 bg-white/5 rounded-full translate-y-20" />

            <div className="w-full px-4 relative z-10">
              <div className="mb-2">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-center tracking-wide" style={{ wordSpacing: '0.2em' }}>
                  {company.name}
                </h1>
                {/* Rubric below company name - less contrast */}
                {primaryRubric && (
                  <p className="text-pink-200/80 mt-2 text-sm md:text-base text-center font-medium">
                    {primaryRubric.name}
                  </p>
                )}
                {/* Category and city - more subtle */}
                <p className="text-pink-200/50 mt-1 text-xs text-center">
                  {primaryCategory ? primaryCategory.name : ""}
                  {company.city ? ` • ${company.city}` : ""}
                </p>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => toggleFavorite(company.source_id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    favorite ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  <svg className="w-4 h-4" fill={favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  <span>{favorite ? t("favorites.remove") : t("favorites.add")}</span>
                </button>
              </div>
            </div>

            {/* Logo positioned on the border - overlapping effect */}
            <div className="absolute left-1/2 transform -translate-x-1/2 translate-y-1/2 z-20">
              <div className="w-36 h-40 md:w-40 md:h-44 bg-white rounded-lg flex items-center justify-center overflow-hidden
                border-4 border-white shadow-[0_15px_50px_rgba(0,0,0,0.35),0_0_60px_rgba(177,10,120,0.25),0_0_100px_rgba(177,10,120,0.15)]
                hover:shadow-[0_20px_70px_rgba(0,0,0,0.45),0_0_100px_rgba(177,10,120,0.35),0_0_150px_rgba(177,10,120,0.2)]
                transition-all duration-500 transform hover:-translate-y-3 hover:scale-[1.02]">
                {showLogo ? (
                  <div className="w-full h-full relative flex items-center justify-center p-2">
                    <span className={`text-5xl md:text-6xl transition-opacity duration-200 ${logoLoaded ? "opacity-0" : "opacity-100"}`}>
                      {icon}
                    </span>
                    <img
                      src={logoSrc}
                      alt={company.name}
                      className={`absolute inset-2 w-[calc(100%-1rem)] h-[calc(100%-1rem)] object-contain transition-opacity duration-200 ${logoLoaded ? "opacity-100" : "opacity-0"}`}
                      decoding="async"
                      loading="eager"
                      onLoad={() => setLogoLoaded(true)}
                      onError={() => setLogoFailed(true)}
                    />
                  </div>
                ) : (
                  <span className="text-5xl md:text-6xl">{icon}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="container mx-auto pt-20 md:pt-24 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-6">
              {/* Contacts Card */}
              <div className="bg-white rounded-lg shadow-sm p-6 pt-8">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  {t("company.contacts")}
                </h2>

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

              {/* About - Beautifully formatted (NO images, like belarusinfo.by) */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-6 bg-[#820251] rounded"></span>
                  {t("company.about")}
                </h2>
                
                {/* Render about text with formatting */}
                <div className="text-gray-700 leading-relaxed space-y-4">
                  {aboutText.split('\n\n').map((block, blockIdx) => {
                    // Check if it's a header (starts with **)
                    if (block.startsWith('**') && block.includes(':**')) {
                      const headerText = block.replace(/\*\*/g, '').replace(':', '');
                      return (
                        <div key={blockIdx} className="mt-6 first:mt-0">
                          <h3 className="text-lg font-bold text-[#820251] mb-3 flex items-center gap-2">
                            <span className="w-8 h-8 bg-[#820251]/10 rounded-lg flex items-center justify-center">
                              {headerText.includes('преимущества') || headerText.includes('выбирают') ? '⭐' : headerText.includes('Направления') || headerText.includes('деятельности') ? '🎯' : '📋'}
                            </span>
                            {headerText}
                          </h3>
                        </div>
                      );
                    }
                    
                    // Check if it's a list (starts with •)
                    if (block.includes('•')) {
                      const items = block.split('\n').filter(line => line.trim().startsWith('•'));
                      return (
                        <div key={blockIdx} className="space-y-2">
                          {items.map((item, itemIdx) => {
                            const text = item.replace('•', '').trim();
                            const [title, description] = text.includes(' — ') ? text.split(' — ') : [text, ''];
                            return (
                              <div key={itemIdx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                <span className="w-6 h-6 bg-[#820251] text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">✓</span>
                                <div>
                                  <span className="font-medium text-gray-800">{title}</span>
                                  {description && <span className="text-gray-600"> — {description}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    
                    // Regular paragraph
                    if (block.trim()) {
                      return (
                        <p key={blockIdx} className="text-gray-700">
                          {block.split('**').map((part, i) => 
                            i % 2 === 1 ? <strong key={i} className="text-gray-900">{part}</strong> : part
                          )}
                        </p>
                      );
                    }
                    return null;
                  })}
                </div>
                
{/* Final CTA - only for msu-23 */}
                {id === "msu-23" && (
                  <div className="mt-6 p-4 bg-gradient-to-r from-[#820251]/10 to-[#820251]/5 rounded-xl border border-[#820251]/20">
                    <p className="text-[#820251] font-semibold text-center">
                      🏗️ Доверьте строительство профессионалам!
                    </p>
                  </div>
                )}
              </div>

              {/* Services with Images - like belarusinfo.by "Услуги" section */}
              {company.services_list && company.services_list.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Услуги
                  </h2>
                  <p className="text-gray-500 text-sm mb-4">Оказание услуг организациям и физическим лицам</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {company.services_list.map((service, idx) => (
                      <div key={idx} className="group rounded-xl overflow-hidden border border-gray-200 hover:border-[#820251]/50 hover:shadow-lg transition-all bg-white">
                        {service.image_url && (
                          <a href={service.image_url} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] overflow-hidden bg-gray-100">
                            <img
                              src={service.image_url}
                              alt={service.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          </a>
                        )}
                        <div className="p-4">
                          <h4 className="font-semibold text-gray-800 group-hover:text-[#820251] transition-colors">
                            {service.name}
                          </h4>
                          {service.description && (
                            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{service.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                      const catIcon = catSlug ? IBIZ_CATEGORY_ICONS[catSlug] || "📋" : "📋";

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

              {/* Photo Gallery */}
              {company.photos && company.photos.length > 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Фотогалерея
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {company.photos.map((photo, idx) => (
                      <a
                        key={idx}
                        href={photo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group aspect-square rounded-lg overflow-hidden bg-gray-100 hover:shadow-lg transition-all"
                      >
                        <img
                          src={photo.url}
                          alt={photo.alt || `Фото ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Фотогалерея
                  </h2>
                  <div className="text-center py-8 text-gray-400">
                    <div className="text-4xl mb-2">📷</div>
                    <p>Фотографий пока нет</p>
                  </div>
                </div>
              )}

              {/* Products */}
              {company.products && company.products.length > 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Товары
                  </h2>
                  <p className="text-gray-500 text-sm mb-4">Каталог основной продукции</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {company.products.map((product, idx) => (
                      <div key={idx} className="group rounded-xl overflow-hidden border border-gray-100 hover:border-[#820251]/30 hover:shadow-lg transition-all">
                        {product.image_url && (
                          <div className="aspect-square overflow-hidden bg-gray-100">
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div className="p-3">
                          <h3 className="font-medium text-gray-800 text-sm group-hover:text-[#820251] transition-colors line-clamp-2">
                            {product.name}
                          </h3>
                          {product.price && (
                            <p className="text-[#820251] font-bold mt-1">{product.price}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Товары
                  </h2>
                  <p className="text-gray-500 text-sm mb-4">Каталог основной продукции</p>
                  <div className="text-center py-8 text-gray-400">
                    <div className="text-4xl mb-2">📦</div>
                    <p>Товаров не найдено</p>
                  </div>
                </div>
              )}

              {/* Reviews */}
              {company.reviews && company.reviews.length > 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Отзывы
                  </h2>
                  <div className="space-y-4">
                    {company.reviews.map((review, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-full bg-[#820251]/10 flex items-center justify-center text-[#820251] font-bold">
                            {review.author.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-800">{review.author}</div>
                            {review.date && <div className="text-xs text-gray-400">{review.date}</div>}
                          </div>
                          {review.rating && (
                            <div className="ml-auto flex items-center gap-1">
                              {[...Array(5)].map((_, i) => (
                                <span key={i} className={i < review.rating! ? "text-yellow-400" : "text-gray-300"}>★</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-gray-600">{review.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="w-1 h-6 bg-[#820251] rounded"></span>
                    Отзывы
                  </h2>
                  <div className="text-center py-8 text-gray-400">
                    <div className="text-4xl mb-2">💬</div>
                    <p>Отзывов не найдено</p>
                  </div>
                </div>
              )}
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
