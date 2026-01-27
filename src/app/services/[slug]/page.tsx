"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import { services } from "@/components/ServicesBlock";

// Article content for each service
const serviceArticles: Record<string, {
  benefits: string[];
  details: string[];
  features: string[];
}> = {
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

export default function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { t } = useLanguage();

  const service = services.find(s => s.slug === slug);
  const article = serviceArticles[slug];

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
                  href="https://mail.yandex.ru/compose?to=surdoe@yandex.ru&subject=Заявка на услугу: "
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
