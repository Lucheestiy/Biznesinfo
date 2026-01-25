"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { IbizCompanySummary, IbizSearchResponse } from "@/lib/ibiz/types";
import { formatCompanyCount } from "@/lib/utils/plural";
import { tokenizeHighlightQuery } from "@/lib/utils/highlight";
import Pagination from "@/components/Pagination";
import Link from "next/link";

const PAGE_SIZE = 10;

function SearchResults() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();
  const router = useRouter();

  const query = searchParams.get("q") || "";
  const legacyKeywords = searchParams.get("keywords") || "";
  const serviceQuery = searchParams.get("service") || legacyKeywords;
  const city = searchParams.get("city") || "";
  const regionFromUrl = searchParams.get("region") || "";

  const [companyDraft, setCompanyDraft] = useState(query);
  const [serviceDraft, setServiceDraft] = useState(serviceQuery);
  const [cityDraft, setCityDraft] = useState(city);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  const inputClassName =
    "w-full rounded-2xl bg-white text-[#820251] font-medium text-[15px] placeholder:text-gray-500/60 placeholder:font-normal px-4 pr-14 py-3.5 shadow-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/70 focus:border-[#820251]/30 focus:placeholder:text-gray-500/60";
  const inputButtonClassName =
    "absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-[#820251]/10 text-[#820251] hover:bg-[#820251]/15 active:bg-[#820251]/20 transition-colors flex items-center justify-center";

  useEffect(() => {
    setCompanyDraft(query);
    setServiceDraft(serviceQuery);
    setCityDraft(city);
  }, [query, serviceQuery, city]);

  // If region is present in URL, it becomes the source of truth.
  useEffect(() => {
    if (!regionFromUrl || city.trim()) return;
    const next = regions.some((r) => r.slug === regionFromUrl) ? regionFromUrl : null;
    if (next !== selectedRegion) setSelectedRegion(next);
  }, [regionFromUrl, city, selectedRegion, setSelectedRegion]);

  // If user is searching by city/street, region becomes irrelevant (auto-detected by location).
  useEffect(() => {
    if (!city.trim()) return;
    if (selectedRegion) setSelectedRegion(null);
  }, [city, selectedRegion, setSelectedRegion]);

  const navigateToSearch = (
    mode: "push" | "replace",
    overrides?: {
      q?: string;
      service?: string;
      city?: string;
      region?: string | null;
    },
  ) => {
    const params = new URLSearchParams();
    const nextQ = (overrides?.q ?? companyDraft).trim();
    const nextService = (overrides?.service ?? serviceDraft).trim();
    const nextCity = (overrides?.city ?? cityDraft).trim();
    const nextRegion = overrides?.region ?? selectedRegion;

    if (nextQ) params.set("q", nextQ);
    if (nextService) params.set("service", nextService);
    if (nextCity) params.set("city", nextCity);
    if (!nextCity && nextRegion) params.set("region", nextRegion);

    const qs = params.toString();
    const url = qs ? `/search?${qs}` : "/search";
    if (mode === "replace") router.replace(url);
    else router.push(url);
  };

  const [data, setData] = useState<IbizSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Debounced auto-update on field edits (keeps UX fast and compact on mobile).
  useEffect(() => {
    const nextQ = companyDraft.trim();
    const nextService = serviceDraft.trim();
    const nextCity = cityDraft.trim();

    if (nextQ === query.trim() && nextService === serviceQuery.trim() && nextCity === city.trim()) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      navigateToSearch("replace", { q: nextQ, service: nextService, city: nextCity });
    }, 500);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [companyDraft, serviceDraft, cityDraft, query, serviceQuery, city]);

  // Reset page when query or region changes
  useEffect(() => {
    setCurrentPage(1);
  }, [query, serviceQuery, city, selectedRegion]);

  const fetchSearch = (page: number) => {
    const q = query.trim();
    const svc = serviceQuery.trim();
    const cityValue = city.trim();
    if (!q && !svc && !cityValue) {
      setData(null);
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    setIsLoading(true);
    const region = cityValue ? "" : selectedRegion || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (svc) params.set("service", svc);
    if (cityValue) params.set("city", cityValue);
    if (region) params.set("region", region);
    params.set("offset", String((page - 1) * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));

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
  };

  useEffect(() => {
    fetchSearch(currentPage);
  }, [currentPage, query, serviceQuery, city, selectedRegion]);

  const totalPages = data ? Math.ceil((data.total || 0) / PAGE_SIZE) : 0;

  const companies = useMemo(() => {
    const items = data?.companies || [];
    const withLogo: IbizCompanySummary[] = [];
    const withoutLogo: IbizCompanySummary[] = [];
    for (const c of items) {
      if ((c.logo_url || "").trim()) withLogo.push(c);
      else withoutLogo.push(c);
    }
    return [...withLogo, ...withoutLogo];
  }, [data]);

  const highlightCompanyTokens = useMemo(() => tokenizeHighlightQuery(query), [query]);
  const highlightServiceTokens = useMemo(() => tokenizeHighlightQuery(serviceQuery), [serviceQuery]);
  const highlightLocationTokens = useMemo(() => tokenizeHighlightQuery(city), [city]);
  const highlightNameTokens = useMemo(() => {
    return highlightCompanyTokens.length > 0 ? highlightCompanyTokens : highlightServiceTokens;
  }, [highlightCompanyTokens, highlightServiceTokens]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Search Header */}
        <div className="bg-gradient-to-r from-[#820251] to-[#5a0138] text-white py-6">
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold">{t("search.results")}</h1>

            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                navigateToSearch("push");
              }}
            >
              {/* Company name */}
              <div className="relative">
                <label className="sr-only" htmlFor="search-company">
                  {t("search.companyPlaceholder")}
                </label>
                  <input
                    id="search-company"
                    value={companyDraft}
                    onChange={(e) => setCompanyDraft(e.target.value)}
                    inputMode="search"
                    placeholder={t("search.companyPlaceholder")}
                    className={inputClassName}
                  />
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

              {/* Products & services */}
              <div className="relative">
                <label className="sr-only" htmlFor="search-service">
                  {t("search.servicePlaceholder")}
                </label>
                  <input
                    id="search-service"
                    value={serviceDraft}
                    onChange={(e) => setServiceDraft(e.target.value)}
                    inputMode="search"
                    placeholder={t("search.servicePlaceholder")}
                    className={inputClassName}
                  />
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
                        navigateToSearch("push", { region: null, city: "" });
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
                            navigateToSearch("push", { region: r.slug, city: "" });
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
              <label className="sr-only" htmlFor="filter-location">
                {t("filter.city")}
              </label>
              <input
                id="filter-location"
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
                    navigateToSearch("push");
                  }
                }}
                inputMode="search"
                placeholder={t("filter.locationLabel")}
                className={inputClassName}
              />
              <button
                type="button"
                aria-label={t("search.find")}
                onClick={() => navigateToSearch("push")}
                className={inputButtonClassName}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="container mx-auto py-10 px-4">
          {/* Query info */}
          {(query || serviceQuery || city || selectedRegion) && (
            <div className="mb-6">
              <p className="text-gray-600">
                {query && (
                  <>
                    {t("search.companyPlaceholder")}:{" "}
                    <span className="font-bold text-[#820251]">«{query}»</span>
                  </>
                )}
                {query && serviceQuery && <span className="text-gray-400"> · </span>}
                {serviceQuery && (
                  <>
                    {t("search.servicePlaceholder")}:{" "}
                    <span className="font-bold text-[#820251]">«{serviceQuery}»</span>
                  </>
                )}
                {(query || serviceQuery) && city && <span className="text-gray-400"> · </span>}
                {city && (
                  <>
                    {t("filter.city")}: <span className="font-bold text-[#820251]">{city}</span>
                  </>
                )}
                {selectedRegion && !city && <span className="font-bold text-[#820251]"> — {regionName}</span>}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {t("search.found")}: {isLoading ? "…" : formatCompanyCount(data?.total ?? 0)}
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !query && !serviceQuery && !city ? (
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
            <div className="space-y-6">
              <div className="flex flex-col gap-4">
                {companies.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    showCategory
                    variant="search"
                    highlightNameTokens={highlightNameTokens}
                    highlightServiceTokens={highlightServiceTokens}
                    highlightLocationTokens={highlightLocationTokens}
                  />
                ))}
              </div>
              {/* Pagination */}
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
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
