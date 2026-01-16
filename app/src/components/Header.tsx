"use client";

import Link from "next/link";
import { useState } from "react";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";

const languages: { code: Language; name: string; flag: string }[] = [
  { code: "ru", name: "Русский", flag: "RU" },
  { code: "en", name: "English", flag: "EN" },
  { code: "be", name: "Беларуская", flag: "BY" },
  { code: "zh", name: "中文", flag: "CN" },
];

export default function Header() {
  const { language, setLanguage, t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);

  const currentLang = languages.find((l) => l.code === language) || languages[0];

  return (
    <header className="bg-[#820251] text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <Link href="/" className="text-2xl font-bold tracking-tight">
              <span className="text-yellow-400">Biznes</span>
              <span className="text-white">.lucheestiy.com</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm">
              <Link href="/#catalog" className="hover:text-yellow-400 transition-colors">
                {t("nav.catalog")}
              </Link>
              <Link href="/#news" className="hover:text-yellow-400 transition-colors">
                {t("nav.news")}
              </Link>
              <Link href="/favorites" className="hover:text-yellow-400 transition-colors">
                {t("nav.favorites")}
              </Link>
              <Link href="/#about" className="hover:text-yellow-400 transition-colors">
                {t("nav.about")}
              </Link>
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <Link
                href="/add-company"
                className="bg-yellow-500 text-[#820251] px-4 py-2 rounded font-semibold hover:bg-yellow-400 transition-colors text-sm"
              >
                {t("nav.addCompany")}
              </Link>
            </div>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-white p-2"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-[520px] bg-gradient-to-br from-[#fff0a8] to-[#ffe24a] border border-[#ffd700] rounded-[28px] px-4 py-3 flex flex-wrap items-center justify-center gap-3 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur text-[#3d1b44]">
              <div className="relative">
                <button
                  onClick={() => setRegionMenuOpen(!regionMenuOpen)}
                  className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/90 text-[#3d1b44] border border-[#f3e363] hover:border-[#820251] transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#820251] focus-visible:ring-offset-2"
                >
                  <svg className="w-4 h-4 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="max-w-[140px] text-sm truncate">{regionName}</span>
                  <svg className="w-4 h-4 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {regionMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setRegionMenuOpen(false)} />
                    <div className="absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 bg-white rounded-lg shadow-xl py-1 max-h-80 overflow-y-auto">
                      <button
                        onClick={() => {
                          setSelectedRegion(null);
                          setRegionMenuOpen(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                          !selectedRegion ? "text-[#820251] font-medium" : "text-gray-700"
                        }`}
                      >
                        {t("search.allRegions")}
                      </button>
                      {regions.map((region) => (
                        <button
                          key={region.slug}
                          onClick={() => {
                            setSelectedRegion(region.slug);
                            setRegionMenuOpen(false);
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                            selectedRegion === region.slug ? "text-[#820251] font-medium" : "text-gray-700"
                          } ${region.isCity ? "pl-4" : "pl-6 text-gray-500"}`}
                        >
                          {t(`region.${region.slug}`)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/90 text-[#3d1b44] border border-[#f3e363] hover:border-[#820251] transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#820251] focus-visible:ring-offset-2"
                >
                  <span>{currentLang.flag}</span>
                  <svg className="w-4 h-4 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {langMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setLangMenuOpen(false)} />
                    <div className="absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 bg-white rounded-lg shadow-xl py-1">
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setLanguage(lang.code);
                            setLangMenuOpen(false);
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 ${
                            language === lang.code ? "text-[#820251] font-medium" : "text-gray-700"
                          }`}
                        >
                          <span>{lang.flag}</span>
                          <span>{lang.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-white/30">
            <nav className="flex flex-col gap-3 text-sm">
              <Link
                href="/#catalog"
                className="hover:text-yellow-400 transition-colors py-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.catalog")}
              </Link>
              <Link
                href="/#news"
                className="hover:text-yellow-400 transition-colors py-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.news")}
              </Link>
              <Link
                href="/favorites"
                className="hover:text-yellow-400 transition-colors py-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.favorites")}
              </Link>
              <Link
                href="/#about"
                className="hover:text-yellow-400 transition-colors py-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.about")}
              </Link>
              <div className="pt-3 border-t border-white/30">
                <Link
                  href="/add-company"
                  className="inline-block bg-yellow-500 text-[#820251] px-4 py-2 rounded font-semibold hover:bg-yellow-400 transition-colors text-sm"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t("nav.addCompany")}
                </Link>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
