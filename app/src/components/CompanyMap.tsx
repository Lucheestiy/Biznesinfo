"use client";

import { memo, useEffect, useState, useCallback, useMemo, useRef, type UIEvent } from "react";
import { YMaps, Map as YandexMap, Placemark, Circle } from "@pbe/react-yandex-maps";
import { useLanguage } from "@/contexts/LanguageContext";

interface Company {
  id: string;
  name: string;
  description?: string;
  address: string;
  city: string;
  phones: string[];
  logo_url: string;
  categories?: Array<{ name?: string | null }>;
  rubrics?: Array<{ name?: string | null }>;
  distance: number;
  _geo?: { lat: number; lng: number } | null;
}

interface SearchBounds {
  southLat: number;
  westLng: number;
  northLat: number;
  eastLng: number;
}

interface CompanyMapProps {
  userLocation: { lat: number; lng: number };
  searchCenter: { lat: number; lng: number };
  searchCenterLabel?: string | null;
  searchBounds?: SearchBounds | null;
  searchDistrictName?: string | null;
  searchQuery?: string;
  searchEnabled?: boolean;
  radius: number;
  onRadiusChange?: (_radius: number) => void;
  onLoadingChange?: (_loading: boolean) => void;
}

const RADIUS_OPTIONS = [5000, 10000, 20000, 30000, 50000];
const DEFAULT_RADIUS_METERS = 10000;
const MIN_CUSTOM_RADIUS_KM = 1;
const MAX_CUSTOM_RADIUS_KM = 100;
const MAP_FETCH_INITIAL_LIMIT = 200;
const MAP_FETCH_NEXT_LIMIT = 200;
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

function compareCompaniesByDistanceAndName(a: Company, b: Company): number {
  const distanceDiff = sortableDistanceValue(a.distance) - sortableDistanceValue(b.distance);
  if (distanceDiff !== 0) return distanceDiff;
  return (a.name || "").localeCompare(b.name || "", "ru");
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

function toClampedRadiusMeters(km: number): number {
  const clampedKm = Math.min(MAX_CUSTOM_RADIUS_KM, Math.max(MIN_CUSTOM_RADIUS_KM, km));
  return Math.round(clampedKm * 1000);
}

function buildNearbyBoundsQuery(rawBounds: SearchBounds | null | undefined): string {
  if (!rawBounds) return "";
  const southLat = Number(rawBounds.southLat);
  const westLng = Number(rawBounds.westLng);
  const northLat = Number(rawBounds.northLat);
  const eastLng = Number(rawBounds.eastLng);
  if (!Number.isFinite(southLat) || !Number.isFinite(westLng) || !Number.isFinite(northLat) || !Number.isFinite(eastLng)) {
    return "";
  }
  if (northLat < southLat || eastLng < westLng) return "";
  return `&bbox_south=${encodeURIComponent(String(southLat))}&bbox_west=${encodeURIComponent(String(westLng))}&bbox_north=${encodeURIComponent(String(northLat))}&bbox_east=${encodeURIComponent(String(eastLng))}`;
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

function normalizeInfoText(raw: string): string {
  return String(raw || "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateInfoText(raw: string, maxLen: number): string {
  const text = normalizeInfoText(raw);
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function dedupeNonEmptyTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeInfoText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractCompanyProfileTags(company: Company): string[] {
  const rubricTags = (company.rubrics || []).map((rubric) => String(rubric?.name || ""));
  const categoryTags = (company.categories || []).map((category) => String(category?.name || ""));
  return dedupeNonEmptyTexts([...rubricTags, ...categoryTags]);
}

function buildCompanyInfoLines(company: Company, fallback: string): { profile: string; details: string } {
  const tags = extractCompanyProfileTags(company);
  const description = truncateInfoText(company.description || "", 150);

  const profileSource = tags.slice(0, 2).join(" · ");
  const profile = truncateInfoText(profileSource || description || fallback, 80) || fallback;

  const detailCandidates = dedupeNonEmptyTexts([
    description,
    tags.slice(2, 4).join(" · "),
    tags[1] || "",
    tags[0] || "",
  ]);
  const details = truncateInfoText(
    detailCandidates.find((candidate) => candidate.toLowerCase() !== profile.toLowerCase()) || fallback,
    110,
  ) || fallback;

  return { profile, details };
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
  searchBounds = null,
  searchDistrictName = null,
  searchQuery = "", 
  searchEnabled = true,
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
        straightLine: "as-the-crow-flies",
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
        searchNotStarted: "Enter a query or tap Search to show nearby companies",
        refresh: "Refresh",
        searchCenter: "Search center",
        drive: "Drive",
        walk: "Walk",
        scrollMore: "Scroll down to show {count} more companies",
        scrollLoadMoreServer: "Scroll down to load {count} more companies",
        loadingMore: "Loading more companies...",
        andMore: "...and {count} more companies",
        shown: "Shown",
        of: "of",
        loaded: "loaded",
        profileLabel: "Profile",
        detailsLabel: "What they do",
        infoFallback: "information is being updated",
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
          straightLine: "па прамой",
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
          searchNotStarted: "Увядзіце запыт або націсніце «Знайсці», каб паказаць бліжэйшыя кампаніі",
          refresh: "Абнавіць",
          searchCenter: "Цэнтр пошуку",
          drive: "Ехаць",
          walk: "Ісці",
          scrollMore: "Пракруціце ніжэй, каб паказаць яшчэ {count} кампаній",
          scrollLoadMoreServer: "Пракруціце ніжэй, каб загрузіць яшчэ {count} кампаній",
          loadingMore: "Загружаем яшчэ кампаніі...",
          andMore: "...і яшчэ {count} кампаній",
          shown: "Паказана",
          of: "з",
          loaded: "загружана",
          profileLabel: "Профіль",
          detailsLabel: "Чым займаюцца",
          infoFallback: "інфармацыя ўдакладняецца",
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
            straightLine: "直线",
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
            searchNotStarted: "请输入查询，或直接点击搜索以显示附近公司",
            refresh: "刷新",
            searchCenter: "搜索中心",
            drive: "驾车",
            walk: "步行",
            scrollMore: "向下滚动以显示另外 {count} 家公司",
            scrollLoadMoreServer: "向下滚动以加载另外 {count} 家公司",
            loadingMore: "正在加载更多公司...",
            andMore: "...还有 {count} 家公司",
            shown: "已显示",
            of: "/",
            loaded: "已加载",
            profileLabel: "业务方向",
            detailsLabel: "公司服务",
            infoFallback: "信息补充中",
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
            straightLine: "по прямой",
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
            searchNotStarted: "Введите запрос или нажмите «Найти», чтобы показать компании рядом",
            refresh: "Обновить",
            searchCenter: "Центр поиска",
            drive: "Ехать",
            walk: "Идти",
            scrollMore: "Прокрутите ниже, чтобы показать ещё {count} компаний",
            scrollLoadMoreServer: "Прокрутите ниже, чтобы загрузить ещё {count} компаний",
            loadingMore: "Загружаем ещё компании...",
            andMore: "...и ещё {count} компаний",
            shown: "Показано",
            of: "из",
            loaded: "загружено",
            profileLabel: "Профиль",
            detailsLabel: "Чем занимается",
            infoFallback: "информация уточняется",
          }), [language]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(INITIAL_VISIBLE_COMPANIES);
  const [serverOffset, setServerOffset] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [loadingMoreFromServer, setLoadingMoreFromServer] = useState(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [loadingUserAddress, setLoadingUserAddress] = useState(false);
  const [customRadiusKm, setCustomRadiusKm] = useState(() => formatRadiusInputValue(radius));
  const [radiusControlsInteracted, setRadiusControlsInteracted] = useState(() => radius !== DEFAULT_RADIUS_METERS);
  const [averageSearchMs, setAverageSearchMs] = useState(3000);
  const [elapsedSearchMs, setElapsedSearchMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const searchStartedAtRef = useRef<number | null>(null);
  const mapRef = useRef<any>(null);

  const fetchNearbyCompanies = useCallback(async () => {
    if (!searchEnabled) return;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
      loadMoreAbortRef.current = null;
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
    setLoadingMoreFromServer(false);
    setServerOffset(0);
    setServerHasMore(false);

    try {
      const boundsQuery = buildNearbyBoundsQuery(searchBounds);
      const districtQuery = searchDistrictName
        ? `&district=${encodeURIComponent(searchDistrictName)}`
        : "";
      const userDistanceQuery = `&user_lat=${encodeURIComponent(String(userLocation.lat))}&user_lng=${encodeURIComponent(String(userLocation.lng))}`;
      const url = `/api/biznesinfo/nearby?lat=${encodeURIComponent(String(searchCenter.lat))}&lng=${encodeURIComponent(String(searchCenter.lng))}&radius=${radius}&q=${encodeURIComponent(searchQuery)}&offset=0&limit=${MAP_FETCH_INITIAL_LIMIT}${boundsQuery}${districtQuery}${userDistanceQuery}`;
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) {
        throw new Error(`nearby_status:${res.status}`);
      }
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) return;

      const nextCompanies = (data.companies || []).slice().sort(compareCompaniesByDistanceAndName);
      const offsetBase = Number.isFinite(data?.offset) ? Math.max(0, Number(data.offset)) : 0;
      const responseLimit = Number.isFinite(data?.limit) && Number(data.limit) > 0
        ? Number(data.limit)
        : MAP_FETCH_INITIAL_LIMIT;
      const nextOffset = offsetBase + responseLimit;
      const responseTotal = Number.isFinite(data?.total) ? Number(data.total) : nextCompanies.length;
      setCompanies(nextCompanies);
      setTotalCompanies(Math.max(responseTotal, nextCompanies.length));
      setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
      setServerOffset(nextOffset);
      setServerHasMore(nextOffset < responseTotal && nextCompanies.length > 0);
      setSearchError(null);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        if (requestSeq === requestSeqRef.current && timedOut) {
          setCompanies([]);
          setTotalCompanies(0);
          setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
          setServerOffset(0);
          setServerHasMore(false);
          setSearchError(mapText.searchTimeout);
        }
        return;
      }
      console.error("Failed to fetch nearby companies:", error);
      if (requestSeq === requestSeqRef.current) {
        setCompanies([]);
        setTotalCompanies(0);
        setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
        setServerOffset(0);
        setServerHasMore(false);
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
  }, [searchEnabled, searchCenter, searchBounds, searchDistrictName, radius, searchQuery, mapText.searchError, mapText.searchTimeout, onLoadingChange]);

  useEffect(() => {
    if (!searchEnabled) {
      abortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
      searchStartedAtRef.current = null;
      setCompanies([]);
      setTotalCompanies(0);
      setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
      setServerOffset(0);
      setServerHasMore(false);
      setLoadingMoreFromServer(false);
      setSearchError(null);
      setLoading(false);
      setElapsedSearchMs(0);
      onLoadingChange?.(false);
      return;
    }
    fetchNearbyCompanies();
  }, [searchEnabled, fetchNearbyCompanies, onLoadingChange]);

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
      loadMoreAbortRef.current?.abort();
      searchStartedAtRef.current = null;
      onLoadingChange?.(false);
    };
  }, [onLoadingChange]);

  const fetchMoreNearbyCompanies = useCallback(async () => {
    if (!searchEnabled) return;
    if (loading || loadingMoreFromServer) return;
    if (!serverHasMore) return;
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
    }

    const requestSeq = requestSeqRef.current;
    const offset = Math.max(0, serverOffset);
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMoreFromServer(true);

    try {
      const boundsQuery = buildNearbyBoundsQuery(searchBounds);
      const districtQuery = searchDistrictName
        ? `&district=${encodeURIComponent(searchDistrictName)}`
        : "";
      const userDistanceQuery = `&user_lat=${encodeURIComponent(String(userLocation.lat))}&user_lng=${encodeURIComponent(String(userLocation.lng))}`;
      const url = `/api/biznesinfo/nearby?lat=${encodeURIComponent(String(searchCenter.lat))}&lng=${encodeURIComponent(String(searchCenter.lng))}&radius=${radius}&q=${encodeURIComponent(searchQuery)}&offset=${offset}&limit=${MAP_FETCH_NEXT_LIMIT}${boundsQuery}${districtQuery}${userDistanceQuery}`;
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) {
        throw new Error(`nearby_status:${res.status}`);
      }
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) return;

      const incomingCompanies = (data.companies || []).slice().sort(compareCompaniesByDistanceAndName);
      setCompanies((prev) => {
        if (incomingCompanies.length === 0) return prev;
        const byId = new Map<string, Company>();
        for (const company of prev) byId.set(company.id, company);
        for (const company of incomingCompanies) byId.set(company.id, company);
        return Array.from(byId.values()).sort(compareCompaniesByDistanceAndName);
      });
      if (incomingCompanies.length > 0) {
        setVisibleCompanyCount((prev) => prev + Math.min(COMPANY_LIST_LOAD_STEP, incomingCompanies.length));
      }

      const offsetBase = Number.isFinite(data?.offset) ? Math.max(0, Number(data.offset)) : offset;
      const responseLimit = Number.isFinite(data?.limit) && Number(data.limit) > 0
        ? Number(data.limit)
        : MAP_FETCH_NEXT_LIMIT;
      const nextOffset = offsetBase + responseLimit;
      const responseTotal = Number.isFinite(data?.total) ? Number(data.total) : totalCompanies;
      setServerOffset(nextOffset);
      setServerHasMore(incomingCompanies.length > 0 && nextOffset < responseTotal);
      setTotalCompanies((prev) => {
        const fallbackTotal = Number.isFinite(responseTotal) ? responseTotal : prev;
        return Math.max(fallbackTotal, prev, incomingCompanies.length > 0 ? nextOffset : 0);
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      console.error("Failed to fetch more nearby companies:", error);
      if (requestSeq === requestSeqRef.current) {
        setSearchError(mapText.searchError);
      }
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
      }
      if (requestSeq === requestSeqRef.current) {
        setLoadingMoreFromServer(false);
      }
    }
  }, [
    searchEnabled,
    loading,
    loadingMoreFromServer,
    totalCompanies,
    serverOffset,
    serverHasMore,
    searchCenter.lat,
    searchCenter.lng,
    searchBounds,
    searchDistrictName,
    userLocation.lat,
    userLocation.lng,
    radius,
    searchQuery,
    mapText.searchError,
  ]);

  useEffect(() => {
    setCustomRadiusKm(formatRadiusInputValue(radius));
  }, [radius]);

  useEffect(() => {
    if (radiusControlsInteracted) return;
    if (radius !== DEFAULT_RADIUS_METERS) {
      setRadiusControlsInteracted(true);
    }
  }, [radius, radiusControlsInteracted]);

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
  const pendingCustomRadiusMeters = useMemo(() => {
    const parsedKm = parseRadiusKmInput(customRadiusKm);
    if (!parsedKm) return null;
    return toClampedRadiusMeters(parsedKm);
  }, [customRadiusKm]);
  const hasPendingCustomRadius = pendingCustomRadiusMeters !== null && pendingCustomRadiusMeters !== radius;
  const hasServerUnloadedRemainder = serverHasMore;
  const effectiveTotalCompanies = hasServerUnloadedRemainder
    ? Math.max(totalCompanies, companies.length)
    : companies.length;
  const shownCompanyCount = Math.min(visibleCompanyCount, companies.length);
  const visibleCompanies = companies.slice(0, shownCompanyCount);
  const hiddenTotalCount = Math.max(effectiveTotalCompanies - shownCompanyCount, 0);
  const hiddenLoadedCount = Math.max(companies.length - shownCompanyCount, 0);
  const hasMoreLoadedCompanies = hiddenLoadedCount > 0;
  const nextLoadBatchCount = Math.min(COMPANY_LIST_LOAD_STEP, hiddenLoadedCount);
  const nextServerLoadCount = Math.max(1, Math.min(MAP_FETCH_NEXT_LIMIT, Math.max(effectiveTotalCompanies - serverOffset, 0)));
  const displayTotalCompanies = hasServerUnloadedRemainder ? effectiveTotalCompanies : companies.length;
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
  const isDistrictMode = Boolean((searchDistrictName || "").trim());

  const getPlacemarkPreset = (distance: number) => {
    if (distance < 1000) return "islands#redDotIcon";
    if (distance < 5000) return "islands#orangeDotIcon";
    return "islands#blueDotIcon";
  };

  const createBalloonData = (company: Company) => {
    const phone = escapeHtml(company.phones?.[0] || "");
    const name = escapeHtml(company.name || "");
    const address = escapeHtml(company.address || "");
    const infoLines = buildCompanyInfoLines(company, mapText.infoFallback);
    const distanceText = !isDistrictMode && Number.isFinite(company.distance)
      ? `${formatDistanceKm(company.distance, { unit: mapText.kmUnit, decimalComma: mapText.decimalComma })} ${mapText.fromYou} (${mapText.straightLine})`
      : "";

    const bodyLines = [
      address,
      `${mapText.profileLabel}: ${escapeHtml(infoLines.profile)}`,
      `${mapText.detailsLabel}: ${escapeHtml(infoLines.details)}`,
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

    const meters = toClampedRadiusMeters(parsedKm);
    setCustomRadiusKm(formatRadiusInputValue(meters));
    setRadiusControlsInteracted(true);
    onRadiusChange(meters);
  }, [customRadiusKm, onRadiusChange, radius]);

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (distanceToBottom > 48) return;
      if (hasMoreLoadedCompanies) {
        setVisibleCompanyCount((prev) => Math.min(companies.length, prev + COMPANY_LIST_LOAD_STEP));
        return;
      }
      if (hasServerUnloadedRemainder && !loadingMoreFromServer && !loading) {
        void fetchMoreNearbyCompanies();
      }
    },
    [companies.length, hasMoreLoadedCompanies, hasServerUnloadedRemainder, loadingMoreFromServer, loading, fetchMoreNearbyCompanies],
  );
  const setMapInstance = useCallback((instance: any) => {
    mapRef.current = instance || null;
  }, []);
  const centerOnUserLocation = useCallback(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance) return;
    const currentZoom = Number.isFinite(mapInstance.getZoom?.()) ? Number(mapInstance.getZoom()) : 11;
    mapInstance.setCenter([userLocation.lat, userLocation.lng], currentZoom, { duration: 250 });
  }, [userLocation.lat, userLocation.lng]);
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
            disabled={isDistrictMode}
            onClick={() => {
              if (isDistrictMode) return;
              setRadiusControlsInteracted(true);
              onRadiusChange?.(opt);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isDistrictMode
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : radiusControlsInteracted && radius === opt
                  ? "bg-[#820251] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {`${Math.round(opt / 1000)} ${mapText.kmUnit}`}
          </button>
        ))}
        <div
          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
            isDistrictMode
              ? "border-gray-200 bg-gray-50"
              : radiusControlsInteracted && !isPresetRadius
                ? "border-[#820251]/40 bg-[#820251]/5"
                : "border-gray-300 bg-white"
          }`}
        >
          <input
            type="text"
            inputMode="decimal"
            value={customRadiusKm}
            disabled={isDistrictMode}
            onChange={(e) => setCustomRadiusKm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustomRadius();
              }
            }}
            placeholder={mapText.customPlaceholder}
            className={`w-14 border-0 bg-transparent text-sm focus:outline-none ${
              isDistrictMode ? "text-gray-400" : "text-gray-800"
            }`}
            aria-label={mapText.customAria}
          />
          <span className={`text-xs ${isDistrictMode ? "text-gray-400" : "text-gray-500"}`}>{mapText.kmUnit}</span>
          <button
            type="button"
            disabled={isDistrictMode || !hasPendingCustomRadius}
            onClick={applyCustomRadius}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              isDistrictMode || !hasPendingCustomRadius
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-[#820251] text-white hover:bg-[#700246]"
            }`}
          >
            OK
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[18px] leading-6 font-bold text-[#820251]">
            {loading
              ? mapText.searching
              : searchEnabled
                ? `${mapText.found}: ${displayTotalCompanies} ${mapText.companies}`
                : mapText.searchNotStarted}
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
          className={`text-sm ${searchEnabled && !loading ? "text-[#820251] hover:underline" : "text-gray-400 cursor-not-allowed"}`}
          disabled={loading || !searchEnabled}
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
        <button
          type="button"
          onClick={centerOnUserLocation}
          className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-[#d60032] shadow transition hover:bg-white"
          title={mapText.youAreHere}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 38 52" aria-hidden="true">
            <path d="M19 2C10.2 2 3 9.2 3 18c0 12.1 13 27.5 16 31.8C22 45.5 35 30.1 35 18 35 9.2 27.8 2 19 2z" fill="#FF1744" />
            <circle cx="19" cy="18" r="7" fill="#ffffff" />
            <circle cx="19" cy="18" r="3.3" fill="#FF1744" />
          </svg>
          <span>{mapText.youAreHere}</span>
        </button>
        <YMaps query={{ apikey: process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || "" }}>
          <YandexMap
            key={mapCenterKey}
            instanceRef={setMapInstance}
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
            {!isDistrictMode && (
              <Circle
                geometry={[[searchCenter.lat, searchCenter.lng], radius]}
                options={{
                  fillColor: "#82025120",
                  strokeColor: "#820251",
                  strokeWidth: 2,
                  strokeOpacity: 0.8,
                }}
              />
            )}

            {/* User location placemark */}
            <Placemark
              geometry={[userLocation.lat, userLocation.lng]}
              onClick={centerOnUserLocation}
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
        {visibleCompanies.map((company) => {
          const infoLines = buildCompanyInfoLines(company, mapText.infoFallback);
          return (
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
                  <div className="mt-1 space-y-0.5">
                    <div className="text-xs text-gray-600 leading-tight line-clamp-1">
                      <span className="font-medium text-gray-700">{mapText.profileLabel}:</span> {infoLines.profile}
                    </div>
                    <div className="text-xs text-gray-500 leading-tight line-clamp-1">
                      <span className="font-medium text-gray-700">{mapText.detailsLabel}:</span> {infoLines.details}
                    </div>
                  </div>
                </div>
                <div className="self-start text-right">
                  <div className="text-sm text-[#820251] font-medium whitespace-nowrap">
                    {Number.isFinite(company.distance) ? formatDistanceKm(company.distance, { unit: mapText.kmUnit, decimalComma: mapText.decimalComma }) : "—"}
                  </div>
                  {Number.isFinite(company.distance) && (
                    <div className="text-[11px] leading-tight text-gray-400">{mapText.straightLine}</div>
                  )}
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
          );
        })}
        {hiddenTotalCount > 0 && (
          <div className="text-center py-2">
            <div className="text-sm text-gray-500">
              {hasMoreLoadedCompanies
                ? mapText.scrollMore.replace("{count}", String(nextLoadBatchCount))
                : hasServerUnloadedRemainder
                  ? (loadingMoreFromServer
                    ? mapText.loadingMore
                    : mapText.scrollLoadMoreServer.replace("{count}", String(nextServerLoadCount)))
                : mapText.andMore.replace("{count}", String(hiddenTotalCount))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 text-center text-xs text-gray-400">
        {mapText.shown} {shownCompanyCount} {mapText.of} {effectiveTotalCompanies}
        {hasServerUnloadedRemainder ? ` (${mapText.loaded} ${companies.length})` : ""}
      </div>
    </div>
  );
}

export default memo(CompanyMap);
