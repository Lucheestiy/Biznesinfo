"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SearchBar from "@/components/SearchBar";
import ServicesBlock from "@/components/ServicesBlock";
import NewsBlock from "@/components/NewsBlock";
import AIAssistant from "@/components/AIAssistant";
import { useLanguage } from "@/contexts/LanguageContext";
import { regions } from "@/data/regions";
import type { IbizCatalogResponse } from "@/lib/ibiz/types";

export default function Home() {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<IbizCatalogResponse | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/ibiz/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!isMounted) return;
        setCatalog(data);
      })
      .catch(() => {
        if (!isMounted) return;
        setCatalog(null);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const formatCount = (value: number | null | undefined): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "…";
    return new Intl.NumberFormat().format(value);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Hero Section with Search */}
        <div className="bg-gradient-to-br from-[#820251] to-[#5a0138] text-white pt-4 pb-12 md:py-16">
          <div className="container mx-auto px-4 text-center">
            {/* Add company link at top */}
            <div className="mb-4 md:mb-6">
              <Link
                href="/add-company"
                className="inline-flex items-center gap-2 text-yellow-400 hover:text-white hover:scale-110 hover:underline underline-offset-4 transition-all duration-200 cursor-pointer text-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span className="font-semibold">{t("nav.addCompany")} ({t("about.submitRequest")})</span>
              </Link>
            </div>

            {/* Interactive title and subtitle with single running border */}
            <div className="relative mb-5 md:mb-8 max-w-2xl mx-auto group cursor-default">
              {/* Animated border */}
              <div className="absolute inset-0 rounded-xl p-[2px] overflow-hidden">
                <div
                  className="absolute inset-[-100%] animate-[spin_4s_linear_infinite]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0%, #facc15 15%, #fef08a 25%, transparent 35%, transparent 65%, #facc15 75%, #fef08a 85%, transparent 100%)',
                  }}
                />
                <div className="absolute inset-[2px] bg-gradient-to-br from-[#820251] to-[#5a0138] rounded-[10px]" />
              </div>

              <div className="relative px-4 py-3 md:px-6 md:py-4 text-center">
                <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 md:mb-3
                  group-hover:text-yellow-100 transition-colors duration-300">
                  {t("hero.title")}
                </h1>
                <p className="text-base md:text-xl leading-snug md:leading-normal text-pink-100
                  group-hover:text-white transition-colors duration-300
                  drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]
                  group-hover:drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">
                  {t("hero.subtitle")}
                </p>
              </div>
            </div>

            {/* Search Box - Split into two fields */}
            <Suspense fallback={<div className="h-[200px]" />}>
              <SearchBar variant="hero" />
            </Suspense>

            {/* Quick Stats - Interactive */}
            <div className="flex justify-center mt-10">
              <div className="relative group cursor-pointer">
                {/* Animated border */}
                <div className="absolute inset-0 rounded-2xl p-[3px] overflow-hidden">
                  <div
                    className="absolute inset-[-100%] animate-[spin_4s_linear_infinite]"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent 0%, #facc15 15%, #fef08a 25%, transparent 35%, transparent 65%, #facc15 75%, #fef08a 85%, transparent 100%)',
                    }}
                  />
                  <div className="absolute inset-[3px] bg-gradient-to-br from-[#820251] to-[#5a0138] rounded-[13px]" />
                </div>

                {/* Content */}
                <div className="relative text-center px-6 py-4 rounded-2xl
                  hover:scale-105 transition-transform duration-300">
                  {/* Glowing number */}
                  <div className="text-lg md:text-xl lg:text-2xl font-bold text-transparent bg-clip-text
                    bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-300
                    animate-pulse drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]
                    group-hover:drop-shadow-[0_0_25px_rgba(250,204,21,0.8)]
                    transition-all duration-300"
                    style={{
                      textShadow: '0 0 30px rgba(250,204,21,0.4), 0 0 60px rgba(250,204,21,0.2)',
                    }}>
                    {formatCount(catalog?.stats?.companies_total)}
                  </div>
                  <div className="text-pink-200 text-lg mt-2 group-hover:text-white transition-colors">
                    {t("stats.companies")}
                  </div>

                  {/* Sparkles */}
                  <div className="absolute -top-2 -left-2 w-4 h-4 text-yellow-400 animate-ping opacity-75">✦</div>
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 text-yellow-300 animate-ping opacity-60" style={{animationDelay: '0.5s'}}>✦</div>
                  <div className="absolute top-1/2 -right-3 w-3 h-3 text-yellow-400 animate-ping opacity-50" style={{animationDelay: '1s'}}>✦</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Services Section */}
        <ServicesBlock />

        {/* News Section - 6 blocks */}
        <div className="bg-white py-12 border-y border-gray-200">
          <NewsBlock />
        </div>

        {/* AI Assistant Section */}
        <div id="about" className="bg-gradient-to-b from-gray-50 via-gray-100 to-gray-50 py-16">
          <div className="container mx-auto px-4">
            {/* AI Assistant explanation - full width, beautiful module */}
            <div className="w-full relative group/ai cursor-pointer"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new Event("aiassistant:open"));
                }
              }}>
              {/* Outer glow effect */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-yellow-400/20 via-pink-500/20 to-yellow-400/20 blur-2xl opacity-0 group-hover/ai:opacity-100 transition-opacity duration-500" />

              {/* Animated running border */}
              <div className="absolute inset-0 rounded-3xl p-[3px] overflow-hidden">
                <div
                  className="absolute inset-[-100%] animate-[spin_3s_linear_infinite]"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0%, #facc15 10%, #fef08a 20%, #fff 25%, transparent 30%, transparent 70%, #facc15 75%, #fef08a 85%, #fff 90%, transparent 95%)',
                  }}
                />
                <div className="absolute inset-[3px] bg-gradient-to-br from-[#820251] via-[#6a0143] to-[#5a0138] rounded-[21px]" />
              </div>

              <div className="relative bg-gradient-to-br from-[#820251] via-[#6a0143] to-[#5a0138] rounded-3xl p-8 md:p-10 text-white
                group-hover/ai:scale-[1.02] transition-all duration-500 overflow-hidden
                shadow-[0_20px_60px_rgba(130,2,81,0.4)] group-hover/ai:shadow-[0_30px_80px_rgba(130,2,81,0.5)]">

                {/* Animated background particles */}
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-400/10 rounded-full blur-3xl animate-pulse" />
                  <div className="absolute bottom-0 left-0 w-72 h-72 bg-pink-400/10 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}} />
                  <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white/5 rounded-full blur-3xl animate-pulse" style={{animationDelay: '0.5s'}} />
                </div>

                <div className="relative flex flex-col md:flex-row items-center gap-8 md:gap-10">
                  {/* Glowing lightbulb - enhanced */}
                  <div className="relative flex-shrink-0">
                    {/* Multiple glow layers */}
                    <div className="absolute inset-[-30px] bg-yellow-400/15 rounded-full blur-3xl animate-[pulse_3s_ease-in-out_infinite]" />
                    <div className="absolute inset-[-20px] bg-yellow-300/20 rounded-full blur-2xl animate-[pulse_2s_ease-in-out_infinite]" />
                    <div className="absolute inset-[-10px] bg-yellow-200/25 rounded-full blur-xl animate-[pulse_1.5s_ease-in-out_infinite]" />

                    {/* Main bulb */}
                    <div className="relative w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-yellow-200 via-yellow-400 to-yellow-500 rounded-full flex items-center justify-center
                      shadow-[0_0_30px_rgba(250,204,21,0.6),0_0_60px_rgba(250,204,21,0.3),0_0_100px_rgba(250,204,21,0.1)]
                      animate-[pulse_2s_ease-in-out_infinite]
                      group-hover/ai:shadow-[0_0_40px_rgba(250,204,21,0.8),0_0_80px_rgba(250,204,21,0.4),0_0_120px_rgba(250,204,21,0.2)]
                      transition-shadow duration-500">
                      <svg className="w-10 h-10 md:w-12 md:h-12 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>

                    {/* Light rays */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="absolute w-1 h-32 bg-gradient-to-b from-yellow-400/40 via-yellow-400/10 to-transparent -top-6 animate-pulse" />
                      <div className="absolute w-1 h-24 bg-gradient-to-b from-yellow-400/30 via-yellow-400/10 to-transparent -top-4 rotate-45 animate-pulse" style={{animationDelay: '0.3s'}} />
                      <div className="absolute w-1 h-24 bg-gradient-to-b from-yellow-400/30 via-yellow-400/10 to-transparent -top-4 -rotate-45 animate-pulse" style={{animationDelay: '0.6s'}} />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-grow text-center md:text-left">
                    <h3 className="text-3xl md:text-4xl font-bold mb-4 group-hover/ai:text-yellow-300 transition-colors duration-300
                      drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">
                      {t("ai.title")}
                      <span className="ml-3 text-xs bg-gradient-to-r from-yellow-300 to-yellow-500 text-[#820251] px-3 py-1.5 rounded-full font-bold uppercase align-middle
                        shadow-[0_0_15px_rgba(250,204,21,0.5)] animate-pulse">New</span>
                    </h3>
                    <p className="text-pink-100 text-lg md:text-xl mb-4 group-hover/ai:text-white transition-colors duration-300 leading-relaxed">
                      {t("about.aiExplanation")}
                    </p>
                    <p className="text-yellow-400 font-semibold text-base md:text-lg
                      drop-shadow-[0_0_10px_rgba(250,204,21,0.6)]
                      animate-[pulse_2s_ease-in-out_infinite]">
                      {t("about.aiPlatform")}
                    </p>

                    {/* Click indicator */}
                    <div className="mt-6 inline-flex items-center gap-2 text-white/80 group-hover/ai:text-yellow-300 transition-colors">
                      <span className="text-sm font-medium">{t("ai.clickToOpen") || "Нажмите, чтобы открыть"}</span>
                      <svg className="w-5 h-5 animate-[bounceX_1s_ease-in-out_infinite]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                  </div>

                </div>

                {/* Enhanced Sparkles */}
                <div className="absolute top-4 left-4 text-yellow-400 animate-ping opacity-75 text-lg">✦</div>
                <div className="absolute bottom-4 right-4 text-yellow-300 animate-ping opacity-60 text-base" style={{animationDelay: '0.5s'}}>✦</div>
                <div className="absolute top-1/2 right-6 text-yellow-400 animate-ping opacity-50 text-sm" style={{animationDelay: '1s'}}>✦</div>
                <div className="absolute top-6 right-1/4 text-yellow-300 animate-ping opacity-60 text-sm" style={{animationDelay: '0.3s'}}>✦</div>
                <div className="absolute bottom-1/3 left-6 text-yellow-400 animate-ping opacity-50 text-base" style={{animationDelay: '0.7s'}}>✦</div>
                <div className="absolute top-1/3 left-1/3 text-white/40 animate-ping opacity-40 text-xs" style={{animationDelay: '0.9s'}}>✦</div>
                <div className="absolute bottom-6 left-1/3 text-yellow-200 animate-ping opacity-50 text-sm" style={{animationDelay: '1.2s'}}>✦</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* Floating AI Assistant - only on main page */}
      <AIAssistant floating hideFloatingButton />
    </div>
  );
}
