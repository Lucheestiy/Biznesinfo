"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { IbizCatalogResponse } from "@/lib/ibiz/types";
import { formatCompanyCount } from "@/lib/utils/plural";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default function RegionPage({ params }: PageProps) {
  const { slug } = use(params);
  const { t } = useLanguage();
  const { setSelectedRegion } = useRegion();
  const [catalog, setCatalog] = useState<IbizCatalogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const regionData = useMemo(() => regions.find((r) => r.slug === slug) || null, [slug]);

  useEffect(() => {
    if (regionData) {
      setSelectedRegion(slug);
    }
  }, [slug, regionData, setSelectedRegion]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetch(`/api/ibiz/catalog?region=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: IbizCatalogResponse | null) => {
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
  }, [slug]);

  if (!regionData) {
    return (
      <div className="min-h-screen flex flex-col font-sans bg-gray-100">
        <Header />
        <main className="flex-grow">
          <div className="container mx-auto py-10 px-4">
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("common.error")}</h3>
              <p className="text-gray-500">Регион не найден: {slug}</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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
              <span className="text-[#820251] font-medium">{regionData.name}</span>
            </div>
          </div>
        </div>

        {/* Region Header */}
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-10">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-4">
              <span className="text-5xl">📍</span>
              <div>
                <h1 className="text-3xl font-bold">{regionData.name}</h1>
                <p className="text-pink-200 mt-1">
                  {t("search.found")}: {isLoading ? "…" : formatCompanyCount(catalog?.stats?.companies_total ?? 0)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Region Selector */}
        <div className="bg-white border-b border-gray-200 py-4">
          <div className="container mx-auto px-4">
            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                {t("search.allRegions")}
              </Link>
              {regions.map((r) => (
                <Link
                  key={r.slug}
                  href={`/region/${r.slug}`}
                  className={
                    r.slug === slug
                      ? "px-4 py-2 rounded-full text-sm font-medium bg-[#820251] text-white"
                      : "px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }
                >
                  {t(`region.${r.slug}`)}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="container mx-auto py-10 px-4">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-1 h-6 bg-[#820251] rounded"></span>
            {t("catalog.title")}
          </h2>

          {isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !catalog ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.error")}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {catalog.categories.map((cat) => (
                <Link
                  key={cat.slug}
                  href={`/catalog/${cat.slug}`}
                  className="bg-white p-5 rounded-lg shadow-sm hover:shadow-md transition-all border border-gray-100 hover:border-[#820251] flex justify-between items-center group"
                >
                  <span className="flex items-center gap-3">
                    <span className="text-2xl">{cat.icon || "🏢"}</span>
                    <span className="font-medium text-gray-700 group-hover:text-[#820251]">{cat.name}</span>
                  </span>
                  <span className="text-sm text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    {cat.company_count}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
