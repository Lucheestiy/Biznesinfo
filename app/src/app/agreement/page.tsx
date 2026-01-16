"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import Link from "next/link";

export default function AgreementPage() {
  const { t } = useLanguage();

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
              <span className="text-[#820251] font-medium">{t("footer.agreement")}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">{t("footer.agreement")}</h1>

            <div className="prose prose-gray max-w-none">
              <p className="text-gray-600 mb-6">
                Дата последнего обновления: 1 января 2026 года
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">1. Общие положения</h2>
              <p className="text-gray-700 mb-4">
                Настоящее Пользовательское соглашение (далее — Соглашение) регулирует отношения между
                владельцем интернет-ресурса Biznes.lucheestiy.com (далее — Администрация) и пользователем
                сети Интернет (далее — Пользователь), возникающие при использовании данного ресурса.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">2. Предмет соглашения</h2>
              <p className="text-gray-700 mb-4">
                2.1. Администрация предоставляет Пользователю доступ к информационным материалам,
                размещённым на ресурсе, включая справочную информацию о компаниях и организациях.
              </p>
              <p className="text-gray-700 mb-4">
                2.2. Использование сервиса AI-ассистента осуществляется на условиях, определённых
                в настоящем Соглашении.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">3. Права и обязанности сторон</h2>
              <p className="text-gray-700 mb-4">
                3.1. Пользователь обязуется не использовать ресурс в целях, противоречащих законодательству.
              </p>
              <p className="text-gray-700 mb-4">
                3.2. Администрация оставляет за собой право изменять условия настоящего Соглашения.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">4. Конфиденциальность</h2>
              <p className="text-gray-700 mb-4">
                4.1. Персональные данные Пользователей обрабатываются в соответствии с политикой
                конфиденциальности ресурса.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">5. Ответственность</h2>
              <p className="text-gray-700 mb-4">
                5.1. Администрация не несёт ответственности за достоверность информации,
                предоставленной компаниями-партнёрами.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">6. Контактная информация</h2>
              <p className="text-gray-700 mb-4">
                По всем вопросам, связанным с настоящим Соглашением, обращайтесь по адресу:
                info@biznes.lucheestiy.com
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
