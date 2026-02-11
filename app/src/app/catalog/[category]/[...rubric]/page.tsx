"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { BiznesinfoRubricResponse } from "@/lib/biznesinfo/types";
import { BIZNESINFO_CATEGORY_ICONS } from "@/lib/biznesinfo/icons";
import { formatCompanyCount } from "@/lib/utils/plural";

interface PageProps {
  params: Promise<{ category: string; rubric: string[] }>;
}

export default function SubcategoryPage({ params }: PageProps) {
  const { category, rubric } = use(params);
  const { t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();
  const router = useRouter();

  const [data, setData] = useState<BiznesinfoRubricResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [companyDraft, setCompanyDraft] = useState("");
  const [serviceDraft, setServiceDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const cityInputRef = useRef<HTMLInputElement>(null);

  const rubricPath = Array.isArray(rubric) ? rubric.join("/") : String(rubric || "");

  const inputClassName =
    "w-full rounded-2xl bg-white text-[#820251] font-medium text-[15px] placeholder:text-gray-500/60 placeholder:font-normal px-4 pr-24 py-3.5 shadow-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/70 focus:border-[#820251]/30 focus:placeholder:text-gray-500/60";
  const inputButtonClassName =
    "absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-[#820251]/10 text-[#820251] hover:bg-[#820251]/15 active:bg-[#820251]/20 transition-colors flex items-center justify-center";
  const clearInputButtonClassName =
    "absolute right-14 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-[#820251]/60 hover:text-[#820251] hover:bg-[#820251]/10 active:bg-[#820251]/15 transition-colors flex items-center justify-center";

  const navigateToSearch = () => {
    const params = new URLSearchParams();
    const companyName = companyDraft.trim();
    const service = serviceDraft.trim();
    const city = cityDraft.trim();

    if (companyName) params.set("q", companyName);
    if (service) params.set("service", service);
    if (city) params.set("city", city);
    if (!city && selectedRegion) params.set("region", selectedRegion);

    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const rubricSlug = `${category}/${rubricPath}`;
    const region = selectedRegion || "";
    fetch(
      `/api/biznesinfo/rubric?slug=${encodeURIComponent(rubricSlug)}&region=${encodeURIComponent(region)}&offset=0&limit=60`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: BiznesinfoRubricResponse | null) => {
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

  const icon = BIZNESINFO_CATEGORY_ICONS[category] || "🏢";

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
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-6">
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

            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                navigateToSearch();
              }}
            >
              <div className="relative">
                <label className="sr-only" htmlFor="catalog-search-company">
                  {t("search.companyPlaceholder")}
                </label>
                <input
                  id="catalog-search-company"
                  value={companyDraft}
                  onChange={(e) => setCompanyDraft(e.target.value)}
                  inputMode="search"
                  placeholder={t("search.companyPlaceholder")}
                  className={inputClassName}
                />
                {companyDraft.length > 0 && (
                  <button
                    type="button"
                    aria-label="Очистить поле названия компании"
                    onClick={() => setCompanyDraft("")}
                    className={clearInputButtonClassName}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  aria-label={t("search.find")}
                  className={inputButtonClassName}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>

              <div className="relative">
                <label className="sr-only" htmlFor="catalog-search-service">
                  {t("search.servicePlaceholder")}
                </label>
                <input
                  id="catalog-search-service"
                  value={serviceDraft}
                  onChange={(e) => setServiceDraft(e.target.value)}
                  inputMode="search"
                  placeholder={t("search.servicePlaceholder")}
                  className={inputClassName}
                />
                {serviceDraft.length > 0 && (
                  <button
                    type="button"
                    aria-label="Очистить поле товаров и услуг"
                    onClick={() => setServiceDraft("")}
                    className={clearInputButtonClassName}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  aria-label={t("search.find")}
                  className={inputButtonClassName}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Location Filter */}
        <div className="bg-white border-b border-gray-200 py-3">
          <div className="container mx-auto px-4">
            <div className="hidden sm:block relative mb-3">
              <button
                type="button"
                onClick={() => setRegionMenuOpen((v) => !v)}
                aria-label={t("filter.region")}
                aria-haspopup="listbox"
                aria-expanded={regionMenuOpen}
                className={`w-full flex items-center justify-between gap-2 rounded-2xl bg-white shadow-sm border border-gray-200 px-4 py-3.5 text-[15px] font-medium focus:outline-none focus:ring-2 focus:ring-yellow-300/70 focus:border-[#820251]/30 ${
                  selectedRegion ? "text-[#820251]" : "text-gray-500/60"
                }`}
              >
                <span className="min-w-0 truncate">
                  {selectedRegion ? t(`region.${selectedRegion}`) : t("filter.chooseRegion")}
                </span>
                <svg
                  className={`w-5 h-5 transition-transform ${regionMenuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {regionMenuOpen && (
                <>
                  <div className="hidden sm:block fixed inset-0 z-10" onClick={() => setRegionMenuOpen(false)} />
                  <div
                    role="listbox"
                    className="hidden sm:block absolute left-0 right-0 z-20 mt-2 rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRegion(null);
                        setCityDraft("");
                        setRegionMenuOpen(false);
                        cityInputRef.current?.focus();
                      }}
                      className={`w-full px-5 py-3 text-left text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                        !selectedRegion ? "text-[#820251] font-bold bg-gray-50/50" : "text-gray-700"
                      }`}
                    >
                      {t("search.allRegions")}
                    </button>
                    <div className="py-1 max-h-[50vh] overflow-y-auto">
                      {regions.map((r) => (
                        <button
                          key={r.slug}
                          type="button"
                          onClick={() => {
                            setSelectedRegion(r.slug);
                            setCityDraft("");
                            setRegionMenuOpen(false);
                            cityInputRef.current?.focus();
                          }}
                          className={`w-full px-5 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${
                            selectedRegion === r.slug ? "text-[#820251] font-bold bg-gray-50/50" : "text-gray-700"
                          }`}
                        >
                          {t(`region.${r.slug}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <label className="sr-only" htmlFor="catalog-filter-location">
                {t("filter.city")}
              </label>
              <input
                id="catalog-filter-location"
                ref={cityInputRef}
                value={cityDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setCityDraft(next);
                  if (next.trim() && selectedRegion) setSelectedRegion(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    navigateToSearch();
                  }
                }}
                inputMode="search"
                placeholder={t("filter.locationLabel")}
                className={inputClassName}
              />
              {cityDraft.length > 0 && (
                <button
                  type="button"
                  aria-label="Очистить поле локации"
                  onClick={() => {
                    setCityDraft("");
                    cityInputRef.current?.focus();
                  }}
                  className={clearInputButtonClassName}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                aria-label={t("search.find")}
                onClick={navigateToSearch}
                className={inputButtonClassName}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
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
              <p className="text-gray-500 mb-4">{t("company.notFoundDesc")}</p>
              <button
                onClick={() => setSelectedRegion(null)}
                className="inline-block text-[#820251] hover:underline"
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
