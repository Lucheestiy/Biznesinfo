"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { businessCategories, regions } from "@/data/mockData";
import Link from "next/link";

export default function AddCompanyPage() {
  const { t } = useLanguage();
  const { selectedRegion } = useRegion();
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    companyName: "",
    category: "",
    subcategory: "",
    region: selectedRegion || "",
    address: "",
    phone: "",
    email: "",
    website: "",
    description: "",
    contactPerson: "",
    contactPhone: "",
  });

  const selectedCategory = businessCategories.find((c) => c.slug === formData.category);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Here would be the API call to submit the request to AI assistant
    console.log("Add company request submitted:", formData);
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
              <span className="text-[#820251] font-medium">{t("nav.addCompany")}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-3xl mx-auto">
            {submitted ? (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Заявка отправлена!</h2>
                <p className="text-gray-600 mb-6">
                  Ваша заявка на добавление организации передана AI-ассистенту для обработки.
                  После проверки информации, ваша компания будет добавлена в каталог.
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
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-[#820251] rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold text-gray-800">{t("nav.addCompany")}</h1>
                    <p className="text-gray-500">Добавьте вашу организацию в каталог</p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-sm text-blue-800">
                      Заполните форму, и наш AI-ассистент обработает вашу заявку. После проверки
                      информации ваша организация будет добавлена в каталог Biznes.lucheestiy.com.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Company Information */}
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <span className="w-1 h-5 bg-[#820251] rounded"></span>
                      {t("addCompany.companyInfo")}
                    </h2>
                    <div className="space-y-4">
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

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Категория *
                          </label>
                          <select
                            required
                            value={formData.category}
                            onChange={(e) => setFormData({ ...formData, category: e.target.value, subcategory: "" })}
                            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] bg-white"
                          >
                            <option value="">Выберите категорию</option>
                            {businessCategories.map((cat) => (
                              <option key={cat.slug} value={cat.slug}>
                                {cat.icon} {cat.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Подкатегория *
                          </label>
                          <select
                            required
                            value={formData.subcategory}
                            onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                            disabled={!formData.category}
                            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] bg-white disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            <option value="">Выберите подкатегорию</option>
                            {selectedCategory?.subcategories.map((sub) => (
                              <option key={sub.slug} value={sub.slug}>
                                {sub.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Регион *
                          </label>
                          <select
                            required
                            value={formData.region}
                            onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] bg-white"
                          >
                            <option value="">{t("search.region")}</option>
                            {regions.map((region) => (
                              <option key={region.slug} value={region.slug}>
                                {t(`region.${region.slug}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Адрес *
                          </label>
                          <input
                            type="text"
                            required
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                            placeholder="г. Минск, ул. Примерная, 1"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Описание деятельности
                        </label>
                        <textarea
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] resize-none h-32"
                          placeholder="Кратко опишите деятельность вашей компании..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <span className="w-1 h-5 bg-[#820251] rounded"></span>
                      {t("addCompany.contactInfo")}
                    </h2>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Телефон компании *
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
                            Email компании *
                          </label>
                          <input
                            type="email"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                            placeholder="info@company.by"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Веб-сайт
                        </label>
                        <input
                          type="url"
                          value={formData.website}
                          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                          className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                          placeholder="https://company.by"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Person */}
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                      <span className="w-1 h-5 bg-[#820251] rounded"></span>
                      Контактное лицо для связи
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          ФИО *
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
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Телефон для связи *
                        </label>
                        <input
                          type="tel"
                          required
                          value={formData.contactPhone}
                          onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                          className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251]"
                          placeholder="+375 29 000-00-00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* AI Notice */}
                  <div className="bg-[#820251]/5 rounded-lg p-4 flex items-start gap-3">
                    <div className="w-10 h-10 bg-[#820251] rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-600">
                      Ваша заявка будет обработана нашим AI-ассистентом, который проверит информацию
                      и добавит вашу организацию в каталог. После добавления вы получите уведомление
                      на указанный email.
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
