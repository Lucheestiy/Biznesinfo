"use client";

import { useLanguage } from "@/contexts/LanguageContext";

interface Service {
  nameKey: string;
  descKey: string;
  icon: string;
}

const services: Service[] = [
  // Размещение на портале
  {
    nameKey: "services.analysis",
    descKey: "services.analysisDesc",
    icon: "🌐",
  },
  // Маркетинговые ходы
  {
    nameKey: "services.businessStatus",
    descKey: "services.businessStatusDesc",
    icon: "🎯",
  },
  // Маркетинг
  {
    nameKey: "services.leads",
    descKey: "services.leadsDesc",
    icon: "📈",
  },
  // Автоматизация бизнеса
  {
    nameKey: "services.processAutomation",
    descKey: "services.processAutomationDesc",
    icon: "⚙️",
  },
  {
    nameKey: "services.crm",
    descKey: "services.crmDesc",
    icon: "🗂️",
  },
  // Digital-услуги
  {
    nameKey: "services.websites",
    descKey: "services.websitesDesc",
    icon: "💻",
  },
  {
    nameKey: "services.seo",
    descKey: "services.seoDesc",
    icon: "🔍",
  },
  {
    nameKey: "services.contextAds",
    descKey: "services.contextAdsDesc",
    icon: "📢",
  },
  // AI и интеграции
  {
    nameKey: "services.aiBots",
    descKey: "services.aiBotsDesc",
    icon: "🤖",
  },
  {
    nameKey: "services.integrations",
    descKey: "services.integrationsDesc",
    icon: "🔗",
  },
];

export default function ServicesBlock() {
  const { t } = useLanguage();

  return (
    <div id="services" className="bg-gray-50 py-12">
      <div className="container mx-auto px-4">
        {/* Header */}
        <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
          <span className="w-1 h-8 bg-[#820251] rounded"></span>
          {t("services.title")}
        </h2>
        <p className="text-gray-600 mb-8 ml-3">
          {t("services.subtitle")}
        </p>

        {/* Services list */}
        <div className="bg-white rounded-2xl shadow-lg border-2 border-[#820251]/20 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, idx) => (
              <div
                key={idx}
                className={`p-5 hover:bg-gradient-to-br hover:from-[#820251]/5 hover:to-transparent transition-all relative group ${
                  idx < services.length - 1 ? 'border-b sm:border-b-0 sm:border-r border-[#820251]/10' : ''
                } ${idx >= 3 && idx < 6 ? 'lg:border-t border-[#820251]/10' : ''} ${idx >= 6 ? 'lg:border-t border-[#820251]/10' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#820251] to-[#a80368] flex items-center justify-center flex-shrink-0 shadow-md group-hover:shadow-lg group-hover:scale-105 transition-all">
                    <span className="text-2xl">{service.icon}</span>
                  </div>
                  <div className="min-w-0 pt-1">
                    <h3 className="font-bold text-gray-800 mb-1 group-hover:text-[#820251] transition-colors">
                      {t(service.nameKey)}
                    </h3>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      {t(service.descKey)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact CTA */}
        <div className="mt-10 bg-gradient-to-r from-[#820251] to-[#5a0138] rounded-2xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-xl font-bold text-white mb-1">
                {t("services.consultation")}
              </h3>
              <p className="text-pink-200">
                {t("services.consultationDesc")}
              </p>
            </div>
            <a
              href="https://mail.yandex.ru/compose?to=surdoe@yandex.ru&subject=Консультация по услугам"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yellow-400 text-[#820251] px-8 py-3 rounded-xl font-bold hover:bg-yellow-300 transition-colors whitespace-nowrap shadow-lg hover:shadow-xl"
            >
              {t("services.contactUs")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
