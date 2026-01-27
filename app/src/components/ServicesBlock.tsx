"use client";

import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";

interface Service {
  nameKey: string;
  descKey: string;
  icon: string;
  slug: string;
}

export const services: Service[] = [
  {
    nameKey: "services.analysis",
    descKey: "services.analysisDesc",
    icon: "🌐",
    slug: "portal-placement",
  },
  {
    nameKey: "services.businessStatus",
    descKey: "services.businessStatusDesc",
    icon: "🎯",
    slug: "marketing-moves",
  },
  {
    nameKey: "services.leads",
    descKey: "services.leadsDesc",
    icon: "📈",
    slug: "lead-generation",
  },
  {
    nameKey: "services.processAutomation",
    descKey: "services.processAutomationDesc",
    icon: "⚙️",
    slug: "process-automation",
  },
  {
    nameKey: "services.crm",
    descKey: "services.crmDesc",
    icon: "🗂️",
    slug: "crm-systems",
  },
  {
    nameKey: "services.websites",
    descKey: "services.websitesDesc",
    icon: "💻",
    slug: "website-creation",
  },
  {
    nameKey: "services.seo",
    descKey: "services.seoDesc",
    icon: "🔍",
    slug: "seo-promotion",
  },
  {
    nameKey: "services.contextAds",
    descKey: "services.contextAdsDesc",
    icon: "📢",
    slug: "context-ads",
  },
  {
    nameKey: "services.aiBots",
    descKey: "services.aiBotsDesc",
    icon: "🤖",
    slug: "ai-bots",
  },
];

export default function ServicesBlock() {
  const { t } = useLanguage();

  return (
    <div id="services" className="bg-gray-50 py-12">
      <div className="container mx-auto px-4">
        {/* Header - Bright and Eye-catching */}
        <div className="mb-8 text-center">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-extrabold mb-4">
            <span className="bg-gradient-to-r from-[#820251] via-[#b10a78] to-[#d4145a] bg-clip-text text-transparent drop-shadow-sm">
              {t("services.title")}
            </span>
          </h2>
          <div className="w-32 h-1.5 bg-gradient-to-r from-yellow-400 via-[#820251] to-yellow-400 mx-auto rounded-full animate-pulse" />
        </div>

        {/* Services list - All 9 services visible */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {services.map((service, idx) => (
            <Link
              key={idx}
              href={`/services/${service.slug}`}
              className="relative p-5 md:p-6 bg-white rounded-2xl shadow-lg
                hover:shadow-2xl hover:shadow-yellow-400/30
                hover:-translate-y-1 transition-all duration-300 cursor-pointer group overflow-hidden"
            >
              {/* Animated running border */}
              <div className="absolute inset-0 rounded-2xl p-[2px] overflow-hidden">
                <div
                  className="absolute inset-[-100%] animate-[spin_3s_linear_infinite]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0%, #facc15 10%, #fef08a 20%, transparent 30%, transparent 70%, #facc15 80%, #fef08a 90%, transparent 100%)',
                  }}
                />
                <div className="absolute inset-[2px] bg-white rounded-[14px]" />
              </div>

              {/* Glow effect on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#820251]/0 via-[#820251]/0 to-yellow-400/0
                group-hover:from-[#820251]/5 group-hover:via-transparent group-hover:to-yellow-400/10
                transition-all duration-500 rounded-2xl" />

              <div className="relative flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#820251] to-[#b10a78] flex items-center justify-center flex-shrink-0 shadow-md
                  group-hover:shadow-xl group-hover:shadow-[#820251]/30 group-hover:scale-110
                  group-hover:rotate-3 transition-all duration-300">
                  <span className="text-2xl">{service.icon}</span>
                </div>
                <div className="min-w-0 pt-1 flex-1">
                  <h3 className="font-bold text-gray-800 mb-1 group-hover:text-[#820251] transition-colors flex items-center gap-2">
                    {t(service.nameKey)}
                    <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transform translate-x-0 group-hover:translate-x-1 transition-all text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {t(service.descKey)}
                  </p>
                  <span className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-[#820251]
                    opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0
                    transition-all duration-300">
                    {t("services.readMore")}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Corner accent */}
              <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden rounded-tr-2xl">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-yellow-400/20 to-transparent
                  transform translate-x-8 -translate-y-8 group-hover:translate-x-4 group-hover:-translate-y-4
                  transition-transform duration-500" />
              </div>
            </Link>
          ))}
        </div>

        {/* Contact CTA */}
        <div className="mt-10 relative group/cta cursor-pointer">
          {/* Animated running border */}
          <div className="absolute inset-0 rounded-2xl p-[3px] overflow-hidden">
            <div
              className="absolute inset-[-100%] animate-[spin_4s_linear_infinite]"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0%, #facc15 15%, #fef08a 25%, transparent 35%, transparent 65%, #facc15 75%, #fef08a 85%, transparent 100%)',
              }}
            />
            <div className="absolute inset-[3px] bg-gradient-to-r from-[#b10a78] to-[#7a0150] rounded-[13px]" />
          </div>

          <div className="relative bg-gradient-to-r from-[#b10a78] to-[#7a0150] rounded-2xl p-6 md:p-8
            group-hover/cta:scale-[1.02] transition-all duration-300">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h3 className="text-xl font-bold text-white mb-1 group-hover/cta:text-yellow-300 transition-colors">
                  {t("services.consultation")}
                </h3>
                <p className="text-pink-200 group-hover/cta:text-pink-100 transition-colors">
                  {t("services.consultationDesc")}
                </p>
              </div>
              <a
                href="https://mail.yandex.ru/compose?to=surdoe@yandex.ru&subject=Консультация по услугам"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-yellow-400 text-[#820251] px-8 py-3 rounded-xl font-bold hover:bg-yellow-300 hover:scale-105 transition-all whitespace-nowrap shadow-lg hover:shadow-xl"
              >
                {t("services.contactUs")}
              </a>
            </div>

            {/* Sparkles */}
            <div className="absolute -top-2 -left-2 w-4 h-4 text-yellow-400 animate-ping opacity-75">✦</div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 text-yellow-300 animate-ping opacity-60" style={{animationDelay: '0.5s'}}>✦</div>
            <div className="absolute top-1/2 -right-3 w-3 h-3 text-yellow-400 animate-ping opacity-50" style={{animationDelay: '1s'}}>✦</div>
            <div className="absolute -top-1 right-1/4 w-3 h-3 text-yellow-300 animate-ping opacity-60" style={{animationDelay: '0.3s'}}>✦</div>
            <div className="absolute -bottom-2 left-1/4 w-4 h-4 text-yellow-400 animate-ping opacity-50" style={{animationDelay: '0.8s'}}>✦</div>
          </div>
        </div>
      </div>
    </div>
  );
}
