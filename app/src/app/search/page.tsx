"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import SearchBar from "@/components/SearchBar";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { IbizCompanySummary, IbizSearchResponse } from "@/lib/ibiz/types";
import Link from "next/link";

function SearchResults() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();

  const query = searchParams.get("q") || "";
  const keywords = searchParams.get("keywords") || "";

  const [data, setData] = useState<IbizSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    const kw = keywords.trim();
    if (!q && !kw) {
      setData(null);
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    setIsLoading(true);
    const region = selectedRegion || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kw) params.set("keywords", kw);
    if (region) params.set("region", region);
    params.set("offset", "0");
    params.set("limit", "60");

    fetch(`/api/ibiz/search?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: IbizSearchResponse | null) => {
        if (!isMounted) return;
        setData(resp);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setData(null);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [query, keywords, selectedRegion]);

  const grouped = useMemo(() => {
    const out: Record<string, { name: string; companies: IbizCompanySummary[] }> = {};
    for (const c of data?.companies || []) {
      const key = c.primary_category_slug || "other";
      if (!out[key]) out[key] = { name: c.primary_category_name || "Другое", companies: [] };
      out[key].companies.push(c);
    }
    return out;
  }, [data]);

  const categoriesWithResults = Object.keys(grouped);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Search Header */}
        <div className="bg-gradient-to-r from-[#820251] to-[#5a0138] text-white py-8">
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold mb-4">{t("search.results")}</h1>
            <SearchBar variant={query.trim() ? "compact" : "compactKeywords"} />
          </div>
        </div>

        {/* Region Filter */}
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

        {/* Results */}
        <div className="container mx-auto py-10 px-4">
          {(query || keywords) && (
            <div className="mb-6">
              <p className="text-gray-600">
                {t("search.results")}:{" "}
                {query && <span className="font-semibold text-gray-800">«{query}»</span>}
                {query && keywords && " + "}
                {keywords && <span className="font-semibold text-[#820251]">«{keywords}»</span>}
                {selectedRegion && <span className="text-gray-500"> — {regionName}</span>}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {t("search.found")}: {isLoading ? "…" : (data?.total ?? 0)} {t("catalog.companies").toLowerCase()}
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !query && !keywords ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">
              {t("search.placeholder")}
            </div>
          ) : (data?.companies || []).length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("company.notFound")}</h3>
              <p className="text-gray-500 mb-4">{t("company.notFoundDesc")}</p>
              {selectedRegion && (
                <button
                  onClick={() => setSelectedRegion(null)}
                  className="text-[#820251] hover:underline mb-4 block mx-auto"
                >
                  {t("company.showAllRegions")}
                </button>
              )}
              <Link
                href="/#catalog"
                className="inline-block bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
              >
                {t("nav.catalog")}
              </Link>
            </div>
          ) : (
            <div className="space-y-10">
              {categoriesWithResults.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {categoriesWithResults.map((catSlug) => (
                    <a
                      key={catSlug}
                      href={`#category-${catSlug}`}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-white rounded-full text-sm text-gray-600 border border-gray-200 hover:border-[#820251] hover:text-[#820251] transition-colors"
                    >
                      <span>{grouped[catSlug]?.name || catSlug}</span>
                      <span className="text-gray-400">({grouped[catSlug]?.companies.length || 0})</span>
                    </a>
                  ))}
                </div>
              )}

              {categoriesWithResults.map((catSlug) => (
                <div key={catSlug} id={`category-${catSlug}`}>
                  <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                    <span>{grouped[catSlug]?.name || catSlug}</span>
                    <span className="text-sm font-normal text-gray-500">
                      ({grouped[catSlug]?.companies.length || 0})
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {grouped[catSlug].companies.map((company) => (
                      <CompanyCard key={company.id} company={company} showCategory />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col font-sans bg-gray-100">
          <div className="flex-grow flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-[#820251] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-500">Загрузка...</p>
            </div>
          </div>
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
