"use client";

import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();

  return (
    <footer id="contacts" className="bg-[#2d2d2d] text-gray-400 py-10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Logo and description */}
          <div>
            <h4 className="text-white font-bold text-lg mb-2">
              <span className="text-yellow-400">Biznesinfo</span>.by
            </h4>
            <p className="text-sm text-gray-300 mb-4">
              ООО «Бизнесстатус»
            </p>
            <p className="text-sm mb-4">
              {t("hero.subtitle")}
            </p>
            <p className="text-sm">
              Email:{" "}
              <a
                href="https://mail.yandex.ru/compose?to=surdoe@yandex.ru"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                surdoe@yandex.ru
              </a>
            </p>
            <p className="text-sm mt-2">
              Тел:{" "}
              <a
                href="tel:+375000000"
                className="hover:text-white transition-colors"
              >
                +375000000
              </a>
            </p>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-bold mb-4">{t("footer.information")}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/agreement" className="hover:text-white transition-colors">
                  {t("footer.agreement")}
                </Link>
              </li>
              <li>
                <Link href="/offer" className="hover:text-white transition-colors">
                  {t("footer.offer")}
                </Link>
              </li>
              <li>
                <Link href="/ad-request" className="hover:text-white transition-colors">
                  {t("footer.adRequest")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-6 text-center text-sm">
          &copy; 2026 Biznesinfo.by. {t("footer.rights")}.
        </div>
      </div>
    </footer>
  );
}
