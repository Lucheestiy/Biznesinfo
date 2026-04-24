"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SearchBar from "@/components/SearchBar";
import { useLanguage } from "@/contexts/LanguageContext";
import { localizeCatalogCategoryName, localizeCatalogRubricName } from "@/lib/biznesinfo/catalog-localization";
import type { BiznesinfoCatalogCategory, BiznesinfoCatalogResponse } from "@/lib/biznesinfo/types";

interface PageProps {
  params: Promise<{ category: string }>;
}

const LEGACY_CATEGORY_ALIAS_REDIRECTS: Record<string, string> = {
  sporttovary: "/catalog/sport-zdorove-krasota/sportivnye-tovary-snaryajenie",
  "selskoe-hozyaystvo": "/catalog/apk-selskoe-i-lesnoe-hozyaystvo/selskoe-hozyaystvo",
  "transport-logistika": "/catalog/transport-logistika-perevozki",
};

export default function CategoryPage({ params }: PageProps) {
  const { category } = use(params);
  const { t, language } = useLanguage();
  const router = useRouter();

  const [catalog, setCatalog] = useState<BiznesinfoCatalogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetch("/api/biznesinfo/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BiznesinfoCatalogResponse | null) => {
        if (!isMounted) return;
        setCatalog(data);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setCatalog(null);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const categoryData: BiznesinfoCatalogCategory | null =
    (catalog?.categories || []).find((c: BiznesinfoCatalogCategory) => c.slug === category) || null;
  const categoryTitle = categoryData
    ? localizeCatalogCategoryName(language, categoryData.slug, categoryData.name)
    : category;

  useEffect(() => {
    if (isLoading || categoryData) return;
    const aliasPath = LEGACY_CATEGORY_ALIAS_REDIRECTS[String(category || "").trim().toLowerCase()];
    if (!aliasPath) return;
    router.replace(aliasPath);
  }, [category, categoryData, isLoading, router]);

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
              <Link href="/#catalog" className="hover:text-[#820251]">{t("nav.catalog")}</Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">{categoryTitle}</span>
            </div>
          </div>
        </div>

        {/* Category Header */}
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-10">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-4">
              <span className="text-5xl">{categoryData?.icon || "🏢"}</span>
              <div>
                <h1 className="text-3xl font-bold">{categoryTitle}</h1>
                <p className="text-pink-200 mt-1">{t("catalog.subcategories")}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search block (same behavior as on home page) */}
        <div className="bg-gradient-to-br from-[#a0006d] to-[#a0006d] text-white pt-4 pb-8">
          <div className="container mx-auto px-4">
            <div className="relative z-[120]">
              <Suspense fallback={<div className="h-[200px]" />}>
                <SearchBar variant="subrubric" />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Subcategories */}
        <div className="container mx-auto py-10 px-4">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-1 h-6 bg-[#820251] rounded"></span>
            {t("catalog.subcategories")}
          </h2>

          {isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !categoryData ? (
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("common.error")}</h3>
              <p className="text-gray-500">Категория не найдена: {category}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {categoryData.rubrics.map((r) => {
                const subSlug = r.slug.split("/").slice(1).join("/");
                return (
                  <Link
                    key={r.slug}
                    href={`/catalog/${category}/${subSlug}`}
                    className="bg-white p-5 rounded-lg shadow-sm hover:shadow-md transition-all border border-gray-100 hover:border-[#820251] flex justify-between items-center group"
                  >
                    <span className="font-medium text-gray-700 group-hover:text-[#820251]">
                      {localizeCatalogRubricName(language, r.slug, r.name)}
                    </span>
                    <span className="text-sm text-gray-400 bg-gray-100 px-2 py-1 rounded">
                      {r.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="container mx-auto pb-10 px-4">
          <Link
            href="/#catalog"
            className="inline-flex items-center gap-2 text-[#820251] hover:underline"
          >
            ← {t("catalog.backToCatalog")}
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
