"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import type { IbizCatalogCategory, IbizCatalogResponse } from "@/lib/ibiz/types";
import { formatCompanyCount } from "@/lib/utils/plural";

interface RubricatorProps {
  floating?: boolean;
  inline?: boolean;
}

export default function Rubricator({ floating = true, inline = false }: RubricatorProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState<IbizCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  // Prefetch catalog function
  const prefetchCatalog = () => {
    if (!catalog && !loading) {
      setLoading(true);
      fetch("/api/ibiz/catalog")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setCatalog(data);
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    }
  };

  // Fetch catalog when panel opens (fallback)
  useEffect(() => {
    if (isOpen && !catalog && !loading) {
      prefetchCatalog();
    }
  }, [isOpen, catalog, loading]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const toggleCategory = (slug: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const categories = catalog?.categories || [];

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  if (!floating && !inline) return null;

  // Inline mode - renders as a card in the search form
  if (inline) {
    return (
      <div className="mt-3">
        {/* Rubricator toggle button */}
        <button
          type="button"
          onClick={handleToggle}
          onMouseEnter={prefetchCatalog}
          onFocus={prefetchCatalog}
          className="w-full bg-white rounded-2xl shadow-lg border border-gray-100 h-[56px] md:h-[68px] overflow-hidden
            hover:shadow-xl hover:scale-[1.02]
            transition-all duration-300"
        >
          <div className="flex items-center h-full px-4 md:px-5">
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-gradient-to-r from-[#820251] to-[#a80368] flex items-center justify-center mr-3 flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </div>
            <span
              className="portal-dialog-typography flex-grow text-left text-lg text-[#4b5563]"
            >
              {t("rubricator.title") || "Рубрикатор"}
            </span>
            <div className="flex items-center gap-2">
              {catalog && (
                <span className="text-xs text-gray-400">
                  {catalog.stats.categories_total} {t("rubricator.categories")}
                </span>
              )}
              <svg
                className={`w-5 h-5 text-[#820251] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </button>

        {/* Expanded rubricator content */}
        {isOpen && (
          <div className="mt-2 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            {/* Header with close button */}
            <div className="bg-gradient-to-r from-[#820251] to-[#a80368] text-white px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                {t("rubricator.title") || "Рубрикатор"}
              </h3>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                </button>
            </div>

            {/* Categories grid - like on biznes.lucheestiy.com */}
            <div className="max-h-[60vh] sm:max-h-[500px] overflow-y-auto overscroll-contain overflow-x-hidden p-4">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-10 h-10 border-4 border-[#820251] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-base">{t("rubricator.notFound") || "Ничего не найдено"}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {categories.map((category) => (
                    <Link
                      key={category.slug}
                      href={`/catalog/${category.slug}`}
                      onClick={() => setIsOpen(false)}
                      className="bg-gray-50 p-4 rounded-xl hover:shadow-lg transition-all text-center group border border-gray-100 hover:border-[#820251] hover:scale-105"
                    >
                      <span className="text-3xl block mb-2 group-hover:scale-110 transition-transform">
                        {category.icon || "🏢"}
                      </span>
                      <span className="font-semibold text-gray-700 text-sm group-hover:text-[#820251] block leading-tight">
                        {category.name}
                      </span>
                      <span className="text-xs text-gray-400 mt-1 block">
                        {formatCompanyCount(category.company_count)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Floating mode
  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={handleToggle}
        onMouseEnter={prefetchCatalog}
        onFocus={prefetchCatalog}
        className={`fixed left-4 bottom-24 z-40 w-14 h-14 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center group ${
          isOpen
            ? "bg-white text-[#820251] shadow-xl ring-2 ring-[#820251]"
            : "bg-gradient-to-r from-[#820251] to-[#a80368] text-white hover:shadow-xl"
        }`}
        title={t("rubricator.title") || "Rubricator"}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close rubricator" : "Open rubricator"}
      >
        <svg
          className={`w-6 h-6 transition-transform duration-300 ${isOpen ? "rotate-180" : "group-hover:scale-110"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Panel container */}
      <div
        ref={panelRef}
        className={`fixed left-4 bottom-40 z-30 w-[calc(100%-2rem)] sm:w-80 transition-all duration-300 ease-out ${
          isOpen
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 200px)" }}>
          {/* Header */}
          <div className="bg-gradient-to-r from-[#820251] to-[#a80368] text-white px-4 py-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                {t("rubricator.title") || "Рубрикатор"}
              </h2>
              <div className="flex items-center gap-2 text-xs text-pink-200">
                {catalog && (
                  <span>{catalog.stats.categories_total} {t("rubricator.categories")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Categories list */}
          <div className="overflow-y-auto flex-grow overscroll-contain overflow-x-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-3 border-[#820251] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">{t("rubricator.notFound") || "Ничего не найдено"}</p>
              </div>
            ) : (
              <div className="py-1">
                {categories.map((category) => (
                  <CategoryItem
                    key={category.slug}
                    category={category}
                    isExpanded={expandedCategories.has(category.slug)}
                    onToggle={() => toggleCategory(category.slug)}
                    onNavigate={() => setIsOpen(false)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

interface CategoryItemProps {
  category: IbizCatalogCategory;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function CategoryItem({ category, isExpanded, onToggle, onNavigate, t }: CategoryItemProps) {
  const hasRubrics = category.rubrics.length > 0;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Category header */}
      <div className="flex items-center hover:bg-gray-50 active:bg-gray-100 transition-colors">
        {hasRubrics && (
          <button
            onClick={onToggle}
            className="pl-3 pr-1 py-3.5 text-gray-400 hover:text-[#820251] transition-colors flex-shrink-0 min-h-[48px] flex items-center"
            aria-label={isExpanded ? "Свернуть" : "Развернуть"}
          >
            <svg
              className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        <Link
          href={`/catalog/${category.slug}`}
          onClick={onNavigate}
          className={`flex-grow flex items-center gap-3 py-3.5 pr-4 min-h-[48px] ${hasRubrics ? "pl-1" : "pl-4"}`}
        >
          <span className="text-xl flex-shrink-0">{category.icon || "📁"}</span>
          <div className="flex-grow min-w-0">
            <div className="font-medium text-gray-800 text-base whitespace-normal break-words">{category.name}</div>
          </div>
          <span className="text-sm text-gray-400 flex-shrink-0 bg-gray-100 px-2 py-0.5 rounded-full">
            {formatCompanyCount(category.company_count)}
          </span>
        </Link>
      </div>

      {/* Rubrics (nested) */}
      {isExpanded && hasRubrics && (
        <div className="bg-gray-50 border-t border-gray-200">
          {category.rubrics.map((rubric) => (
            <Link
              key={rubric.slug}
              href={rubric.url}
              onClick={onNavigate}
              className="flex items-center gap-3 pl-12 pr-4 py-3 hover:bg-gray-100 active:bg-gray-200 transition-colors group min-h-[44px] border-b border-gray-100 last:border-b-0"
            >
              <div className="w-2 h-2 rounded-full bg-[#820251]/40 group-hover:bg-[#820251] transition-colors flex-shrink-0" />
              <span className="text-gray-700 text-base flex-grow whitespace-normal break-words group-hover:text-[#820251] transition-colors">
                {rubric.name}
              </span>
              <span className="text-sm text-gray-400 flex-shrink-0">
                {rubric.count}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
