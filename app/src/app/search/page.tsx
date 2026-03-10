"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { regions } from "@/data/regions";
import type { BiznesinfoSearchResponse } from "@/lib/biznesinfo/types";
import { formatCompanyCount } from "@/lib/utils/plural";
import { tokenizeHighlightQuery } from "@/lib/utils/highlight";
import Pagination from "@/components/Pagination";
import Link from "next/link";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";

const PAGE_SIZE = 10;
const SEARCH_REQUEST_DEBOUNCE_MS = 120;

type SearchSupplyType = "any" | "delivery" | "pickup";
type SearchBusinessFormat = "any" | "b2b" | "b2c";

function normalizeSupplyType(raw: string | null): SearchSupplyType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "delivery") return "delivery";
  if (value === "pickup") return "pickup";
  return "any";
}

function normalizeBusinessFormat(raw: string | null): SearchBusinessFormat {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "b2b") return "b2b";
  if (value === "b2c") return "b2c";
  return "any";
}

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
  const supplyTypeFromUrl = normalizeSupplyType(searchParams.get("supply_type"));
  const businessFormatFromUrl = normalizeBusinessFormat(searchParams.get("business_format"));

  const [companyDraft, setCompanyDraft] = useState(query);
  const [serviceDraft, setServiceDraft] = useState(serviceQuery);
  const [cityDraft, setCityDraft] = useState(city);
  const [supplyTypeDraft, setSupplyTypeDraft] = useState<SearchSupplyType>(supplyTypeFromUrl);
  const [businessFormatDraft, setBusinessFormatDraft] = useState<SearchBusinessFormat>(businessFormatFromUrl);
  const [debouncedCompanyDraft, setDebouncedCompanyDraft] = useState(query.trim());
  const [debouncedServiceDraft, setDebouncedServiceDraft] = useState(serviceQuery.trim());
  const [debouncedCityDraft, setDebouncedCityDraft] = useState(city.trim());
  const [debouncedSupplyTypeDraft, setDebouncedSupplyTypeDraft] = useState<SearchSupplyType>(supplyTypeFromUrl);
  const [debouncedBusinessFormatDraft, setDebouncedBusinessFormatDraft] = useState<SearchBusinessFormat>(businessFormatFromUrl);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  const inputClassName =
    "w-full rounded-2xl bg-white text-[#820251] font-medium text-[15px] placeholder:text-gray-500/60 placeholder:font-normal px-4 pr-24 py-3.5 shadow-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/70 focus:border-[#820251]/30 focus:placeholder:text-gray-500/60";
  const inputButtonClassName =
    "absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-[#820251]/10 text-[#820251] hover:bg-[#820251]/15 active:bg-[#820251]/20 transition-colors flex items-center justify-center";
  const clearInputButtonClassName =
    "absolute right-14 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-[#820251]/60 hover:text-[#820251] hover:bg-[#820251]/10 active:bg-[#820251]/15 transition-colors flex items-center justify-center";

  useEffect(() => {
    setCompanyDraft(query);
    setServiceDraft(serviceQuery);
    setCityDraft(city);
    setSupplyTypeDraft(supplyTypeFromUrl);
    setBusinessFormatDraft(businessFormatFromUrl);
    setDebouncedCompanyDraft(query.trim());
    setDebouncedServiceDraft(serviceQuery.trim());
    setDebouncedCityDraft(city.trim());
    setDebouncedSupplyTypeDraft(supplyTypeFromUrl);
    setDebouncedBusinessFormatDraft(businessFormatFromUrl);
  }, [query, serviceQuery, city, supplyTypeFromUrl, businessFormatFromUrl]);

  // Local debounced search source of truth: keeps results/logos updating without waiting for URL round-trip.
  useEffect(() => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      setDebouncedCompanyDraft(companyDraft.trim());
      setDebouncedServiceDraft(serviceDraft.trim());
      setDebouncedCityDraft(cityDraft.trim());
      setDebouncedSupplyTypeDraft(supplyTypeDraft);
      setDebouncedBusinessFormatDraft(businessFormatDraft);
    }, SEARCH_REQUEST_DEBOUNCE_MS);

    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
  }, [companyDraft, serviceDraft, cityDraft, supplyTypeDraft, businessFormatDraft]);

  // If region is present in URL, it becomes the source of truth.
  useEffect(() => {
    if (!regionFromUrl || city.trim()) return;
    const next = regions.some((r) => r.slug === regionFromUrl) ? regionFromUrl : null;
    if (next !== selectedRegion) setSelectedRegion(next);
  }, [regionFromUrl, city, selectedRegion, setSelectedRegion]);

  useEffect(() => {
    if (regionFromUrl || city.trim()) return;
    if (selectedRegion) setSelectedRegion(null);
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
      supply_type?: SearchSupplyType;
      business_format?: SearchBusinessFormat;
    },
  ) => {
    const params = new URLSearchParams();
    const nextQ = (overrides?.q ?? companyDraft).trim();
    const nextService = (overrides?.service ?? serviceDraft).trim();
    const nextCity = (overrides?.city ?? cityDraft).trim();
    const nextRegion = overrides?.region ?? selectedRegion;
    const nextSupplyType = overrides?.supply_type ?? supplyTypeDraft;
    const nextBusinessFormat = overrides?.business_format ?? businessFormatDraft;

    if (nextQ) params.set("q", nextQ);
    if (nextService) params.set("service", nextService);
    if (nextCity) params.set("city", nextCity);
    if (!nextCity && nextRegion) params.set("region", nextRegion);
    if (nextSupplyType !== "any") params.set("supply_type", nextSupplyType);
    if (nextBusinessFormat !== "any") params.set("business_format", nextBusinessFormat);

    const qs = params.toString();
    const url = qs ? `/search?${qs}` : "/search";
    if (mode === "replace") router.replace(url, { scroll: false });
    else router.push(url);
  };

  const handleStickyBackClick = () => {
    const fallbackUrl = "/#catalog";
    if (typeof window === "undefined") {
      router.push(fallbackUrl);
      return;
    }

    if (window.history.length <= 1) {
      router.push(fallbackUrl);
      return;
    }

    const before = window.location.href;
    router.back();
    window.setTimeout(() => {
      if (window.location.href === before) {
        router.push(fallbackUrl);
      }
    }, 220);
  };

  const [data, setData] = useState<BiznesinfoSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const latestDataRef = useRef<BiznesinfoSearchResponse | null>(null);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  // Debounced auto-update on field edits (keeps UX fast and compact on mobile).
  useEffect(() => {
    const nextQ = companyDraft.trim();
    const nextService = serviceDraft.trim();
    const nextCity = cityDraft.trim();
    const nextSupplyType = supplyTypeDraft;
    const nextBusinessFormat = businessFormatDraft;

    if (
      nextQ === query.trim() &&
      nextService === serviceQuery.trim() &&
      nextCity === city.trim() &&
      nextSupplyType === supplyTypeFromUrl &&
      nextBusinessFormat === businessFormatFromUrl
    ) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      navigateToSearch("replace", {
        q: nextQ,
        service: nextService,
        city: nextCity,
        supply_type: nextSupplyType,
        business_format: nextBusinessFormat,
      });
    }, 500);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [
    companyDraft,
    serviceDraft,
    cityDraft,
    supplyTypeDraft,
    businessFormatDraft,
    query,
    serviceQuery,
    city,
    supplyTypeFromUrl,
    businessFormatFromUrl,
  ]);

  const effectiveQuery = debouncedCompanyDraft;
  const effectiveServiceQuery = debouncedServiceDraft;
  const effectiveCity = debouncedCityDraft;
  const effectiveSupplyType = debouncedSupplyTypeDraft;
  const effectiveBusinessFormat = debouncedBusinessFormatDraft;

  // Reset page when effective search params or region change
  useEffect(() => {
    setCurrentPage(1);
  }, [effectiveQuery, effectiveServiceQuery, effectiveCity, effectiveSupplyType, effectiveBusinessFormat, selectedRegion]);

  useEffect(() => {
    const q = effectiveQuery;
    const svc = effectiveServiceQuery;
    const cityValue = effectiveCity;
    const supplyType = effectiveSupplyType;
    const businessFormat = effectiveBusinessFormat;
    if (!q && !svc && !cityValue) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const region = cityValue ? "" : selectedRegion || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (svc) params.set("service", svc);
    if (cityValue) params.set("city", cityValue);
    if (region) params.set("region", region);
    if (supplyType !== "any") params.set("supply_type", supplyType);
    if (businessFormat !== "any") params.set("business_format", businessFormat);
    params.set("offset", String((currentPage - 1) * PAGE_SIZE));
    params.set("limit", String(PAGE_SIZE));
    const controller = new AbortController();

    setIsLoading(true);

    fetch(`/api/biznesinfo/search?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: BiznesinfoSearchResponse | null) => {
        if (controller.signal.aborted) return;
        setData(resp);
        setIsLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        void error;
        if (!latestDataRef.current) setData(null);
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [
    currentPage,
    effectiveQuery,
    effectiveServiceQuery,
    effectiveCity,
    effectiveSupplyType,
    effectiveBusinessFormat,
    selectedRegion,
  ]);

  const totalPages = data ? Math.ceil((data.total || 0) / PAGE_SIZE) : 0;

  const companies = useMemo(() => {
    // Keep backend ranking order as-is; don't promote cards by visual completeness/logo.
    return data?.companies || [];
  }, [data]);

  const highlightCompanyTokens = useMemo(() => tokenizeHighlightQuery(effectiveQuery), [effectiveQuery]);
  const highlightServiceTokens = useMemo(() => tokenizeHighlightQuery(effectiveServiceQuery), [effectiveServiceQuery]);
  const highlightLocationTokens = useMemo(() => tokenizeHighlightQuery(effectiveCity), [effectiveCity]);
  const highlightNameTokens = useMemo(() => {
    return highlightCompanyTokens.length > 0 ? highlightCompanyTokens : highlightServiceTokens;
  }, [highlightCompanyTokens, highlightServiceTokens]);

  const applyZeroVariant = (
    patch: NonNullable<BiznesinfoSearchResponse["zero_results"]>["close_variants"][number]["params"],
  ) => {
    const nextQ = patch.q !== undefined ? patch.q : companyDraft;
    const nextService = patch.service !== undefined ? patch.service : serviceDraft;
    const nextCity = patch.city !== undefined ? patch.city : cityDraft;
    const nextRegion = patch.region !== undefined ? patch.region : selectedRegion;
    const nextSupply = patch.supply_type !== undefined ? patch.supply_type : supplyTypeDraft;
    const nextFormat = patch.business_format !== undefined ? patch.business_format : businessFormatDraft;

    if (patch.region !== undefined && !patch.region) setSelectedRegion(null);
    if (patch.city !== undefined) setCityDraft(patch.city);
    if (patch.q !== undefined) setCompanyDraft(patch.q);
    if (patch.service !== undefined) setServiceDraft(patch.service);
    if (patch.supply_type !== undefined) setSupplyTypeDraft(nextSupply);
    if (patch.business_format !== undefined) setBusinessFormatDraft(nextFormat);

    navigateToSearch("push", {
      q: nextQ,
      service: nextService,
      city: nextCity,
      region: nextRegion,
      supply_type: nextSupply,
      business_format: nextFormat,
    });
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Search Header */}
        <div className="bg-gradient-to-r from-[#b10a78] to-[#7a0150] text-white py-6">
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
          {(effectiveQuery || effectiveServiceQuery || effectiveCity || selectedRegion) && (
            <div className="mb-6">
              <p className="text-gray-600">
                {effectiveQuery && (
                  <>
                    {t("search.companyPlaceholder")}:{" "}
                    <span className="font-bold text-[#820251]">«{effectiveQuery}»</span>
                  </>
                )}
                {effectiveQuery && effectiveServiceQuery && <span className="text-gray-400"> · </span>}
                {effectiveServiceQuery && (
                  <>
                    {t("search.servicePlaceholder")}:{" "}
                    <span className="font-bold text-[#820251]">«{effectiveServiceQuery}»</span>
                  </>
                )}
                {(effectiveQuery || effectiveServiceQuery) && effectiveCity && <span className="text-gray-400"> · </span>}
                {effectiveCity && (
                  <>
                    {t("filter.city")}: <span className="font-bold text-[#820251]">{effectiveCity}</span>
                  </>
                )}
                {selectedRegion && !effectiveCity && <span className="font-bold text-[#820251]"> — {regionName}</span>}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {t("search.found")}: {isLoading ? "…" : formatCompanyCount(data?.total ?? 0)}
              </p>
            </div>
          )}

          {isLoading && (data?.companies || []).length > 0 && (
            <p className="text-sm text-gray-500 mb-4">{t("common.loading")}…</p>
          )}

          {isLoading && (data?.companies || []).length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">{t("common.loading")}</div>
          ) : !effectiveQuery && !effectiveServiceQuery && !effectiveCity ? (
            <div className="bg-white rounded-lg p-10 text-center text-gray-500">
              {t("search.placeholder")}
            </div>
          ) : (data?.companies || []).length === 0 ? (
            <div className="bg-white rounded-lg p-10 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">{t("company.notFound")}</h3>
              <p className="text-gray-500 mb-4">{data?.zero_results?.message || t("company.notFoundDesc")}</p>

              {(data?.zero_results?.close_variants || []).length > 0 && (
                <div className="mb-5 text-left max-w-2xl mx-auto">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Близкие варианты:</p>
                  <div className="flex flex-wrap gap-2">
                    {(data?.zero_results?.close_variants || []).map((variant, idx) => (
                      <button
                        key={`${variant.label}-${idx}`}
                        type="button"
                        onClick={() => applyZeroVariant(variant.params)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#820251]/25 text-[#820251] hover:bg-[#820251]/10 transition-colors"
                      >
                        {variant.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(data?.zero_results?.sample_companies || []).length > 0 && (
                <div className="mb-5 text-left max-w-2xl mx-auto">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Похожие компании по текущему запросу:</p>
                  <ul className="space-y-1.5">
                    {(data?.zero_results?.sample_companies || []).slice(0, 5).map((company) => (
                      <li key={company.id}>
                        <Link
                          href={`/company/${companySlugForUrl(company.id)}`}
                          className="text-sm text-[#820251] hover:underline"
                        >
                          {company.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedRegion && (
                <button
                  onClick={() => {
                    setSelectedRegion(null);
                    navigateToSearch("push", { region: null });
                  }}
                  className="text-[#820251] hover:underline mb-4 block mx-auto"
                >
                  {t("company.showAllRegions")}
                </button>
              )}
              <Link
                href="/#catalog"
                className="inline-block bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#7a0150] transition-colors"
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

      <button
        type="button"
        onClick={handleStickyBackClick}
        aria-label={t("common.back")}
        title={t("common.back")}
        className="md:hidden fixed bottom-6 left-4 z-[70] w-12 h-12 rounded-full bg-[#820251] text-white shadow-lg hover:bg-[#7a0150] active:bg-[#6f0148] transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f4f6]"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

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
