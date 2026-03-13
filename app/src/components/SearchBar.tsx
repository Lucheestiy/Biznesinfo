"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import type { BiznesinfoSuggestResponse } from "@/lib/biznesinfo/types";
import Rubricator from "./Rubricator";

interface SearchBarProps {
  variant?: "hero" | "compact" | "compactKeywords";
}

interface SearchSuggestion {
  type: "company" | "category" | "subcategory" | "rubric";
  companyId?: string;
  text: string;
  url: string;
  icon: string;
  subtitle?: string;
  count?: number;
}

const LOGO_PROXY_VERSION = "3";
const PHONE_HINT_HIDE_MS = 1100;

export default function SearchBar({ variant = "hero" }: SearchBarProps) {
  const { t } = useLanguage();
  const { selectedRegion } = useRegion();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companyQuery, setCompanyQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeInput, setActiveInput] = useState<"company" | "service">("company");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [keywordsQuery, setKeywordsQuery] = useState("");
  const [phoneHintTarget, setPhoneHintTarget] = useState<"mobile" | "desktop" | null>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const keywordsInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const phoneHintTimeoutRef = useRef<number | null>(null);

  const activeInputRef = activeInput === "company" ? companyInputRef : keywordsInputRef;

  // Initialize query from URL parameter
  useEffect(() => {
    const urlQuery = searchParams.get("q") || "";
    const urlService = searchParams.get("service") || "";
    const urlKeywords = searchParams.get("keywords") || "";
    const urlCity = searchParams.get("city") || "";

    setCompanyQuery(urlQuery);
    setServiceQuery(urlService);
    setKeywordsQuery(urlKeywords);
    setCityQuery(variant === "hero" ? urlCity : "");

    if (urlQuery && companyInputRef.current) {
      companyInputRef.current.focus();
    }
  }, [searchParams, variant]);

  // Update suggestions when query/region changes
  useEffect(() => {
    const q = (
      activeInput === "company"
        ? companyQuery
        : (keywordsQuery.trim() ? keywordsQuery : serviceQuery)
    ).trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSelectedIndex(-1);
      return;
    }

    const abort = new AbortController();
    const region = selectedRegion || "";
    
    // "Название компании" → /api/biznesinfo/suggest (companies)
    // "Продукция и услуги" → /api/biznesinfo/catalog/suggest (categories/rubrics)
    const isCompanySearch = activeInput === "company";
    const apiUrl = isCompanySearch 
      ? `/api/biznesinfo/suggest?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}`
      : `/api/biznesinfo/catalog/suggest?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}`;
    
    fetch(apiUrl, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BiznesinfoSuggestResponse | null) => {
        if (!data) return;
        
        // API already returns correct type:
        // - /api/biznesinfo/suggest → companies
        // - /api/biznesinfo/catalog/suggest → categories/rubrics
        
        const mapped: SearchSuggestion[] = (data.suggestions || [])
          .map((s) => ({
            type: s.type as "company" | "category" | "rubric",
            companyId: s.type === "company" && "id" in s ? String(s.id || "").trim() : undefined,
            text: s.name,
            url: s.url,
            icon: s.icon || (s.type === "category" ? "📁" : s.type === "rubric" ? "📌" : "🏢"),
            subtitle: s.type === "company" 
              ? s.subtitle 
              : ('category_name' in s && s.category_name ? `${s.category_name} • ${s.count} компаний` : `${s.count} компаний`),
            count: 'count' in s ? s.count : undefined,
          }))
          .slice(0, 8);

        setSuggestions(mapped);
        setSelectedIndex(-1);
      })
      .catch(() => {
        // ignore (abort/network)
      });

    return () => abort.abort();
  }, [activeInput, companyQuery, keywordsQuery, selectedRegion, serviceQuery]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        activeInputRef.current &&
        !activeInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [activeInputRef]);

  useEffect(() => {
    return () => {
      if (phoneHintTimeoutRef.current) {
        window.clearTimeout(phoneHintTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    setShowSuggestions(false);
    const params = new URLSearchParams();
    // Company name search
    const companyName = companyQuery.trim();
    if (companyName) {
      params.set("q", companyName);
    }
    // Service/products search (separate from keywords)
    const service = serviceQuery.trim();
    const keywords = keywordsQuery.trim();
    const effectiveService = keywords || service;
    if (effectiveService) {
      params.set("service", effectiveService);
    }
    // Keywords (additional filter)
    if (keywords && service && keywords !== service) {
      params.set("keywords", keywords);
    }
    const location = variant === "hero" ? cityQuery.trim() : "";
    if (location) {
      params.set("city", location);
    }
    if (selectedRegion && !location) {
      params.set("region", selectedRegion);
    }
    router.push(`/search?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (showSuggestions && suggestions.length > 0 && selectedIndex >= 0) {
        e.preventDefault();
        router.push(suggestions[selectedIndex].url);
        setShowSuggestions(false);
        return;
      }

      e.preventDefault();
      handleSearch();
      return;
    }

    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (url: string) => {
    setShowSuggestions(false);
    router.push(url);
  };

  const isImageIcon = (icon: string): boolean => {
    const normalized = (icon || "").trim();
    if (!normalized) return false;
    return normalized.startsWith("/") || /^https?:\/\//iu.test(normalized);
  };

  const shouldProxyAbsoluteIcon = (iconUrl: string): boolean => {
    try {
      const host = new URL(iconUrl).hostname.toLowerCase();
      return host === "ibiz.by" || host.endsWith(".ibiz.by");
    } catch {
      return false;
    }
  };

  const renderSuggestionIcon = (suggestion: SearchSuggestion, size: "mobile" | "desktop") => {
    const icon = (suggestion.icon || "").trim();

    if (icon && isImageIcon(icon)) {
      const companyId = (() => {
        const direct = String(suggestion.companyId || "").trim();
        if (direct) return direct;
        const url = String(suggestion.url || "").trim();
        if (url.startsWith("/company/")) {
          return decodeURIComponent(url.slice("/company/".length).split("?")[0] || "").trim();
        }
        return "";
      })();
      const src = (() => {
        if (icon.startsWith("/images/") && companyId) {
          return `/api/biznesinfo/logo?id=${encodeURIComponent(companyId)}&path=${encodeURIComponent(icon)}&v=${LOGO_PROXY_VERSION}`;
        }
        if (/^https?:\/\//iu.test(icon)) {
          if (shouldProxyAbsoluteIcon(icon)) {
            return `/api/biznesinfo/logo?u=${encodeURIComponent(icon)}&v=${LOGO_PROXY_VERSION}`;
          }
          return icon;
        }
        return icon;
      })();
      const boxClassName = size === "desktop"
        ? "w-11 h-11 rounded-xl border border-gray-200 bg-white/90 shadow-sm flex-shrink-0 overflow-hidden"
        : "w-10 h-10 rounded-lg border border-gray-200 bg-white/90 shadow-sm flex-shrink-0 overflow-hidden";
      return (
        <span className={boxClassName}>
          <img
            src={src}
            alt=""
            loading="lazy"
            className="w-full h-full object-contain bg-white"
            onError={(e) => {
              e.currentTarget.src = "/images/logo/no-logo.png";
            }}
          />
        </span>
      );
    }

    return <span className={`${size === "desktop" ? "text-2xl" : "text-xl"} flex-shrink-0`}>{icon || "🏢"}</span>;
  };

  const renderPhoneSearchHint = (size: "mobile" | "desktop") => {
    const wrapperClass = size === "mobile"
      ? "mx-1 w-6 h-6 rounded-full bg-[#820251]/10 text-[#820251] border border-[#820251]/20 flex items-center justify-center shrink-0"
      : "mx-2 w-7 h-7 rounded-full bg-[#820251]/10 text-[#820251] border border-[#820251]/20 flex items-center justify-center shrink-0";
    const iconClass = size === "mobile" ? "w-3.5 h-3.5" : "w-4 h-4";
    const isVisible = phoneHintTarget === size;

    const showPhoneHint = () => {
      setPhoneHintTarget(size);
      if (phoneHintTimeoutRef.current) {
        window.clearTimeout(phoneHintTimeoutRef.current);
      }
      phoneHintTimeoutRef.current = window.setTimeout(() => {
        setPhoneHintTarget(null);
        phoneHintTimeoutRef.current = null;
      }, PHONE_HINT_HIDE_MS);
    };

    return (
      <span className="relative flex items-center shrink-0">
        {isVisible && (
          <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold bg-[#820251] text-white px-2 py-1 rounded-lg shadow-lg z-20">
            Поиск по номеру телефона
          </span>
        )}
        <button
          type="button"
          className={wrapperClass}
          title="Можно искать по номеру телефона"
          aria-label="Можно искать по номеру телефона"
          onClick={showPhoneHint}
        >
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 5a2 2 0 012-2h2.2a1 1 0 01.98.804l.57 2.61a1 1 0 01-.29.95l-1.2 1.2a15.05 15.05 0 006.66 6.66l1.2-1.2a1 1 0 01.95-.29l2.61.57a1 1 0 01.804.98V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z"
            />
          </svg>
        </button>
      </span>
    );
  };

  if (variant === "compact") {
    return (
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="flex-grow relative">
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("search.placeholder")}
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="portal-dialog-typography search-input search-input-on-dark w-full p-2 pr-10 bg-white/10 text-white border border-white/30 rounded-lg focus:outline-none focus:border-white/60 focus:ring-1 focus:ring-white/40"
          />
        </div>

        {/* Keywords input */}
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("search.keywordsPlaceholder")}
          value={keywordsQuery}
          onChange={(e) => setKeywordsQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="portal-dialog-typography p-2 text-gray-600 border border-gray-300 bg-white rounded-lg focus:outline-none focus:border-[#820251] max-w-[150px]"
        />

        {/* Search button - icon */}
        <button
          type="button"
          onClick={handleSearch}
          className="bg-[#820251] text-white p-2.5 rounded-lg hover:bg-[#6a0143] transition-colors shadow-md hover:shadow-lg active:scale-95"
          title={t("search.find")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>
    );
  }

  if (variant === "compactKeywords") {
    return (
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="flex-grow relative">
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("search.keywordsPlaceholder")}
            value={keywordsQuery}
            onChange={(e) => setKeywordsQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="portal-dialog-typography search-input search-input-on-dark w-full p-2 pr-10 bg-white/10 text-white border border-white/30 rounded-lg focus:outline-none focus:border-white/60 focus:ring-1 focus:ring-white/40"
          />
        </div>

        {/* Search button - icon */}
        <button
          type="button"
          onClick={handleSearch}
          className="bg-[#820251] text-white p-2.5 rounded-lg hover:bg-[#6a0143] transition-colors shadow-md hover:shadow-lg active:scale-95"
          title={t("search.find")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSearch} className="w-full max-w-4xl mx-auto px-4 md:px-0">
      {/* Mobile layout - separate cards */}
      <div className="flex md:hidden flex-col gap-3">
        {/* Search input card */}
        <div className="relative">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden
            hover:shadow-xl hover:scale-[1.01]
            transition-all duration-300">
            <div className="flex items-center">
              <div className="pl-4 text-[#820251]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <input
                ref={companyInputRef}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("search.placeholder")}
                value={companyQuery}
                onChange={(e) => {
                  setCompanyQuery(e.target.value);
                  setActiveInput("company");
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  setActiveInput("company");
                  setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                className="portal-dialog-typography search-input-mobile flex-grow min-w-0 py-3.5 px-3 text-gray-600 focus:outline-none text-base bg-transparent"
              />
              {/* Search button inside input */}
              <button
                type="button"
                onClick={handleSearch}
                className="m-2 w-10 h-10 shrink-0 flex items-center justify-center bg-gradient-to-r from-[#820251] to-[#a80368] text-white rounded-xl shadow-md
                  hover:shadow-[0_0_20px_rgba(255,255,255,0.6)] hover:scale-110
                  active:scale-95 transition-all duration-300 group/btn"
                title={t("search.find")}
              >
                <svg className="w-5 h-5 transition-all duration-300 group-hover/btn:text-yellow-400 group-hover/btn:drop-shadow-[0_0_10px_rgba(255,255,255,0.9)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Autocomplete suggestions for mobile */}
          {showSuggestions && activeInput === "company" && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl max-h-[50vh] overflow-y-auto overscroll-contain"
            >
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.type}-${suggestion.url}`}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion.url)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                    idx === selectedIndex ? "bg-gray-100" : ""
                  } ${idx > 0 ? "border-t border-gray-100" : ""}`}
                >
                  {renderSuggestionIcon(suggestion, "mobile")}
                  <div className="flex-grow min-w-0">
                    <div className="font-medium text-gray-800 truncate">{suggestion.text}</div>
                    {suggestion.subtitle && (
                      <div className={`text-sm text-gray-500 ${suggestion.type === "company" ? "break-words" : "truncate"}`}>
                        {suggestion.subtitle}
                      </div>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full flex-shrink-0 bg-green-100 text-green-700">
                    {suggestion.type === "company" ? t("search.company") : t("search.category")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Keywords input card - mobile */}
        <div className="relative bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden
          hover:shadow-xl hover:scale-[1.01]
          transition-all duration-300">
          <div className="flex items-center">
            <div className="pl-4 text-[#820251]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <input
              ref={keywordsInputRef}
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("search.keywordsPlaceholder")}
              value={keywordsQuery}
              onChange={(e) => {
                setKeywordsQuery(e.target.value);
                setActiveInput("service");
                setShowSuggestions(true);
              }}
              onFocus={() => {
                setActiveInput("service");
                setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              className="portal-dialog-typography flex-grow min-w-0 py-3.5 px-3 text-gray-600 focus:outline-none text-base bg-transparent"
            />
            {renderPhoneSearchHint("mobile")}
            <button
              type="button"
              onClick={handleSearch}
              className="m-2 w-10 h-10 shrink-0 flex items-center justify-center bg-gradient-to-r from-[#820251] to-[#a80368] text-white rounded-xl shadow-md
                hover:shadow-[0_0_20px_rgba(255,255,255,0.6)] hover:scale-110
                active:scale-95 transition-all duration-300 group/btn"
              title={t("search.find")}
            >
              <svg className="w-5 h-5 transition-all duration-300 group-hover/btn:text-yellow-400 group-hover/btn:drop-shadow-[0_0_10px_rgba(255,255,255,0.9)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>

          {/* Autocomplete suggestions for mobile service input */}
          {showSuggestions && activeInput === "service" && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl max-h-[50vh] overflow-y-auto overscroll-contain"
            >
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.type}-${suggestion.url}`}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion.url)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                    idx === selectedIndex ? "bg-gray-100" : ""
                  } ${idx > 0 ? "border-t border-gray-100" : ""}`}
                >
                  {renderSuggestionIcon(suggestion, "mobile")}
                  <div className="flex-grow min-w-0">
                    <div className="font-medium text-gray-800 truncate">{suggestion.text}</div>
                    {suggestion.subtitle && (
                      <div className={`text-sm text-gray-500 ${suggestion.type === "company" ? "break-words" : "truncate"}`}>
                        {suggestion.subtitle}
                      </div>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full flex-shrink-0 bg-amber-100 text-amber-700">
                    {suggestion.type === "company" ? t("search.company") : t("search.category")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Location input card - mobile */}
        <div className="relative bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden
          hover:shadow-xl hover:scale-[1.01]
          transition-all duration-300">
          <div className="flex items-center">
            <div className="pl-4 text-[#820251]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("filter.locationLabel")}
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="portal-dialog-typography flex-grow min-w-0 py-3.5 px-3 text-gray-600 focus:outline-none text-base bg-transparent"
            />
            <button
              type="button"
              onClick={handleSearch}
              className="m-2 w-10 h-10 shrink-0 flex items-center justify-center bg-gradient-to-r from-[#820251] to-[#a80368] text-white rounded-xl shadow-md
                hover:shadow-[0_0_20px_rgba(255,255,255,0.6)] hover:scale-110
                active:scale-95 transition-all duration-300 group/btn"
              title={t("search.find")}
            >
              <svg className="w-5 h-5 transition-all duration-300 group-hover/btn:text-yellow-400 group-hover/btn:drop-shadow-[0_0_10px_rgba(255,255,255,0.9)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop layout - separate cards in row */}
      <div className="hidden md:flex items-stretch gap-4">
        {/* Search by company input card */}
        <div className="flex-1 basis-0 min-w-0 relative group/company">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 h-[68px] overflow-hidden
            hover:shadow-xl hover:scale-[1.02]
            transition-all duration-300 cursor-text">
            <div className="flex items-center h-full">
              <div className="pl-5 text-[#820251]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <input
                ref={companyInputRef}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("search.companyPlaceholder")}
                value={companyQuery}
                onChange={(e) => {
                  setCompanyQuery(e.target.value);
                  setActiveInput("company");
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  setActiveInput("company");
                  setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                className="portal-dialog-typography search-input-hero flex-grow py-5 px-4 text-[#4b5563] focus:outline-none text-lg bg-transparent"
              />
            </div>
          </div>

          {/* Autocomplete suggestions for company search */}
          {showSuggestions && activeInput === "company" && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-2xl shadow-2xl mt-2 z-[200] max-h-[28rem] overflow-y-auto overscroll-contain"
            >
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.type}-${suggestion.url}`}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion.url)}
                  className={`w-full px-5 py-4 text-left flex items-center gap-4 hover:bg-gray-50 transition-colors ${
                    idx === selectedIndex ? "bg-gray-100" : ""
                  } ${idx > 0 ? "border-t border-gray-100" : ""}`}
                >
                  {renderSuggestionIcon(suggestion, "desktop")}
                  <div className="flex-grow min-w-0">
                    <div className="font-medium text-gray-800 truncate text-lg">{suggestion.text}</div>
                    {suggestion.subtitle && (
                      <div className={`text-sm text-gray-500 ${suggestion.type === "company" ? "break-words" : "truncate"}`}>
                        {suggestion.subtitle}
                      </div>
                    )}
                  </div>
                  <span
                    className="text-xs px-3 py-1.5 rounded-full flex-shrink-0 font-medium bg-green-100 text-green-700"
                  >
                    {t("search.company")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search by service input card - REMOVED per user request */}

        {/* Keywords input card */}
        <div className="flex-1 basis-0 min-w-0 relative group/keywords">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 h-[68px] overflow-hidden
            hover:shadow-xl hover:scale-[1.02]
            transition-all duration-300 cursor-text">
            <div className="flex items-center h-full">
              <div className="pl-5 text-[#820251]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                ref={keywordsInputRef}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("search.keywordsPlaceholder")}
                value={keywordsQuery}
                onChange={(e) => {
                  setKeywordsQuery(e.target.value);
                  setActiveInput("service");
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  setActiveInput("service");
                  setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                className="portal-dialog-typography search-input-hero flex-grow py-5 px-4 text-[#4b5563] focus:outline-none text-lg bg-transparent"
              />
              {renderPhoneSearchHint("desktop")}
            </div>
          </div>

          {/* Autocomplete suggestions for service search */}
          {showSuggestions && activeInput === "service" && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-2xl shadow-2xl mt-2 z-[200] max-h-[28rem] overflow-y-auto overscroll-contain"
            >
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.type}-${suggestion.url}`}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion.url)}
                  className={`w-full px-5 py-4 text-left flex items-center gap-4 hover:bg-gray-50 transition-colors ${
                    idx === selectedIndex ? "bg-gray-100" : ""
                  } ${idx > 0 ? "border-t border-gray-100" : ""}`}
                >
                  {renderSuggestionIcon(suggestion, "desktop")}
                  <div className="flex-grow min-w-0">
                    <div className="font-medium text-gray-800 truncate text-lg">{suggestion.text}</div>
                    {suggestion.subtitle && (
                      <div className={`text-sm text-gray-500 ${suggestion.type === "company" ? "break-words" : "truncate"}`}>
                        {suggestion.subtitle}
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-xs px-3 py-1.5 rounded-full flex-shrink-0 font-medium ${
                      suggestion.type === "company"
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {suggestion.type === "company" ? t("search.company") : t("search.category")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Location input card */}
        <div className="flex-1 basis-0 min-w-0 relative group/location">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 h-[68px] overflow-hidden
            hover:shadow-xl hover:scale-[1.02]
            transition-all duration-300 cursor-text">
            <div className="flex items-center h-full">
              <div className="pl-5 text-[#820251]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("filter.locationLabel")}
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="portal-dialog-typography search-input-hero flex-grow py-5 px-4 text-[#4b5563] focus:outline-none text-lg bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* Search button */}
        <button
          type="button"
          onClick={handleSearch}
          className="flex-shrink-0 w-16 bg-gradient-to-r from-[#820251] to-[#a80368] text-white rounded-2xl shadow-lg
            hover:shadow-[0_0_25px_rgba(255,255,255,0.6)] hover:scale-110
            active:scale-95 transition-all duration-300 flex items-center justify-center group/btn"
          title={t("search.find")}
        >
          <svg className="w-7 h-7 transition-all duration-300 group-hover/btn:scale-110 group-hover/btn:text-yellow-400 group-hover/btn:drop-shadow-[0_0_12px_rgba(255,255,255,0.9)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>

      {/* Inline Rubricator - third window, same width as search row (without button) */}
      <div className="">
        <Rubricator inline floating={false} />
      </div>

      {/* AI Assistant info block - clickable */}
      <div className="mt-3 w-full relative group/consult">
        {/* Animated running border */}
        <div className="absolute inset-0 rounded-2xl p-[2px] overflow-hidden">
          <div
            className="absolute inset-[-100%] animate-[spin_3s_linear_infinite]"
            style={{
              background: 'conic-gradient(from 0deg, transparent 0%, #facc15 10%, #fef08a 20%, #fff 25%, transparent 30%, transparent 70%, #facc15 75%, #fef08a 85%, #fff 90%, transparent 95%)',
            }}
          />
          <div className="absolute inset-[2px] bg-gradient-to-r from-[#820251] via-[#a80368] to-[#820251] rounded-[14px]" />
        </div>

        {/* Outer glow on hover */}
        <div className="absolute inset-0 rounded-2xl bg-yellow-400/0 group-hover/consult:bg-yellow-400/10 blur-xl transition-all duration-500" />

        <button
          type="button"
          onClick={() => {
            router.push("/assistant");
          }}
          className="relative w-full bg-gradient-to-r from-[#820251] via-[#a80368] to-[#820251] bg-[length:200%_100%] animate-gradient rounded-2xl p-5 md:p-6 text-white
            shadow-[0_10px_40px_rgba(130,2,81,0.4)] group-hover/consult:shadow-[0_20px_60px_rgba(130,2,81,0.5)]
            transition-all duration-300 group-hover/consult:scale-[1.02] active:scale-[0.98] overflow-hidden"
        >
          {/* Background particles */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-400/10 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-pink-400/10 rounded-full blur-2xl animate-pulse" style={{animationDelay: '1s'}} />
          </div>

          <div className="relative flex items-center gap-5">
            {/* Glowing lightbulb */}
            <div className="relative flex-shrink-0">
              {/* Glow layers */}
              <div className="absolute inset-[-12px] bg-yellow-400/20 rounded-full blur-xl animate-[pulse_2s_ease-in-out_infinite]" />
              <div className="absolute inset-[-6px] bg-yellow-300/25 rounded-full blur-lg animate-[pulse_1.5s_ease-in-out_infinite]" />

              <div className="relative w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-yellow-200 via-yellow-400 to-yellow-500 rounded-xl flex items-center justify-center
                shadow-[0_0_20px_rgba(250,204,21,0.5),0_0_40px_rgba(250,204,21,0.2)]
                group-hover/consult:shadow-[0_0_30px_rgba(250,204,21,0.7),0_0_60px_rgba(250,204,21,0.3)]
                group-hover/consult:scale-110 transition-all duration-300 animate-[pulse_2s_ease-in-out_infinite]">
                <svg className="w-7 h-7 md:w-8 md:h-8 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            </div>

            <div className="flex-grow min-w-0 text-left">
              <h3 className="font-bold text-lg md:text-xl mb-1 flex items-center gap-2 group-hover/consult:text-yellow-300 transition-colors">
                {t("ai.title")}
                <span className="text-xs bg-gradient-to-r from-yellow-300 to-yellow-500 text-[#820251] px-2.5 py-1 rounded-full font-bold uppercase
                  shadow-[0_0_10px_rgba(250,204,21,0.4)] animate-pulse">{t("ai.newBadge") || "New"}</span>
              </h3>
              <p className="text-pink-100 text-sm md:text-base leading-relaxed group-hover/consult:text-white transition-colors">
                {t("ai.shortDesc")}
              </p>
            </div>

            <div className="flex-shrink-0">
              <svg className="w-6 h-6 md:w-8 md:h-8 text-yellow-400 group-hover/consult:translate-x-2 group-hover/consult:text-yellow-300 transition-all duration-300
                drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
          </div>

        </button>
      </div>
    </form>
  );
}
