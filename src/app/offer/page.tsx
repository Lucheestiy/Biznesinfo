"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import Link from "next/link";

export default function OfferPage() {
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
              <span className="text-[#820251] font-medium">{t("footer.offer")}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">{t("footer.offer")}</h1>

            <div className="prose prose-gray max-w-none">
              <p className="text-gray-600 mb-6">
                Дата вступления в силу: 1 января 2026 года
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">1. Общие положения</h2>
              <p className="text-gray-700 mb-4">
                1.1. Настоящий документ является официальным предложением (офертой)
                Biznes.lucheestiy.com и содержит все существенные условия оказания услуг
                по размещению информации о компаниях и организациях.
              </p>
              <p className="text-gray-700 mb-4">
                1.2. Акцептом оферты является оплата услуг в соответствии с выбранным тарифом.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">2. Предмет договора</h2>
              <p className="text-gray-700 mb-4">
                2.1. Исполнитель обязуется оказать услуги по размещению информации о компании
                Заказчика в каталоге Biznes.lucheestiy.com.
              </p>
              <p className="text-gray-700 mb-4">
                2.2. Услуги включают: размещение контактной информации, описания деятельности,
                товаров и услуг, а также подключение к сервису AI-ассистента (в зависимости от тарифа).
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">3. Стоимость услуг</h2>
              <p className="text-gray-700 mb-4">
                3.1. Стоимость услуг определяется в соответствии с действующими тарифами,
                опубликованными на сайте.
              </p>
              <p className="text-gray-700 mb-4">
                3.2. Оплата производится на условиях 100% предоплаты.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">4. Права и обязанности сторон</h2>
              <p className="text-gray-700 mb-4">
                4.1. Исполнитель обязуется разместить информацию в течение 3 рабочих дней
                после получения оплаты и всех необходимых материалов.
              </p>
              <p className="text-gray-700 mb-4">
                4.2. Заказчик несёт ответственность за достоверность предоставленной информации.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">5. Срок действия и расторжение</h2>
              <p className="text-gray-700 mb-4">
                5.1. Договор вступает в силу с момента оплаты и действует в течение оплаченного периода.
              </p>

              <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">6. Реквизиты</h2>
              <p className="text-gray-700 mb-4">
                Biznes.lucheestiy.com<br />
                Email: info@biznes.lucheestiy.com<br />
                Тел: +375 17 000-00-00
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
