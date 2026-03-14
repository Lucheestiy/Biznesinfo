"use client";

import { memo, useEffect, useState, useCallback, useMemo, useRef, type UIEvent } from "react";
import { YMaps, Map as YandexMap, Placemark, Circle } from "@pbe/react-yandex-maps";
import { useLanguage } from "@/contexts/LanguageContext";

interface Company {
  id: string;
  name: string;
  address: string;
  city: string;
  phones: string[];
  logo_url: string;
  distance: number;
  _geo?: { lat: number; lng: number } | null;
}

interface CompanyMapProps {
  userLocation: { lat: number; lng: number };
  searchCenter: { lat: number; lng: number };
  searchCenterLabel?: string | null;
  searchQuery?: string;
  radius: number;
  onRadiusChange?: (_radius: number) => void;
  onLoadingChange?: (_loading: boolean) => void;
}

const RADIUS_OPTIONS = [5000, 10000, 20000, 30000, 50000];
const MIN_CUSTOM_RADIUS_KM = 1;
const MAX_CUSTOM_RADIUS_KM = 100;
const MAP_FETCH_LIMIT = 2000;
const MAP_SEARCH_TIMEOUT_MS = 15000;
const INITIAL_VISIBLE_COMPANIES = 10;
const COMPANY_LIST_LOAD_STEP = 20;
const LOGO_PROXY_VERSION = "4";
const DUPLICATE_POINT_SPREAD_METERS = 24;
const USER_MARKER_ICON_SIZE: [number, number] = [38, 52];
const USER_MARKER_ICON_OFFSET: [number, number] = [-19, -52];
const USER_MARKER_ICON = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="38" height="52" viewBox="0 0 38 52" fill="none">
    <defs>
      <filter id="pin-shadow" x="0" y="0" width="38" height="52" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.25"/>
      </filter>
    </defs>
    <g filter="url(#pin-shadow)">
      <path d="M19 2C10.2 2 3 9.2 3 18c0 12.1 13 27.5 16 31.8C22 45.5 35 30.1 35 18 35 9.2 27.8 2 19 2z" fill="#FF1744"/>
      <circle cx="19" cy="18" r="7" fill="#ffffff"/>
      <circle cx="19" cy="18" r="3.3" fill="#FF1744"/>
    </g>
  </svg>
`)}`;

function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractLogoPath(rawLogoUrl: string): string {
  const logoUrl = (rawLogoUrl || "").trim();
  if (!logoUrl) return "";
  if (logoUrl.startsWith("/images/")) return logoUrl.split("?")[0] || "";
  try {
    const parsed = new URL(logoUrl);
    if (!parsed.pathname.startsWith("/images/")) return "";
    return parsed.pathname || "";
  } catch {
    return "";
  }
}

function buildLogoProxyUrl(companyId: string, rawLogoUrl: string): string {
  const logoUrl = (rawLogoUrl || "").trim();
  if (!logoUrl) return "";
  if (logoUrl.startsWith("/api/biznesinfo/logo")) return logoUrl;

  const logoPath = extractLogoPath(logoUrl);
  if (logoPath) {
    return `/api/biznesinfo/logo?id=${encodeURIComponent(companyId)}&path=${encodeURIComponent(logoPath)}&v=${LOGO_PROXY_VERSION}`;
  }

  if (logoUrl.startsWith("/") && !logoUrl.startsWith("/images/")) {
    return logoUrl;
  }

  return `/api/biznesinfo/logo?u=${encodeURIComponent(logoUrl)}&v=${LOGO_PROXY_VERSION}`;
}

function formatDistanceKm(distanceMeters: number, params: { unit: string; decimalComma: boolean }): string {
  if (!Number.isFinite(distanceMeters)) return "";
  const num = (distanceMeters / 1000).toFixed(1).replace(".", params.decimalComma ? "," : ".");
  return `${num} ${params.unit}`;
}

type RouteMode = "drive" | "walk";

function buildYandexRouteUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: RouteMode,
): string {
  const rtt = mode === "walk" ? "pd" : "auto";
  const fromPoint = `${from.lat},${from.lng}`;
  const toPoint = `${to.lat},${to.lng}`;
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(`${fromPoint}~${toPoint}`)}&rtt=${rtt}&z=14`;
}

function sortableDistanceValue(distance: number): number {
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function formatRadiusInputValue(radiusMeters: number): string {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return "";
  const km = radiusMeters / 1000;
  if (Number.isInteger(km)) return String(km);
  return String(km).replace(".", ",");
}

function parseRadiusKmInput(raw: string): number | null {
  const normalized = (raw || "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function arePointsEqual(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  const epsilon = 0.00001;
  return Math.abs(a.lat - b.lat) <= epsilon && Math.abs(a.lng - b.lng) <= epsilon;
}

function spreadDuplicateCompanyPoints(companies: Company[]): Array<{ company: Company; geometry: [number, number] }> {
  const groups = new Map<string, Company[]>();

  for (const company of companies) {
    const lat = company._geo?.lat;
    const lng = company._geo?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${lat!.toFixed(6)}:${lng!.toFixed(6)}`;
    const list = groups.get(key);
    if (list) {
      list.push(company);
    } else {
      groups.set(key, [company]);
    }
  }

  const markers: Array<{ company: Company; geometry: [number, number] }> = [];

  for (const group of groups.values()) {
    const sortedGroup = group.slice().sort((a, b) => a.id.localeCompare(b.id));
    const first = sortedGroup[0];
    const baseLat = first._geo!.lat;
    const baseLng = first._geo!.lng;

    if (sortedGroup.length === 1) {
      markers.push({ company: first, geometry: [baseLat, baseLng] });
      continue;
    }

    const metersPerLatDegree = 111_320;
    const metersPerLngDegree = Math.max(1, metersPerLatDegree * Math.cos((baseLat * Math.PI) / 180));

    sortedGroup.forEach((company, idx) => {
      const angle = (2 * Math.PI * idx) / sortedGroup.length;
      const latOffset = (Math.sin(angle) * DUPLICATE_POINT_SPREAD_METERS) / metersPerLatDegree;
      const lngOffset = (Math.cos(angle) * DUPLICATE_POINT_SPREAD_METERS) / metersPerLngDegree;
      markers.push({
        company,
        geometry: [baseLat + latOffset, baseLng + lngOffset],
      });
    });
  }

  return markers;
}

function CompanyListLogo(props: { companyId: string; logoUrl: string; alt: string }) {
  const { companyId, logoUrl, alt } = props;
  const [failed, setFailed] = useState(false);
  const src = buildLogoProxyUrl(companyId, logoUrl);

  if (!src || failed) {
    return <span className="text-lg">🏢</span>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-8 h-8 object-contain"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function CompanyMap({ 
  userLocation, 
  searchCenter,
  searchCenterLabel,
  searchQuery = "", 
  radius, 
  onRadiusChange,
  onLoadingChange,
}: CompanyMapProps) {
  const { language } = useLanguage();
  const mapText = useMemo(() => (language === "en"
    ? {
        decimalComma: false,
        kmUnit: "km",
        searchError: "Could not perform the search. Please refresh and try again.",
        searchTimeout: "Search is taking too long. Please try refresh.",
        coordsLabel: "Coordinates",
        resolvingAddress: "Resolving address...",
        youAreHere: "You are here",
        fromYou: "from you",
        distancePending: "Distance is being determined",
        phone: "Phone",
        openCard: "Open company card",
        radiusLabel: "Search radius:",
        customPlaceholder: "Custom",
        customAria: "Custom radius in kilometers",
        searching: "Searching...",
        avgTimeLabel: "Average search time",
        elapsedLabel: "elapsed",
        secondsShort: "sec",
        found: "Found",
        companies: "companies",
        refresh: "Refresh",
        searchCenter: "Search center",
        drive: "Drive",
        walk: "Walk",
        scrollMore: "Scroll down to show {count} more companies",
        andMore: "...and {count} more companies",
        shown: "Shown",
        of: "of",
        loaded: "loaded",
      }
    : language === "be"
      ? {
          decimalComma: true,
          kmUnit: "км",
          searchError: "Не атрымалася выканаць пошук. Абнавіце і паспрабуйце яшчэ раз.",
          searchTimeout: "Пошук занадта доўгі. Паспрабуйце абнавіць.",
          coordsLabel: "Каардынаты",
          resolvingAddress: "Вызначаем адрас...",
          youAreHere: "Вы тут",
          fromYou: "ад вас",
          distancePending: "Адлегласць удакладняецца",
          phone: "Тэлефон",
          openCard: "Адкрыць картку",
          radiusLabel: "Радыус пошуку:",
          customPlaceholder: "Свой",
          customAria: "Свой радыус у кіламетрах",
          searching: "Пошук...",
          avgTimeLabel: "Сярэдні час пошуку",
          elapsedLabel: "прайшло",
          secondsShort: "с",
          found: "Знойдзена",
          companies: "кампаній",
          refresh: "Абнавіць",
          searchCenter: "Цэнтр пошуку",
          drive: "Ехаць",
          walk: "Ісці",
          scrollMore: "Пракруціце ніжэй, каб паказаць яшчэ {count} кампаній",
          andMore: "...і яшчэ {count} кампаній",
          shown: "Паказана",
          of: "з",
          loaded: "загружана",
        }
      : language === "zh"
        ? {
            decimalComma: false,
            kmUnit: "公里",
            searchError: "搜索失败，请刷新后重试。",
            searchTimeout: "搜索耗时过长，请尝试刷新。",
            coordsLabel: "坐标",
            resolvingAddress: "正在解析地址...",
            youAreHere: "您在这里",
            fromYou: "距您",
            distancePending: "距离计算中",
            phone: "电话",
            openCard: "打开公司卡片",
            radiusLabel: "搜索半径：",
            customPlaceholder: "自定义",
            customAria: "自定义半径（公里）",
            searching: "搜索中...",
            avgTimeLabel: "平均搜索时间",
            elapsedLabel: "已耗时",
            secondsShort: "秒",
            found: "找到",
            companies: "家公司",
            refresh: "刷新",
            searchCenter: "搜索中心",
            drive: "驾车",
            walk: "步行",
            scrollMore: "向下滚动以显示另外 {count} 家公司",
            andMore: "...还有 {count} 家公司",
            shown: "已显示",
            of: "/",
            loaded: "已加载",
          }
        : {
            decimalComma: true,
            kmUnit: "км",
            searchError: "Не удалось выполнить поиск. Попробуйте обновить.",
            searchTimeout: "Поиск выполняется слишком долго. Попробуйте обновить.",
            coordsLabel: "Координаты",
            resolvingAddress: "Определяем адрес...",
            youAreHere: "Вы здесь",
            fromYou: "от вас",
            distancePending: "Расстояние уточняется",
            phone: "Телефон",
            openCard: "Открыть карточку",
            radiusLabel: "Радиус поиска:",
            customPlaceholder: "Свой",
            customAria: "Свой радиус в километрах",
            searching: "Поиск...",
            avgTimeLabel: "Среднее время поиска",
            elapsedLabel: "прошло",
            secondsShort: "с",
            found: "Найдено",
            companies: "компаний",
            refresh: "Обновить",
            searchCenter: "Центр поиска",
            drive: "Ехать",
            walk: "Идти",
            scrollMore: "Прокрутите ниже, чтобы показать ещё {count} компаний",
            andMore: "...и ещё {count} компаний",
            shown: "Показано",
            of: "из",
            loaded: "загружено",
          }), [language]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(INITIAL_VISIBLE_COMPANIES);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [loadingUserAddress, setLoadingUserAddress] = useState(false);
  const [customRadiusKm, setCustomRadiusKm] = useState(() => formatRadiusInputValue(radius));
  const [averageSearchMs, setAverageSearchMs] = useState(3000);
  const [elapsedSearchMs, setElapsedSearchMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const searchStartedAtRef = useRef<number | null>(null);

  const fetchNearbyCompanies = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MAP_SEARCH_TIMEOUT_MS);
    searchStartedAtRef.current = Date.now();
    setElapsedSearchMs(0);
    setLoading(true);
    onLoadingChange?.(true);
    setSearchError(null);

    try {
      const url = `/api/biznesinfo/nearby?lat=${encodeURIComponent(String(searchCenter.lat))}&lng=${encodeURIComponent(String(searchCenter.lng))}&radius=${radius}&q=${encodeURIComponent(searchQuery)}&limit=${MAP_FETCH_LIMIT}`;
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) {
        throw new Error(`nearby_status:${res.status}`);
      }
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) return;

      const nextCompanies = (data.companies || [])
        .slice()
        .sort((a: Company, b: Company) => {
          const distanceDiff = sortableDistanceValue(a.distance) - sortableDistanceValue(b.distance);
          if (distanceDiff !== 0) return distanceDiff;
          return (a.name || "").localeCompare(b.name || "", "ru");
        });
      setCompanies(nextCompanies);
      setTotalCompanies(typeof data.total === "number" ? data.total : nextCompanies.length);
      setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
      setSearchError(null);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        if (requestSeq === requestSeqRef.current && timedOut) {
          setCompanies([]);
          setTotalCompanies(0);
          setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
          setSearchError(mapText.searchTimeout);
        }
        return;
      }
      console.error("Failed to fetch nearby companies:", error);
      if (requestSeq === requestSeqRef.current) {
        setCompanies([]);
        setTotalCompanies(0);
        setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
        setSearchError(mapText.searchError);
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestSeq === requestSeqRef.current) {
        const startedAt = searchStartedAtRef.current;
        if (typeof startedAt === "number") {
          const elapsed = Math.max(120, Date.now() - startedAt);
          setAverageSearchMs((prev) => {
            const baseline = Number.isFinite(prev) && prev > 0 ? prev : elapsed;
            return Math.round(baseline * 0.7 + elapsed * 0.3);
          });
        }
        searchStartedAtRef.current = null;
        setElapsedSearchMs(0);
        setLoading(false);
        onLoadingChange?.(false);
      }
    }
  }, [searchCenter, radius, searchQuery, mapText.searchError, mapText.searchTimeout, onLoadingChange]);

  useEffect(() => {
    fetchNearbyCompanies();
  }, [fetchNearbyCompanies]);

  useEffect(() => {
    if (!loading) return;
    const tick = () => {
      const startedAt = searchStartedAtRef.current;
      if (typeof startedAt !== "number") return;
      setElapsedSearchMs(Math.max(0, Date.now() - startedAt));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      searchStartedAtRef.current = null;
      onLoadingChange?.(false);
    };
  }, [onLoadingChange]);

  useEffect(() => {
    setCustomRadiusKm(formatRadiusInputValue(radius));
  }, [radius]);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const resolveUserAddress = async () => {
      setLoadingUserAddress(true);
      try {
        const reverseGeocodeUrl = `/api/biznesinfo/reverse-geocode?lat=${encodeURIComponent(String(userLocation.lat))}&lng=${encodeURIComponent(String(userLocation.lng))}`;
        const response = await fetch(reverseGeocodeUrl, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`reverse_geocode_status:${response.status}`);
        }

        const data = await response.json();
        const address = typeof data?.address === "string" ? data.address.trim() : "";

        if (isActive) {
          setUserAddress(address || null);
        }
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        if (isActive) {
          setUserAddress(null);
        }
      } finally {
        if (isActive) {
          setLoadingUserAddress(false);
        }
      }
    };

    void resolveUserAddress();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [userLocation.lat, userLocation.lng]);

  const placemarkCompanies = useMemo(() => spreadDuplicateCompanyPoints(companies), [companies]);
  const isPresetRadius = useMemo(() => RADIUS_OPTIONS.some((opt) => opt === radius), [radius]);
  const effectiveTotalCompanies = Math.max(totalCompanies, companies.length);
  const shownCompanyCount = Math.min(visibleCompanyCount, companies.length);
  const visibleCompanies = companies.slice(0, shownCompanyCount);
  const hiddenTotalCount = Math.max(effectiveTotalCompanies - shownCompanyCount, 0);
  const hiddenLoadedCount = Math.max(companies.length - shownCompanyCount, 0);
  const hasMoreLoadedCompanies = hiddenLoadedCount > 0;
  const nextLoadBatchCount = Math.min(COMPANY_LIST_LOAD_STEP, hiddenLoadedCount);
  const hasServerUnloadedRemainder = effectiveTotalCompanies > companies.length;
  const userCoordinatesText = useMemo(
    () => `${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}`,
    [userLocation.lat, userLocation.lng],
  );
  const searchCenterCoordinatesText = useMemo(
    () => `${searchCenter.lat.toFixed(6)}, ${searchCenter.lng.toFixed(6)}`,
    [searchCenter.lat, searchCenter.lng],
  );
  const mapCenterKey = useMemo(
    () => `${searchCenter.lat.toFixed(6)}:${searchCenter.lng.toFixed(6)}`,
    [searchCenter.lat, searchCenter.lng],
  );
  const showSearchCenterPlacemark = useMemo(
    () => !arePointsEqual(userLocation, searchCenter),
    [userLocation, searchCenter],
  );
  const searchCenterText = (searchCenterLabel || "").trim() || `${mapText.coordsLabel}: ${searchCenterCoordinatesText}`;
  const userAddressText = userAddress || (loadingUserAddress ? mapText.resolvingAddress : `${mapText.coordsLabel}: ${userCoordinatesText}`);
  const userBalloonHtml = `
    <div style="padding:8px;max-width:260px;">
      <div style="font-size:14px;font-weight:700;color:#d60032;margin-bottom:6px;">${mapText.youAreHere}</div>
      <div style="font-size:12px;line-height:1.45;color:#333;">${escapeHtml(userAddressText)}</div>
    </div>
  `;
  const userHintText = userAddress ? `${mapText.youAreHere}: ${userAddress}` : mapText.youAreHere;

  const getPlacemarkPreset = (distance: number) => {
    if (distance < 1000) return "islands#redDotIcon";
    if (distance < 5000) return "islands#orangeDotIcon";
    return "islands#blueDotIcon";
  };

  const createBalloonData = (company: Company) => {
    const phone = escapeHtml(company.phones?.[0] || "");
    const name = escapeHtml(company.name || "");
    const address = escapeHtml(company.address || "");
    const distanceText = Number.isFinite(company.distance)
      ? `${formatDistanceKm(company.distance, { unit: mapText.kmUnit, decimalComma: mapText.decimalComma })} ${mapText.fromYou}`
      : mapText.distancePending;

    const bodyLines = [
      address,
      phone ? `${mapText.phone}: ${phone}` : "",
      distanceText,
    ].filter(Boolean);

    const body = bodyLines.join("<br/>");
    const footer = `<a href="/company/${encodeURIComponent(company.id)}" style="color:#820251;text-decoration:underline;">${mapText.openCard}</a>`;

    return {
      name,
      body,
      footer,
      fullHtml: `
        <div style="padding:8px;max-width:260px;">
          <div style="font-size:14px;font-weight:700;color:#820251;margin-bottom:6px;">${name}</div>
          <div style="font-size:12px;line-height:1.45;color:#333;">${body}</div>
          <div style="margin-top:8px;font-size:12px;">${footer}</div>
        </div>
      `,
    };
  };

  const getPlacemarkOptions = (company: Company) => {
    const logoSrc = buildLogoProxyUrl(company.id, company.logo_url);
    if (logoSrc) {
      return {
        iconLayout: "default#image",
        iconImageHref: logoSrc,
        iconImageSize: [30, 30],
        iconImageOffset: [-15, -15],
        hideIconOnBalloonOpen: false,
      };
    }

    return {
      preset: getPlacemarkPreset(company.distance),
      hideIconOnBalloonOpen: false,
    };
  };

  const applyCustomRadius = useCallback(() => {
    if (!onRadiusChange) return;
    const parsedKm = parseRadiusKmInput(customRadiusKm);
    if (!parsedKm) {
      setCustomRadiusKm(formatRadiusInputValue(radius));
      return;
    }

    const clampedKm = Math.min(MAX_CUSTOM_RADIUS_KM, Math.max(MIN_CUSTOM_RADIUS_KM, parsedKm));
    const meters = Math.round(clampedKm * 1000);
    setCustomRadiusKm(formatRadiusInputValue(meters));
    onRadiusChange(meters);
  }, [customRadiusKm, onRadiusChange, radius]);

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMoreLoadedCompanies) return;
      const el = event.currentTarget;
      const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (distanceToBottom > 48) return;
      setVisibleCompanyCount((prev) => Math.min(companies.length, prev + COMPANY_LIST_LOAD_STEP));
    },
    [companies.length, hasMoreLoadedCompanies],
  );
  const averageSearchSeconds = Math.max(1, Math.round(averageSearchMs / 1000));
  const elapsedSearchSeconds = Math.max(1, Math.ceil(elapsedSearchMs / 1000));

  return (
    <div className="w-full">
      {/* Radius selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-gray-600 text-sm py-2">{mapText.radiusLabel}</span>
        {RADIUS_OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => onRadiusChange?.(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              radius === opt
                ? "bg-[#820251] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {`${Math.round(opt / 1000)} ${mapText.kmUnit}`}
          </button>
        ))}
        <div
          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
            isPresetRadius ? "border-gray-300 bg-white" : "border-[#820251]/40 bg-[#820251]/5"
          }`}
        >
          <input
            type="text"
            inputMode="decimal"
            value={customRadiusKm}
            onChange={(e) => setCustomRadiusKm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomRadius();
              }
            }}
            placeholder={mapText.customPlaceholder}
            className="w-14 border-0 bg-transparent text-sm text-gray-800 focus:outline-none"
            aria-label={mapText.customAria}
          />
          <span className="text-xs text-gray-500">{mapText.kmUnit}</span>
          <button
            type="button"
            onClick={applyCustomRadius}
            className="rounded bg-[#820251] px-2 py-0.5 text-xs font-medium text-white hover:bg-[#700246]"
          >
            OK
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[18px] leading-6 font-bold text-[#820251]">
            {loading ? mapText.searching : `${mapText.found}: ${totalCompanies} ${mapText.companies}`}
          </span>
          {loading && (
            <span className="text-xs text-[#820251]/80">
              ⏱ {mapText.avgTimeLabel}: ~{averageSearchSeconds} {mapText.secondsShort}
              {" · "}
              {mapText.elapsedLabel}: {elapsedSearchSeconds} {mapText.secondsShort}
            </span>
          )}
        </div>
        <button
          onClick={fetchNearbyCompanies}
          className="text-sm text-[#820251] hover:underline"
          disabled={loading}
        >
          🔄 {mapText.refresh}
        </button>
      </div>
      {searchError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {searchError}
        </div>
      )}

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-[#d60032] shadow">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 38 52" aria-hidden="true">
            <path d="M19 2C10.2 2 3 9.2 3 18c0 12.1 13 27.5 16 31.8C22 45.5 35 30.1 35 18 35 9.2 27.8 2 19 2z" fill="#FF1744" />
            <circle cx="19" cy="18" r="7" fill="#ffffff" />
            <circle cx="19" cy="18" r="3.3" fill="#FF1744" />
          </svg>
          <span>{mapText.youAreHere}</span>
        </div>
        <YMaps query={{ apikey: process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || "" }}>
          <YandexMap
            key={mapCenterKey}
            defaultState={{
              center: [searchCenter.lat, searchCenter.lng],
              zoom: 11,
            }}
            modules={[
              "geoObject.addon.hint",
              "geoObject.addon.balloon",
            ]}
            width="100%"
            height="450px"
          >
            {/* User location circle */}
            <Circle
              geometry={[[searchCenter.lat, searchCenter.lng], radius]}
              options={{
                fillColor: "#82025120",
                strokeColor: "#820251",
                strokeWidth: 2,
                strokeOpacity: 0.8,
              }}
            />

            {/* User location placemark */}
            <Placemark
              geometry={[userLocation.lat, userLocation.lng]}
              modules={["geoObject.addon.hint", "geoObject.addon.balloon"]}
              properties={{
                hintContent: userHintText,
                balloonContent: userBalloonHtml,
                balloonContentHeader: mapText.youAreHere,
                balloonContentBody: escapeHtml(userAddressText),
              }}
              options={{
                iconLayout: "default#image",
                iconImageHref: USER_MARKER_ICON,
                iconImageSize: USER_MARKER_ICON_SIZE,
                iconImageOffset: USER_MARKER_ICON_OFFSET,
                zIndex: 5000,
                hideIconOnBalloonOpen: false,
              }}
            />
            {showSearchCenterPlacemark && (
              <Placemark
                geometry={[searchCenter.lat, searchCenter.lng]}
                modules={["geoObject.addon.hint", "geoObject.addon.balloon"]}
                properties={{
                  hintContent: `${mapText.searchCenter}: ${searchCenterText}`,
                  balloonContentHeader: mapText.searchCenter,
                  balloonContentBody: escapeHtml(searchCenterText),
                }}
                options={{
                  preset: "islands#violetDotIcon",
                  zIndex: 4900,
                  hideIconOnBalloonOpen: false,
                }}
              />
            )}

            {/* Company placemarks: one marker per company */}
            {placemarkCompanies.map(({ company, geometry }) => {
              const balloon = createBalloonData(company);
              return (
                <Placemark
                  key={company.id}
                  geometry={geometry}
                  modules={["geoObject.addon.hint", "geoObject.addon.balloon"]}
                  properties={{
                    hintContent: balloon.name,
                    balloonContent: balloon.fullHtml,
                    balloonContentHeader: balloon.name,
                    balloonContentBody: balloon.body,
                    balloonContentFooter: balloon.footer,
                  }}
                  options={getPlacemarkOptions(company)}
                />
              );
            })}
          </YandexMap>
        </YMaps>
      </div>

      {/* Company list below map */}
      <div className="mt-4 space-y-2 max-h-64 overflow-y-auto" onScroll={handleListScroll}>
        {visibleCompanies.map((company) => (
          <div
            key={company.id}
            className="p-3 rounded-lg border border-gray-100 hover:border-[#820251]/30 hover:bg-gray-50 transition-colors"
          >
            <a href={`/company/${company.id}`} className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CompanyListLogo companyId={company.id} logoUrl={company.logo_url} alt={company.name} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 truncate">{company.name}</div>
                <div className="text-sm text-gray-500 truncate">{company.address}</div>
              </div>
              <div className="text-sm text-[#820251] font-medium whitespace-nowrap">
                {Number.isFinite(company.distance) ? formatDistanceKm(company.distance, { unit: mapText.kmUnit, decimalComma: mapText.decimalComma }) : "—"}
              </div>
            </a>

            {Number.isFinite(company._geo?.lat) && Number.isFinite(company._geo?.lng) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-13">
                <a
                  href={buildYandexRouteUrl(
                    userLocation,
                    { lat: company._geo!.lat, lng: company._geo!.lng },
                    "drive",
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-[#820251] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#700246]"
                >
                  🚗 {mapText.drive}
                </a>
                <a
                  href={buildYandexRouteUrl(
                    userLocation,
                    { lat: company._geo!.lat, lng: company._geo!.lng },
                    "walk",
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-[#820251]/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#820251] hover:bg-[#820251]/5"
                >
                  🚶 {mapText.walk}
                </a>
              </div>
            )}
          </div>
        ))}
        {hiddenTotalCount > 0 && (
          <div className="text-center py-2">
            <div className="text-sm text-gray-500">
              {hasMoreLoadedCompanies
                ? mapText.scrollMore.replace("{count}", String(nextLoadBatchCount))
                : mapText.andMore.replace("{count}", String(hiddenTotalCount))}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              {mapText.shown} {shownCompanyCount} {mapText.of} {effectiveTotalCompanies}
              {hasServerUnloadedRemainder ? ` (${mapText.loaded} ${companies.length})` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(CompanyMap);
