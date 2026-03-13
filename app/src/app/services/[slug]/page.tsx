"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import { services } from "@/components/ServicesBlock";

// Article content for each service
type ServiceArticle = {
  benefits: string[];
  details: string[];
  features: string[];
};

const serviceArticlesRu: Record<string, ServiceArticle> = {
  "portal-placement": {
    benefits: [
      "Повышение видимости вашей компании в интернете",
      "Привлечение целевых клиентов через AI-ассистента",
      "Автоматическая обработка заявок от потенциальных клиентов",
      "Размещение в тематических рубриках и категориях",
      "SEO-оптимизация карточки компании",
    ],
    details: [
      "Наш интерактивный бизнес-портал — это современная платформа, где клиенты могут найти вашу компанию через умный поиск или AI-ассистента. В отличие от обычных справочников, наш портал активно помогает клиентам находить именно те услуги, которые им нужны.",
      "AI-ассистент анализирует запросы пользователей и автоматически направляет заявки подходящим компаниям. Это означает, что вы получаете только целевых клиентов, заинтересованных в ваших услугах.",
      "Карточка вашей компании будет содержать всю необходимую информацию: описание услуг, контакты, фотографии, отзывы клиентов и многое другое.",
    ],
    features: [
      "Подробная карточка компании с фото и описанием",
      "Интеграция с AI-ассистентом для получения заявок",
      "Статистика просмотров и обращений",
      "Возможность добавления акций и спецпредложений",
      "Мобильная версия для всех устройств",
    ],
  },
  "marketing-moves": {
    benefits: [
      "Увеличение продаж до 40% за счёт точного таргетинга",
      "Выделение среди конкурентов уникальным позиционированием",
      "Формирование лояльной клиентской базы",
      "Оптимизация рекламного бюджета",
      "Измеримые результаты каждой кампании",
    ],
    details: [
      "Маркетинговые ходы — это комплекс стратегических решений, направленных на увеличение продаж вашего предприятия. Мы анализируем вашу целевую аудиторию, конкурентов и рынок, чтобы разработать эффективную стратегию продвижения.",
      "Наши специалисты помогут вам выстроить воронку продаж, настроить систему привлечения и удержания клиентов, а также автоматизировать маркетинговые процессы.",
      "Мы используем только проверенные инструменты и методики, которые дают измеримый результат. Каждая кампания сопровождается детальной аналитикой и отчётностью.",
    ],
    features: [
      "Анализ целевой аудитории и конкурентов",
      "Разработка уникального торгового предложения",
      "Создание воронки продаж",
      "A/B тестирование рекламных материалов",
      "Ежемесячная отчётность и корректировка стратегии",
    ],
  },
  "lead-generation": {
    benefits: [
      "Постоянный поток целевых заявок",
      "Снижение стоимости привлечения клиента",
      "Качественные лиды, готовые к покупке",
      "Прозрачная аналитика по каждому каналу",
      "Масштабируемость результатов",
    ],
    details: [
      "Лидогенерация — это систематический процесс привлечения потенциальных клиентов через оптимизированные рекламные каналы. Мы настраиваем комплексную систему, которая работает 24/7 и приводит вам новых клиентов.",
      "Используем мультиканальный подход: контекстная реклама, таргетированная реклама в социальных сетях, email-маркетинг, SEO и контент-маркетинг. Каждый канал оптимизируется для максимальной эффективности.",
      "Все заявки проходят квалификацию, чтобы вы получали только тех клиентов, которые действительно заинтересованы в ваших услугах и готовы к сотрудничеству.",
    ],
    features: [
      "Настройка рекламных кампаний под ключ",
      "Создание посадочных страниц высокой конверсии",
      "Интеграция с CRM-системой",
      "Автоматическая квалификация лидов",
      "Ретаргетинг и работа с тёплой аудиторией",
    ],
  },
  "process-automation": {
    benefits: [
      "Сокращение рутинных задач до 80%",
      "Повышение скорости обработки заявок",
      "Снижение количества ошибок",
      "Освобождение времени сотрудников для важных задач",
      "Повышение конверсии за счёт быстрой реакции",
    ],
    details: [
      "Автоматизация бизнес-процессов позволяет снизить нагрузку на команду и повысить эффективность работы. Мы анализируем ваши текущие процессы и находим точки, где автоматизация даст максимальный эффект.",
      "Внедряем современные инструменты: автоматические воронки продаж, триггерные рассылки, чат-боты для обработки типовых запросов, системы автоматического распределения заявок между менеджерами.",
      "После внедрения вы получаете детальную документацию и обучение сотрудников работе с новыми инструментами.",
    ],
    features: [
      "Аудит текущих бизнес-процессов",
      "Проектирование автоматизированных воронок",
      "Настройка триггерных сценариев",
      "Интеграция с существующими системами",
      "Обучение команды и техподдержка",
    ],
  },
  "crm-systems": {
    benefits: [
      "Все клиенты и сделки в одном месте",
      "История взаимодействий с каждым клиентом",
      "Автоматические напоминания о задачах",
      "Аналитика продаж в реальном времени",
      "Контроль работы отдела продаж",
    ],
    details: [
      "CRM-система — это центр управления вашими клиентами и продажами. Мы поможем выбрать и внедрить систему, которая идеально подходит для вашего бизнеса: Битрикс24, AmoCRM, или другие решения.",
      "Настроим систему под ваши процессы: этапы воронки продаж, карточки клиентов, автоматические действия, интеграции с телефонией, мессенджерами и почтой.",
      "Проведём обучение сотрудников и обеспечим техническую поддержку на этапе внедрения и после.",
    ],
    features: [
      "Подбор оптимальной CRM под ваш бизнес",
      "Настройка воронки продаж и этапов сделок",
      "Интеграция с телефонией и мессенджерами",
      "Настройка автоматических задач и напоминаний",
      "Создание отчётов и дашбордов",
    ],
  },
  "website-creation": {
    benefits: [
      "Профессиональный сайт, работающий на продажи",
      "Адаптивный дизайн для всех устройств",
      "Высокая скорость загрузки",
      "SEO-оптимизация с самого начала",
      "Удобная система управления контентом",
    ],
    details: [
      "Создаём современные сайты, которые работают на ваш бизнес: корпоративные сайты, продающие лендинги, интернет-магазины. Каждый проект разрабатывается с учётом специфики вашего бизнеса и целевой аудитории.",
      "Используем проверенные технологии и фреймворки, которые обеспечивают стабильную работу, безопасность и лёгкое масштабирование сайта в будущем.",
      "В стоимость входит базовая SEO-оптимизация, настройка аналитики и обучение работе с сайтом.",
    ],
    features: [
      "Уникальный дизайн под ваш бренд",
      "Мобильная адаптация",
      "Интеграция с платёжными системами",
      "Подключение CRM и аналитики",
      "Техподдержка и доработки",
    ],
  },
  "seo-promotion": {
    benefits: [
      "Органический трафик без постоянных затрат на рекламу",
      "Высокие позиции в Яндекс и Google",
      "Целевые посетители, готовые к покупке",
      "Долгосрочный эффект от инвестиций",
      "Повышение узнаваемости бренда",
    ],
    details: [
      "SEO-продвижение — это комплекс работ по оптимизации сайта для поисковых систем. Мы выводим сайты в топ Яндекса и Google по целевым запросам, привлекая бесплатный органический трафик.",
      "Работаем комплексно: техническая оптимизация, работа с контентом, наращивание ссылочной массы, улучшение поведенческих факторов. Каждый этап документируется и согласовывается.",
      "Предоставляем ежемесячные отчёты о позициях, трафике и достигнутых результатах.",
    ],
    features: [
      "Полный SEO-аудит сайта",
      "Сбор и кластеризация семантического ядра",
      "Техническая оптимизация",
      "Написание и оптимизация контента",
      "Работа с внешними факторами",
    ],
  },
  "context-ads": {
    benefits: [
      "Быстрый запуск и первые заявки уже сегодня",
      "Точный таргетинг на целевую аудиторию",
      "Гибкое управление бюджетом",
      "Измеримый ROI каждой кампании",
      "Масштабирование успешных кампаний",
    ],
    details: [
      "Контекстная реклама — самый быстрый способ привлечь клиентов из интернета. Настраиваем рекламу в Яндекс.Директ, Google Ads, рекламу в социальных сетях (VK, Telegram, Meta*).",
      "Создаём эффективные рекламные кампании: от анализа конкурентов и подбора ключевых слов до создания объявлений и посадочных страниц. Постоянно оптимизируем кампании для снижения стоимости заявки.",
      "Прозрачная отчётность: вы видите, сколько потрачено, сколько заявок получено и какова стоимость каждой заявки.",
    ],
    features: [
      "Настройка рекламы в Яндекс.Директ и Google Ads",
      "Таргетированная реклама в соцсетях",
      "Создание продающих объявлений",
      "Настройка ретаргетинга",
      "Еженедельная оптимизация и отчётность",
    ],
  },
  "ai-bots": {
    benefits: [
      "Обработка заявок 24/7 без участия менеджеров",
      "Мгновенные ответы на типовые вопросы",
      "Снижение нагрузки на службу поддержки до 70%",
      "Повышение конверсии за счёт быстрой реакции",
      "Сбор и квалификация лидов в автоматическом режиме",
    ],
    details: [
      "AI-боты и чат-боты — это умные помощники, которые работают в Telegram, WhatsApp, на вашем сайте и в других каналах. Они отвечают на вопросы клиентов, принимают заявки, записывают на услуги и многое другое.",
      "Мы создаём ботов на основе современных AI-технологий, которые понимают естественный язык и могут вести осмысленный диалог с клиентами. Бот интегрируется с вашей CRM и другими системами.",
      "После запуска бот продолжает обучаться на основе реальных диалогов, становясь всё умнее и эффективнее.",
    ],
    features: [
      "Разработка бота под ваши задачи",
      "Интеграция с Telegram, WhatsApp, сайтом",
      "Подключение к CRM и базам данных",
      "Обучение бота на ваших FAQ и сценариях",
      "Аналитика диалогов и постоянное улучшение",
    ],
  },
};

const serviceArticlesEn: Record<string, ServiceArticle> = {
  "portal-placement": {
    benefits: [
      "Increase your company's visibility online",
      "Attract target clients through the AI assistant",
      "Automatic processing of incoming leads from potential clients",
      "Placement in relevant rubrics and categories",
      "SEO optimization of your company profile",
    ],
    details: [
      "Our interactive business portal is a modern platform where clients can find your company through smart search and the AI assistant. Unlike traditional directories, our portal actively helps users find exactly the services they need.",
      "The AI assistant analyzes user requests and automatically routes leads to suitable companies. This means you receive high-intent inquiries from people who are already interested in your services.",
      "Your company profile includes all key information: service descriptions, contacts, photos, customer reviews, and more.",
    ],
    features: [
      "Detailed company profile with photos and description",
      "AI assistant integration for lead delivery",
      "Views and inquiries analytics",
      "Ability to publish promotions and special offers",
      "Mobile-friendly experience on all devices",
    ],
  },
  "marketing-moves": {
    benefits: [
      "Increase sales by up to 40% through precise targeting",
      "Stand out from competitors with clear positioning",
      "Build a loyal customer base",
      "Optimize your advertising budget",
      "Measurable results for every campaign",
    ],
    details: [
      "Marketing tactics are a set of strategic decisions focused on increasing your company's sales. We analyze your target audience, competitors, and market to design an effective promotion strategy.",
      "Our specialists help you build a sales funnel, set up customer acquisition and retention systems, and automate marketing workflows.",
      "We use proven tools and methods that deliver measurable outcomes. Every campaign is supported by detailed analytics and reporting.",
    ],
    features: [
      "Target audience and competitor analysis",
      "Unique value proposition development",
      "Sales funnel design",
      "A/B testing of advertising materials",
      "Monthly reporting and strategy adjustments",
    ],
  },
  "lead-generation": {
    benefits: [
      "Steady flow of qualified leads",
      "Lower customer acquisition cost",
      "High-quality leads ready to buy",
      "Transparent analytics for each channel",
      "Scalable, repeatable results",
    ],
    details: [
      "Lead generation is a systematic process of attracting potential clients through optimized ad channels. We build a comprehensive setup that works 24/7 and consistently brings you new leads.",
      "We use a multichannel approach: search ads, social media targeting, email marketing, SEO, and content marketing. Each channel is continuously optimized for maximum efficiency.",
      "All incoming leads are qualified so your team receives contacts that are genuinely interested and ready to collaborate.",
    ],
    features: [
      "End-to-end ad campaign setup",
      "High-converting landing page creation",
      "CRM integration",
      "Automated lead qualification",
      "Retargeting and warm audience nurturing",
    ],
  },
  "process-automation": {
    benefits: [
      "Reduce routine tasks by up to 80%",
      "Faster lead processing speed",
      "Fewer operational errors",
      "Free up team time for high-value work",
      "Higher conversion through faster response",
    ],
    details: [
      "Business process automation reduces team workload and increases overall efficiency. We analyze your current workflows and identify where automation creates the biggest impact.",
      "We implement modern tools: automated sales funnels, trigger-based communications, chatbots for standard requests, and automatic lead distribution across managers.",
      "After implementation, you receive detailed documentation and team training on how to use the new tools effectively.",
    ],
    features: [
      "Audit of current business processes",
      "Automated funnel architecture design",
      "Trigger workflow setup",
      "Integration with existing systems",
      "Team onboarding and technical support",
    ],
  },
  "crm-systems": {
    benefits: [
      "All clients and deals in one place",
      "Complete interaction history for each client",
      "Automatic reminders for tasks and follow-ups",
      "Real-time sales analytics",
      "Better control of sales team performance",
    ],
    details: [
      "A CRM system is the central hub for managing clients and sales. We help you select and implement the best-fit solution for your business: Bitrix24, AmoCRM, or alternatives.",
      "We tailor the system to your workflow: pipeline stages, client cards, automation rules, and integrations with telephony, messengers, and email.",
      "We also train your team and provide technical support during and after implementation.",
    ],
    features: [
      "Best-fit CRM selection for your business",
      "Pipeline and deal stage configuration",
      "Telephony and messenger integrations",
      "Automated tasks and reminders setup",
      "Reports and dashboard creation",
    ],
  },
  "website-creation": {
    benefits: [
      "Professional website built to drive sales",
      "Responsive design for all devices",
      "High loading speed",
      "SEO optimization from day one",
      "Convenient content management",
    ],
    details: [
      "We build modern websites that support your business goals: corporate sites, high-converting landing pages, and online stores. Every project is tailored to your niche and audience.",
      "We use reliable technologies and frameworks to ensure stability, security, and easy future scaling.",
      "The package includes basic SEO setup, analytics configuration, and team onboarding for site management.",
    ],
    features: [
      "Unique design aligned with your brand",
      "Mobile adaptation",
      "Payment system integrations",
      "CRM and analytics integration",
      "Support and iterative improvements",
    ],
  },
  "seo-promotion": {
    benefits: [
      "Organic traffic without permanent ad spend",
      "Higher rankings in Yandex and Google",
      "Relevant visitors ready to buy",
      "Long-term return on investment",
      "Improved brand awareness",
    ],
    details: [
      "SEO promotion is a comprehensive set of actions to optimize your website for search engines. We move websites to top positions in Yandex and Google for target queries and attract organic traffic.",
      "Our approach includes technical optimization, content improvements, link growth, and behavioral factor enhancement. Every step is documented and aligned with you.",
      "You receive monthly reports on rankings, traffic, and achieved performance.",
    ],
    features: [
      "Full website SEO audit",
      "Keyword research and clustering",
      "Technical optimization",
      "Content writing and optimization",
      "Off-page SEO work",
    ],
  },
  "context-ads": {
    benefits: [
      "Fast launch and first leads the same day",
      "Precise targeting of your ideal audience",
      "Flexible budget management",
      "Measurable ROI for every campaign",
      "Scalable winning campaigns",
    ],
    details: [
      "Context ads are the fastest way to attract clients online. We set up advertising in Yandex Direct, Google Ads, and social platforms (VK, Telegram, Meta*).",
      "We build effective campaigns end-to-end: from competitor analysis and keyword research to ad copy and landing pages. Campaigns are continuously optimized to reduce cost per lead.",
      "Transparent reporting: you always see spend, number of leads, and the cost of each lead.",
    ],
    features: [
      "Yandex Direct and Google Ads setup",
      "Targeted social media advertising",
      "Conversion-focused ad copy creation",
      "Retargeting setup",
      "Weekly optimization and reporting",
    ],
  },
  "ai-bots": {
    benefits: [
      "24/7 lead handling without manual effort",
      "Instant answers to common questions",
      "Reduce support workload by up to 70%",
      "Higher conversion through fast response",
      "Automated lead capture and qualification",
    ],
    details: [
      "AI bots and chatbots are smart assistants for Telegram, WhatsApp, your website, and other channels. They answer client questions, collect requests, book services, and more.",
      "We build bots powered by modern AI technologies that understand natural language and can maintain meaningful conversations. Bots integrate with your CRM and other systems.",
      "After launch, bots continue to improve based on real dialogues, becoming smarter and more effective over time.",
    ],
    features: [
      "Custom bot development for your goals",
      "Integration with Telegram, WhatsApp, and website",
      "Connection to CRM and data sources",
      "Training on your FAQs and scenarios",
      "Conversation analytics and continuous optimization",
    ],
  },
};

export default function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { t, language } = useLanguage();

  const service = services.find(s => s.slug === slug);
  const article = (language === "en" ? serviceArticlesEn[slug] : undefined) ?? serviceArticlesRu[slug];

  if (!service || !article) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Hero Section */}
        <div className="bg-gradient-to-br from-[#b10a78] to-[#7a0150] text-white py-12 md:py-16">
          <div className="container mx-auto px-4">
            <Link
              href="/#services"
              className="inline-flex items-center gap-2 text-pink-200 hover:text-white mb-6 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t("services.backToServices")}
            </Link>

            <div className="flex items-center gap-6">
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center shadow-xl">
                <span className="text-4xl md:text-5xl">{service.icon}</span>
              </div>
              <div>
                <h1 className="text-2xl md:text-4xl font-bold mb-2">
                  {t(service.nameKey)}
                </h1>
                <p className="text-pink-200 text-lg">
                  {t(service.descKey)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Article Content */}
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-4xl mx-auto">

            {/* Benefits Section */}
            <section className="mb-12">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#820251] to-[#b10a78] flex items-center justify-center text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {t("services.article.benefits")}
              </h2>
              <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
                <ul className="space-y-4">
                  {article.benefits.map((benefit, idx) => (
                    <li key={idx} className="flex items-start gap-4">
                      <span className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                      <span className="text-gray-700">{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Details Section */}
            <section className="mb-12">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#820251] to-[#b10a78] flex items-center justify-center text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                {t("services.article.details")}
              </h2>
              <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 space-y-6">
                {article.details.map((paragraph, idx) => (
                  <p key={idx} className="text-gray-700 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>

            {/* Features Section */}
            <section className="mb-12">
              <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#820251] to-[#b10a78] flex items-center justify-center text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </span>
                {t("services.article.features")}
              </h2>
              <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {article.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-[#820251]/5 transition-colors">
                      <span className="w-8 h-8 rounded-lg bg-[#820251] flex items-center justify-center text-white text-sm font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-gray-700">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* CTA Section */}
            <section className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] rounded-2xl p-8 md:p-10 text-center">
              <h3 className="text-2xl font-bold text-white mb-4">
                {t("services.article.cta.title")}
              </h3>
              <p className="text-pink-200 mb-8 max-w-2xl mx-auto">
                {t("services.article.cta.description")}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={`https://mail.yandex.ru/compose?to=surdoe@yandex.ru&subject=${encodeURIComponent(`${t("services.article.cta.mailSubject")} ${t(service.nameKey)}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-yellow-400 text-[#820251] px-8 py-4 rounded-xl font-bold hover:bg-yellow-300 transition-colors shadow-lg hover:shadow-xl"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {t("services.article.cta.button")}
                </a>
                <Link
                  href="/#services"
                  className="inline-flex items-center justify-center gap-2 bg-white/10 text-white px-8 py-4 rounded-xl font-bold hover:bg-white/20 transition-colors border border-white/30"
                >
                  {t("services.article.cta.otherServices")}
                </Link>
              </div>
            </section>

          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
