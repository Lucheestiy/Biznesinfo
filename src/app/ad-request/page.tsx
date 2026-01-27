"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import Link from "next/link";

export default function AdRequestPage() {
  const { t } = useLanguage();
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    contactPerson: "",
    phone: "",
    email: "",
    message: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Here would be the API call to submit the request to AI assistant
    console.log("Ad request submitted:", formData);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Breadcrumbs */}
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Link href="/" className="hover:text-[#820251]">{t("common.home")}</Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">{t("footer.adRequest")}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-2xl mx-auto">
            {submitted ? (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Заявка отправлена!</h2>
                <p className="text-gray-600 mb-6">
                  Ваша заявка на размещение рекламы передана AI-ассистенту.
                  Мы свяжемся с вами в ближайшее время.
                </p>
                <Link
                  href="/"
                  className="inline-block bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
                >
                  На главную
                </Link>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-8">
                <h1 className="text-3xl font-bold text-gray-800 mb-2">{t("footer.adRequest")}</h1>
                <p className="text-gray-600 mb-8">
                  Заполните форму, и наш AI-ассистент обработает вашу заявку.
                  Мы предложим оптимальные варианты размещения рекламы на платформе.
                </p>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Название компании *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                      placeholder="ООО «Ваша компания»"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Контактное лицо *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.contactPerson}
                      onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                      placeholder="Иванов Иван Иванович"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Телефон *
                      </label>
                      <input
                        type="tel"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                        placeholder="+375 29 000-00-00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                        placeholder="email@company.by"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Сообщение
                    </label>
                    <textarea
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] resize-none h-32"
                      placeholder="Опишите ваши пожелания по размещению рекламы..."
                    />
                  </div>

                  <div className="bg-[#820251]/5 rounded-lg p-4 flex items-start gap-3">
                    <div className="w-10 h-10 bg-[#820251] rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-600">
                      Ваша заявка будет обработана нашим AI-ассистентом, который подберёт
                      оптимальные варианты рекламного размещения для вашего бизнеса.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-[#820251] text-white py-4 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
                  >
                    Отправить заявку
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
