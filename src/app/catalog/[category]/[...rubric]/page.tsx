"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { IbizRubricResponse } from "@/lib/ibiz/types";
import { IBIZ_CATEGORY_ICONS } from "@/lib/ibiz/icons";
import { formatCompanyCount } from "@/lib/utils/plural";

interface PageProps {
  params: Promise<{ category: string; rubric: string[] }>;
}

export default function SubcategoryPage({ params }: PageProps) {
  const { category, rubric } = use(params);
  const { t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();

  const [data, setData] = useState<IbizRubricResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const rubricPath = Array.isArray(rubric) ? rubric.join("/") : String(rubric || "");

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const rubricSlug = `${category}/${rubricPath}`;
    const region = selectedRegion || "";
    fetch(
      `/api/ibiz/rubric?slug=${encodeURIComponent(rubricSlug)}&region=${encodeURIComponent(region)}&offset=0&limit=60`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: IbizRubricResponse | null) => {
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
  }, [category, rubricPath, selectedRegion]);

  const icon = IBIZ_CATEGORY_ICONS[category] || "🏢";

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
              <Link href={`/catalog/${category}`} className="hover:text-[#820251]">
                {data?.rubric?.category_name || category}
              </Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">{data?.rubric?.name || rubricPath}</span>
            </div>
          </div>
        </div>

        {/* Rubric Header */}
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-10">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-4">
              <span className="text-5xl">{icon}</span>
              <div>
                <h1 className="text-3xl font-bold">{data?.rubric?.name || rubricPath}</h1>
                <p className="text-pink-200 mt-1">
                  {data?.rubric?.category_name || category}
                  {" • "}
                  {isLoading ? "…" : formatCompanyCount(data?.page?.total ?? 0)}
                  {selectedRegion && ` • ${regionName}`}
                </p>
              </div>
            </div>
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

        {/* Companies List */}
        <div className="container mx-auto py-10 px-4">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-1 h-6 bg-[#820251] rounded"></span>
            {formatCompanyCount(data?.page?.total ?? 0)}
            {selectedRegion && (
              <span className="text-sm font-normal text-gray-500">
                — {regionName}
              </span>
            )}
          </h2>

          {isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !data || !data.companies || data.companies.length === 0 ? (
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {data.companies.map((company) => (
                <CompanyCard key={company.id} company={company} />
              ))}
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="container mx-auto pb-10 px-4">
          <Link
            href={`/catalog/${category}`}
            className="inline-flex items-center gap-2 text-[#820251] hover:underline"
          >
            ← {t("catalog.backToCategory")} {data?.rubric?.category_name || category}
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
