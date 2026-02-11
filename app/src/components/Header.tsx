"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useRegion } from "@/contexts/RegionContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import { regions } from "@/data/regions";
import type { BiznesinfoCompanySummary } from "@/lib/biznesinfo/types";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";

const NAV_STATE_KEY = "biznesinfo:navigation_state_v1";

type NavigationState = {
  prev: string;
  curr: string;
};

function parseUrlToPath(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "";
  }
}

function readNavigationState(): NavigationState {
  if (typeof window === "undefined") return { prev: "", curr: "" };
  try {
    const raw = window.sessionStorage.getItem(NAV_STATE_KEY);
    if (!raw) return { prev: "", curr: "" };
    const parsed = JSON.parse(raw) as Partial<NavigationState> | null;
    return {
      prev: typeof parsed?.prev === "string" ? parsed.prev : "",
      curr: typeof parsed?.curr === "string" ? parsed.curr : "",
    };
  } catch {
    return { prev: "", curr: "" };
  }
}

function writeNavigationState(next: NavigationState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function upsertNavigationState(nextUrl: string) {
  if (typeof window === "undefined") return;
  const url = (nextUrl || "").trim();
  if (!url) return;
  const state = readNavigationState();
  if (!state.curr) {
    writeNavigationState({ prev: state.prev, curr: url });
    return;
  }
  if (state.curr === url) return;
  writeNavigationState({ prev: state.curr, curr: url });
}

const languages: { code: Language; name: string; flag: string }[] = [
  { code: "ru", name: "Русский", flag: "RU" },
  { code: "en", name: "English", flag: "EN" },
  { code: "be", name: "Беларуская", flag: "BY" },
  { code: "zh", name: "中文", flag: "CN" },
];

export default function Header() {
  const { language, setLanguage, t } = useLanguage();
  const { selectedRegion, setSelectedRegion, regionName } = useRegion();
  const { favorites } = useFavorites();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const headerRef = useRef<HTMLElement | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [contactMenuOpen, setContactMenuOpen] = useState(false);
  const [favoriteCompanies, setFavoriteCompanies] = useState<BiznesinfoCompanySummary[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const favoritesLoadedKeyRef = useRef<string>("");
  const favoritesRequestIdRef = useRef<number>(0);

  const currentLang = languages.find((l) => l.code === language) || languages[0];
  const favoritesKey = useMemo(() => favorites.join(","), [favorites]);
  const favoritesToShowInMenu = favoriteCompanies.slice(0, 7);
  const hiddenFavoritesCount = Math.max(0, favorites.length - favoritesToShowInMenu.length);
  const isCompanySection = useMemo(() => (pathname || "").startsWith("/company/"), [pathname]);
  const searchParamsString = searchParams?.toString() || "";

  const handleMobileLogoClick = () => {
    setMobileMenuOpen(false);
    setLangMenuOpen(false);
    setRegionMenuOpen(false);
    setExpandedItem(null);

    if (pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleMobileBackClick = useCallback(() => {
    setMobileMenuOpen(false);
    setLangMenuOpen(false);
    setRegionMenuOpen(false);
    setExpandedItem(null);
    setContactMenuOpen(false);

    const fallbackUrl = "/#catalog";
    if (typeof window === "undefined") {
      router.push(fallbackUrl);
      return;
    }

    const state = readNavigationState();
    const hasInternalPrev = Boolean(state.prev && state.prev.startsWith("/") && state.prev !== state.curr);
    if (!hasInternalPrev) {
      router.push(fallbackUrl);
      return;
    }

    const before = window.location.href;
    router.back();
    window.setTimeout(() => {
      if (window.location.href === before) {
        router.push(fallbackUrl);
      }
    }, 200);
  }, [router]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof window === "undefined") return;

    const update = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--site-header-height", `${h}px`);
    };

    update();
    window.addEventListener("resize", update);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }

    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (!(window as any).__biznesinfoNavInited) {
      (window as any).__biznesinfoNavInited = true;
      const ref = (document.referrer || "").trim();
      const sameOriginReferrer = (() => {
        if (!ref) return false;
        try {
          return new URL(ref).origin === window.location.origin;
        } catch {
          return false;
        }
      })();

      const prev = sameOriginReferrer ? parseUrlToPath(ref) : "";
      writeNavigationState({ prev, curr: current });
      return;
    }

    upsertNavigationState(current);
  }, [pathname, searchParamsString]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      upsertNavigationState(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent || "";
    const isiPhone = /iPhone/i.test(ua);
    const isiPad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
    const isiPod = /iPod/i.test(ua);
    setIsIOS(isiPhone || isiPad || isiPod);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    if (!favoritesKey) {
      setFavoriteCompanies([]);
      setFavoritesLoading(false);
      favoritesLoadedKeyRef.current = "";
      return;
    }

    if (favoritesLoadedKeyRef.current === favoritesKey) return;

    const requestId = ++favoritesRequestIdRef.current;
    setFavoritesLoading(true);
    fetch(`/api/biznesinfo/companies?ids=${encodeURIComponent(favoritesKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: { companies?: BiznesinfoCompanySummary[] } | null) => {
        if (favoritesRequestIdRef.current !== requestId) return;
        setFavoriteCompanies(resp?.companies || []);
        setFavoritesLoading(false);
        favoritesLoadedKeyRef.current = favoritesKey;
      })
      .catch(() => {
        if (favoritesRequestIdRef.current !== requestId) return;
        setFavoriteCompanies([]);
        setFavoritesLoading(false);
        favoritesLoadedKeyRef.current = "";
      });
  }, [mobileMenuOpen, favoritesKey]);

  return (
    <header ref={headerRef} className="bg-[#a0006d] text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-3 sm:px-4">
        {/* Mobile Header - Compact single row */}
        <div className="md:hidden flex items-center justify-between py-2 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isCompanySection && (
              <button
                type="button"
                onClick={handleMobileBackClick}
                aria-label="Назад"
                title="Назад"
                className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 border border-white/20 text-white shadow-sm transition-colors hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a0006d]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            )}

            {/* Logo Left */}
            <Link
              href="/"
              onClick={handleMobileLogoClick}
              className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a0006d] active:bg-white/10 rounded-lg transition-colors min-w-0"
            >
              <div className="relative w-10 h-10 flex-shrink-0 animate-[float_4s_ease-in-out_infinite]">
                <svg
                  viewBox="0 0 80 80"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full transition-transform duration-300 group-active:scale-110 group-active:rotate-6"
                >
                  <defs>
                    <radialGradient id="globeRadialMobile" cx="30%" cy="30%" r="70%">
                      <stop offset="0%" stopColor="#FEF3C7" />
                      <stop offset="40%" stopColor="#FCD34D" />
                      <stop offset="100%" stopColor="#D97706" />
                    </radialGradient>
                  </defs>
                  <circle cx="40" cy="40" r="22" fill="url(#globeRadialMobile)" />
                  <ellipse cx="40" cy="40" rx="22" ry="8" stroke="white" strokeWidth="0.8" fill="none" opacity="0.5" />
                  <ellipse cx="40" cy="40" rx="14" ry="22" stroke="white" strokeWidth="0.8" fill="none" opacity="0.5" />
                  <path d="M30 34 Q36 30 44 34 Q48 38 46 42 Q42 44 36 42 Q30 40 30 36Z" fill="#9D174D" opacity="0.7" />
                </svg>
              </div>
              <span className="text-lg font-bold truncate">
                <span className="text-yellow-400 transition-colors duration-200 group-active:text-yellow-300">Biznesinfo</span>
                <span className="text-white transition-colors duration-200 group-active:text-yellow-100">.by</span>
              </span>
            </Link>
          </div>

          {/* Right side - Region, Lang, Menu */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Region Button - Compact */}
            <button
              onClick={() => setRegionMenuOpen(!regionMenuOpen)}
              aria-expanded={regionMenuOpen}
              aria-haspopup="menu"
              aria-label={selectedRegion ? regionName : t("search.allRegions")}
              title={selectedRegion ? regionName : t("search.allRegions")}
              className={
                isIOS
                  ? "flex items-center gap-1.5 px-2 h-8 rounded-lg bg-white/10 border border-white/20 text-white text-xs shadow-sm transition-colors hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a0006d]"
                  : "flex items-center justify-center gap-0.5 w-8 h-8 rounded-lg bg-white/10 border border-white/20 text-white shadow-sm transition-colors hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a0006d]"
              }
            >
              <svg className="w-3.5 h-3.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {isIOS && (
                <span className="max-w-[60px] truncate">
                  {selectedRegion ? regionName.split(" ")[0] : t("search.allRegions").split(" ")[0]}
                </span>
              )}
              <svg className="w-3.5 h-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Language Button - Compact */}
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              aria-expanded={langMenuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-1 px-2 h-8 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-bold shadow-sm transition-colors hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a0006d]"
            >
              <svg className="w-4 h-4 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 15h16.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3c2.6 2.4 4.1 5.6 4.1 9s-1.5 6.6-4.1 9c-2.6-2.4-4.1-5.6-4.1-9S9.4 5.4 12 3z" />
              </svg>
              <span className="text-yellow-300">{currentLang.flag}</span>
              <svg className="w-3.5 h-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 text-white"
            >
              {mobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Region Dropdown */}
        {regionMenuOpen && (
          <div className="md:hidden">
            <div className="fixed inset-0 z-10" onClick={() => setRegionMenuOpen(false)} />
            <div className="absolute left-4 right-4 top-14 z-20 bg-white rounded-xl shadow-2xl py-2 max-h-[60vh] overflow-y-auto">
              <button
                onClick={() => {
                  setSelectedRegion(null);
                  setRegionMenuOpen(false);
                }}
                className={`w-full px-4 py-2.5 text-left text-sm ${
                  !selectedRegion ? "text-[#a0006d] font-bold bg-gray-50" : "text-gray-700"
                }`}
              >
                {t("search.allRegions")}
              </button>
              {regions.map((region) => (
                <button
                  key={region.slug}
                  onClick={() => {
                    setSelectedRegion(region.slug);
                    setRegionMenuOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm ${
                    selectedRegion === region.slug ? "text-[#a0006d] font-bold bg-gray-50" : "text-gray-700"
                  } ${region.isCity ? "font-medium" : "pl-6 text-gray-500 text-xs"}`}
                >
                  {t(`region.${region.slug}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mobile Language Dropdown */}
        {langMenuOpen && (
          <div className="md:hidden">
            <div className="fixed inset-0 z-10" onClick={() => setLangMenuOpen(false)} />
            <div className="absolute right-4 top-14 z-20 bg-white rounded-xl shadow-2xl py-2 w-40">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code);
                    setLangMenuOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 ${
                    language === lang.code ? "text-[#a0006d] font-bold bg-gray-50" : "text-gray-700"
                  }`}
                >
                  <span>{lang.flag}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Desktop Header */}
        <div className="hidden md:flex flex-col gap-2 py-4">
          <div className="relative flex items-center justify-between gap-4 flex-wrap">
            {/* Logo - Left-aligned on Desktop */}
            <div className="flex justify-start -ml-4 lg:-ml-8">
              <Link href="/" className="flex items-center gap-4 group">
                {/* Professional Globe Logo - Interactive */}
                <div className="relative w-28 h-28 flex-shrink-0 group/logo">
                  {/* Animated glow aura */}
                  <div className="absolute inset-0 rounded-full bg-yellow-400/20 blur-xl animate-pulse" />
                  <div className="absolute inset-[-4px] rounded-full bg-gradient-to-r from-yellow-400/10 via-pink-400/10 to-yellow-400/10 blur-lg animate-spin" style={{animationDuration: '10s'}} />
                  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full relative z-10 group-hover/logo:scale-110 transition-transform duration-300 animate-[float_4s_ease-in-out_infinite]">
                    <defs>
                      {/* Globe gradient */}
                      <radialGradient id="globeRadial" cx="30%" cy="30%" r="70%">
                        <stop offset="0%" stopColor="#FEF3C7" />
                        <stop offset="40%" stopColor="#FCD34D" />
                        <stop offset="100%" stopColor="#D97706" />
                      </radialGradient>

                      {/* Gold accent */}
                      <linearGradient id="goldAccent" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#FDE68A" />
                        <stop offset="100%" stopColor="#F59E0B" />
                      </linearGradient>

                      {/* People gradient */}
                      <linearGradient id="personWhite" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#FFFFFF" />
                        <stop offset="100%" stopColor="#E5E7EB" />
                      </linearGradient>

                      {/* Shadow filter */}
                      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#5a0138" floodOpacity="0.3"/>
                      </filter>
                    </defs>

                    {/* Main globe */}
                    <g filter="url(#shadow)">
                      <circle cx="40" cy="40" r="22" fill="url(#globeRadial)" />

                      {/* Globe grid lines */}
                      <ellipse cx="40" cy="40" rx="22" ry="8" stroke="white" strokeWidth="0.8" fill="none" opacity="0.5" />
                      <ellipse cx="40" cy="40" rx="14" ry="22" stroke="white" strokeWidth="0.8" fill="none" opacity="0.5" />
                      <ellipse cx="40" cy="40" rx="7" ry="22" stroke="white" strokeWidth="0.8" fill="none" opacity="0.5" />

                      {/* Continents */}
                      <path d="M30 34 Q36 30 44 34 Q48 38 46 42 Q42 44 36 42 Q30 40 30 36Z" fill="#9D174D" opacity="0.7" />
                      <path d="M34 48 Q40 46 46 50 Q47 53 44 54 Q38 54 34 51Z" fill="#9D174D" opacity="0.6" />

                      {/* Globe shine */}
                      <ellipse cx="33" cy="33" rx="8" ry="6" fill="white" opacity="0.25" />
                    </g>

                    {/* Orbit ring 1 */}
                    <ellipse cx="40" cy="40" rx="32" ry="11" stroke="url(#goldAccent)" strokeWidth="1.5" fill="none" opacity="0.4" transform="rotate(-20 40 40)" />

                    {/* Orbit ring 2 */}
                    <ellipse cx="40" cy="40" rx="30" ry="10" stroke="url(#goldAccent)" strokeWidth="1" fill="none" opacity="0.3" transform="rotate(60 40 40)" />

                    {/* Orbiting balls - Ring 1 */}
                    <g transform="rotate(-20 40 40)">
                      <circle cx="40" cy="40" r="0" fill="#FCD34D">
                        <animateMotion dur="3s" repeatCount="indefinite" path="M32,0 A32,11 0 1,1 -32,0 A32,11 0 1,1 32,0" />
                        <animate attributeName="r" values="3;4;3" dur="1s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="40" cy="40" r="0" fill="#FBBF24">
                        <animateMotion dur="3s" repeatCount="indefinite" begin="1.5s" path="M32,0 A32,11 0 1,1 -32,0 A32,11 0 1,1 32,0" />
                        <animate attributeName="r" values="2.5;3.5;2.5" dur="1.2s" repeatCount="indefinite" />
                      </circle>
                    </g>

                    {/* Orbiting balls - Ring 2 */}
                    <g transform="rotate(60 40 40)">
                      <circle cx="40" cy="40" r="0" fill="#F59E0B">
                        <animateMotion dur="4s" repeatCount="indefinite" path="M30,0 A30,10 0 1,1 -30,0 A30,10 0 1,1 30,0" />
                        <animate attributeName="r" values="2;3;2" dur="0.8s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="40" cy="40" r="0" fill="#FDE68A">
                        <animateMotion dur="4s" repeatCount="indefinite" begin="2s" path="M30,0 A30,10 0 1,1 -30,0 A30,10 0 1,1 30,0" />
                        <animate attributeName="r" values="2;2.5;2" dur="1s" repeatCount="indefinite" />
                      </circle>
                    </g>

                    {/* Small sparkle balls */}
                    <circle cx="12" cy="25" r="1.5" fill="#FDE68A">
                      <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="68" cy="55" r="1.5" fill="#FBBF24">
                      <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="65" cy="20" r="1" fill="#FCD34D">
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                </div>

                {/* Logo Text - Interactive */}
                <div className="relative group/text">
                  <div className="text-4xl font-bold tracking-tight transition-all duration-300 group-hover/text:scale-105">
                    <span className="text-yellow-400 drop-shadow-sm group-hover/text:text-yellow-300 group-hover/text:drop-shadow-[0_0_10px_rgba(250,204,21,0.6)] transition-all duration-300">Biznesinfo</span>
                    <span className="text-white group-hover/text:text-yellow-100 transition-colors duration-300">.by</span>
                  </div>
                </div>
              </Link>
            </div>

            {/* Login Button - Right side on Desktop */}
            <div className="flex items-center gap-3 -mr-4 lg:-mr-12 xl:-mr-20">
              <Link
                href="/cabinet"
                className="flex items-center gap-2 bg-gradient-to-r from-yellow-400 to-yellow-500 text-[#a0006d] px-6 py-2.5 rounded-full font-bold hover:from-white hover:to-white hover:text-[#a0006d] transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-110 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>{t("cabinet.title")}</span>
              </Link>

              {/* Contact Menu Button */}
              <div className="relative -mr-8 lg:-mr-16 xl:-mr-24">
                <button
                  onClick={() => setContactMenuOpen(!contactMenuOpen)}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-white text-[#a0006d] hover:bg-yellow-400 hover:scale-110 transition-all duration-200 shadow-lg hover:shadow-xl cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                {contactMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setContactMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-3 w-72 bg-white rounded-2xl shadow-2xl py-4 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-5 pb-3 border-b border-gray-100">
                        <h3 className="font-bold text-[#a0006d] text-lg">{t("nav.mobile.contacts")}</h3>
                      </div>
                      <div className="px-5 py-4 space-y-3">
                        <a
                          href="mailto:surdoe@yandex.ru"
                          className="flex items-center gap-3 text-gray-700 hover:text-[#a0006d] transition-colors"
                        >
                          <svg className="w-5 h-5 text-[#a0006d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span>surdoe@yandex.ru</span>
                        </a>
                      </div>
                      <div className="px-5 pt-3 border-t border-gray-100 space-y-2">
                        <Link
                          href="/agreement"
                          onClick={() => setContactMenuOpen(false)}
                          className="block text-sm text-gray-600 hover:text-[#a0006d] transition-colors"
                        >
                          {t("footer.agreement")}
                        </Link>
                        <Link
                          href="/offer"
                          onClick={() => setContactMenuOpen(false)}
                          className="block text-sm text-gray-600 hover:text-[#a0006d] transition-colors"
                        >
                          {t("footer.offer")}
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Navigation - Centered above region/language */}
          <div className="flex items-center gap-4 text-base justify-center -mt-4">
            <Link href="/#news" className="px-3 py-2 text-yellow-400 hover:text-white hover:scale-105 hover:underline underline-offset-4 transition-all duration-200 font-semibold cursor-pointer">
              {t("nav.news")}
            </Link>
            <span className="text-yellow-400 text-lg">|</span>
            <Link href="/#services" className="px-3 py-2 text-yellow-400 hover:text-white hover:scale-105 hover:underline underline-offset-4 transition-all duration-200 font-semibold cursor-pointer">
              {t("nav.about")}
            </Link>
            <span className="text-yellow-400 text-lg">|</span>
            <Link href="/favorites" className="px-3 py-2 text-yellow-400 hover:text-white hover:scale-105 hover:underline underline-offset-4 transition-all duration-200 font-semibold cursor-pointer">
              {t("nav.favorites")}
            </Link>
            <span className="text-yellow-400 text-lg">|</span>
            <Link
              href="/vacancies"
              className="px-3 py-2 text-yellow-400 hover:text-white hover:scale-105 hover:underline underline-offset-4 transition-all duration-200 font-semibold cursor-pointer"
            >
              Вакансии
            </Link>
            <span className="text-yellow-400 text-lg">|</span>
            <Link
              href="/map"
              className="px-3 py-2 text-yellow-400 hover:text-white hover:scale-105 hover:underline underline-offset-4 transition-all duration-200 font-semibold cursor-pointer"
            >
              🗺️ Карта
            </Link>
          </div>

          {/* Desktop Region/Language selectors */}
          <div className="flex justify-center gap-4">
            <div className="relative">
              <button
                onClick={() => setRegionMenuOpen(!regionMenuOpen)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-yellow-400 hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="max-w-[140px] text-sm truncate font-medium text-white">{regionName}</span>
                <svg className={`w-4 h-4 text-white/70 transition-transform ${regionMenuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {regionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setRegionMenuOpen(false)} />
                  <div className="absolute left-1/2 top-full z-20 mt-3 w-72 -translate-x-1/2 bg-white rounded-2xl shadow-2xl py-2 max-h-[60vh] overflow-y-auto ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => {
                        setSelectedRegion(null);
                        setRegionMenuOpen(false);
                      }}
                      className={`w-full px-5 py-3 text-left text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                        !selectedRegion ? "text-[#a0006d] font-bold bg-gray-50/50" : "text-gray-700"
                      }`}
                    >
                      {t("search.allRegions")}
                    </button>
                    <div className="py-1">
                      {regions.map((region) => (
                        <button
                          key={region.slug}
                          onClick={() => {
                            setSelectedRegion(region.slug);
                            setRegionMenuOpen(false);
                          }}
                          className={`w-full px-5 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${
                            selectedRegion === region.slug ? "text-[#a0006d] font-bold bg-gray-50/50" : "text-gray-700"
                          } ${region.isCity ? "pl-5 font-medium" : "pl-8 text-gray-500 text-xs uppercase tracking-wider mt-1"}`}
                        >
                          {t(`region.${region.slug}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-yellow-400 hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <span className="font-medium text-yellow-400">{currentLang.flag}</span>
                <span className="text-sm font-medium">{currentLang.name}</span>
                <svg className={`w-4 h-4 text-white/70 transition-transform ${langMenuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {langMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangMenuOpen(false)} />
                  <div className="absolute left-1/2 -translate-x-1/2 top-full z-20 mt-3 w-48 bg-white rounded-2xl shadow-2xl py-2 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setLangMenuOpen(false);
                        }}
                        className={`w-full px-5 py-3 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                          language === lang.code ? "text-[#a0006d] font-bold bg-gray-50/50" : "text-gray-700"
                        }`}
                      >
                        <span className="text-lg">{lang.flag}</span>
                        <span>{lang.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-white/30">
            <nav className="flex flex-col gap-2 text-sm">
              {/* Favorites (quick list) */}
              <div className="border-b border-white/10">
                <Link
                  href="/favorites"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-between py-3 px-2 hover:text-yellow-400 transition-colors text-left font-medium"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden>❤️</span>
                    <span>{t("nav.favorites")}</span>
                  </span>
                  <span className="text-xs text-white/80">{favorites.length}</span>
                </Link>

                {favorites.length === 0 ? (
                  <div className="pl-4 pr-2 pb-3 text-white/80 text-sm">
                    {t("favorites.empty")}
                  </div>
                ) : favoritesLoading ? (
                  <div className="pl-4 pr-2 pb-3 text-white/80 text-sm">{t("common.loading")}</div>
                ) : (
                  <div className="pl-4 pr-2 pb-3 flex flex-col gap-2">
                    {favoritesToShowInMenu.map((company) => (
                      <Link
                        key={company.id}
                        href={`/company/${encodeURIComponent(companySlugForUrl(company.id))}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-white/90 hover:text-yellow-400 transition-colors truncate"
                        title={company.name}
                      >
                        {company.name}
                      </Link>
                    ))}
                    {hiddenFavoritesCount > 0 && (
                      <Link
                        href="/favorites"
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-xs text-white/80 hover:text-yellow-400 transition-colors"
                      >
                        {t("common.more")} {hiddenFavoritesCount}
                      </Link>
                    )}
                  </div>
                )}
              </div>

              {/* Contact Information Accordion */}
              <div className="border-b border-white/10">
                <button
                  onClick={() => setExpandedItem(expandedItem === 'contacts' ? null : 'contacts')}
                  className="w-full flex items-center justify-between py-3 px-2 hover:text-yellow-400 transition-colors text-left font-medium"
                >
                  <span>{t("nav.mobile.contacts")}</span>
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${expandedItem === 'contacts' ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    expandedItem === 'contacts' ? 'max-h-48 opacity-100 mb-2' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="pl-4 flex flex-col gap-3 text-white/80 py-1">
                    <a href="mailto:surdoe@yandex.ru" className="flex items-center gap-2 hover:text-yellow-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      surdoe@yandex.ru
                    </a>
                    <Link
                      href="/agreement"
                      onClick={() => setMobileMenuOpen(false)}
                      className="hover:text-yellow-400 transition-colors text-sm"
                    >
                      {t("footer.agreement")}
                    </Link>
                    <Link
                      href="/offer"
                      onClick={() => setMobileMenuOpen(false)}
                      className="hover:text-yellow-400 transition-colors text-sm"
                    >
                      {t("footer.offer")}
                    </Link>
                  </div>
                </div>
              </div>

              {/* Submit Request Accordion */}
              <div className="border-b border-white/10">
                <button
                  onClick={() => setExpandedItem(expandedItem === 'request' ? null : 'request')}
                  className="w-full flex items-center justify-between py-3 px-2 hover:text-yellow-400 transition-colors text-left font-medium"
                >
                  <span>{t("nav.mobile.submitRequest")}</span>
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${expandedItem === 'request' ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    expandedItem === 'request' ? 'max-h-24 opacity-100 mb-2' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="pl-4 py-2">
                    <Link
                      href="/add-company"
                      className="inline-flex items-center gap-2 bg-yellow-500 text-[#a0006d] px-4 py-2 rounded-lg font-bold hover:bg-yellow-400 transition-colors text-sm shadow-md"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <span>{t("nav.addCompany")}</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
