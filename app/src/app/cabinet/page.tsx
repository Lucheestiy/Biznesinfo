"use client";

import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

export default function CabinetPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Link href="/" className="hover:text-[#820251]">
                {t("common.home")}
              </Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">
                {t("cabinet.title") || "Личный кабинет"}
              </span>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-10 px-4">
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="w-20 h-20 bg-[#820251]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-3">
              {t("cabinet.title") || "Личный кабинет"}
            </h1>
            <p className="text-gray-600 mb-8">
              {t("cabinet.soon") || "Раздел в разработке. Пока вы можете отправлять заявки через AI-ассистент."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
              >
                {t("common.home")}
              </Link>
              <Link
                href="/add-company"
                className="inline-flex items-center justify-center bg-gray-100 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
              >
                {t("nav.addCompany")}
              </Link>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

