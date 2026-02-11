"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions, regionMapping } from "@/data/regions";
import type { BiznesinfoCompanySummary } from "@/lib/biznesinfo/types";
import { formatCompanyCount } from "@/lib/utils/plural";
import Link from "next/link";

export default function FavoritesClient() {
  const { t } = useLanguage();
  const { favorites } = useFavorites();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();

  const [companies, setCompanies] = useState<BiznesinfoCompanySummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!favorites || favorites.length === 0) {
      setCompanies([]);
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    setIsLoading(true);
    fetch(`/api/biznesinfo/companies?ids=${encodeURIComponent(favorites.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: { companies?: BiznesinfoCompanySummary[] } | null) => {
        if (!isMounted) return;
        setCompanies(resp?.companies || []);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setCompanies([]);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [favorites]);

  const filteredCompanies = useMemo(() => {
    if (!selectedRegion) return companies;
    const regionSlugs = regionMapping[selectedRegion] || [selectedRegion];
    return companies.filter((c) => regionSlugs.includes(c.region));
  }, [companies, selectedRegion]);

  const categoriesInFavorites = useMemo(() => {
    const set = new Set<string>();
    for (const c of filteredCompanies) {
      if (c.primary_category_slug) set.add(c.primary_category_slug);
    }
    return Array.from(set);
  }, [filteredCompanies]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-10">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold">{t("favorites.title")}</h1>
                <p className="text-pink-200 mt-1">
                  {formatCompanyCount(favorites.length)} в избранном
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Region Filter */}
        {favorites.length > 0 && (
          <div className="bg-white border-b border-gray-200 py-4">
            <div className="container mx-auto px-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-600 font-medium">{t("filter.region")}:</span>
                <button
                  onClick={() => setSelectedRegion(null)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    !selectedRegion ? "bg-[#820251] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {t("search.allRegions")}
                </button>
                {regions.map((r) => (
                  <button
                    key={r.slug}
                    onClick={() => setSelectedRegion(r.slug)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      selectedRegion === r.slug
                        ? "bg-[#820251] text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {t(`region.${r.slug}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="container mx-auto py-10 px-4">
          {favorites.length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-700 mb-2">{t("favorites.empty")}</h2>
              <p className="text-gray-500 mb-6">
                Добавляйте компании в избранное, чтобы быстро находить их позже
              </p>
              <Link
                href="/#catalog"
                className="inline-block bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#7a0150] transition-colors"
              >
                {t("nav.catalog")}
              </Link>
            </div>
          ) : isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : filteredCompanies.length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("company.notFound")}</h3>
              <p className="text-gray-500">{t("company.notFoundDesc")}</p>
              <button
                onClick={() => setSelectedRegion(null)}
                className="inline-block mt-4 text-[#820251] hover:underline"
              >
                {t("company.showAllRegions")}
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                <span className="w-1 h-6 bg-[#820251] rounded"></span>
                {t("favorites.title")} ({filteredCompanies.length})
                {selectedRegion && (
                  <span className="text-sm font-normal text-gray-500">
                    — {regionName}
                  </span>
                )}
              </h2>

              {/* Categories chips */}
              {categoriesInFavorites.length > 1 && (
                <div className="mb-6 flex flex-wrap gap-2">
                  {categoriesInFavorites.map((catSlug) => {
                    const anyCompany = filteredCompanies.find((c) => c.primary_category_slug === catSlug);
                    const name = anyCompany?.primary_category_name || catSlug;
                    const count = filteredCompanies.filter((c) => c.primary_category_slug === catSlug).length;
                    return (
                      <span
                        key={catSlug}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-white rounded-full text-sm text-gray-600 border border-gray-200"
                      >
                        <span>{name}</span>
                        <span className="text-gray-400">({count})</span>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCompanies.map((company) => (
                  <CompanyCard key={company.id} company={company} showCategory />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

