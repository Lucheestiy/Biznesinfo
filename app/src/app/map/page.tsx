"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyMap from "@/components/CompanyMap";
import { useLanguage } from "@/contexts/LanguageContext";
import { isAddressLikeLocationQuery } from "@/lib/utils/location";

const SERVICE_LIKE_SINGLE_TOKEN_RE =
  /^(кафе|бар|аптек|молок|сыр|авто|строй|ремонт|суши|пицц|ресторан|такси|банк|магаз|достав|ветерин|парикмах)/u;
const ADDRESS_CITY_SKIP_RE =
  /(беларус|област|район|улиц|просп|бульвар|переул|шоссе|площад|набереж|дом|корп|кварт|офис|проезд)/u;
const MAP_STATE_STORAGE_KEY = "biznesinfo-map-state-v1";

type MapPersistedState = {
  searchInput?: string;
  searchQuery?: string;
  radius?: number;
  searchCenter?: { lat: number; lng: number } | null;
  searchCenterLabel?: string | null;
};

function looksLikeStreetNameFallback(raw: string): boolean {
  const normalized = (raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return false;
  if (/\d/u.test(normalized)) return false;
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length !== 1) return false;
  const token = parts[0];
  if (token.length < 5) return false;
  if (SERVICE_LIKE_SINGLE_TOKEN_RE.test(token)) return false;
  return true;
}

function isStreetGeocodeKind(raw: string): boolean {
  const kind = (raw || "").trim().toLowerCase();
  return kind === "street" || kind === "house";
}

function hasHouseNumber(raw: string): boolean {
  return /\d/u.test(raw || "");
}

function extractCityHintFromAddress(raw: string): string | null {
  const source = (raw || "").trim();
  if (!source) return null;
  const parts = source
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase().replace(/ё/gu, "е");
    if (!lower || ADDRESS_CITY_SKIP_RE.test(lower)) continue;
    if (/^\d/u.test(lower)) continue;
    if (lower.length < 3) continue;
    return part;
  }
  return null;
}

function withCityHint(query: string, cityHint: string | null): string {
  const base = (query || "").trim();
  if (!base) return "";
  const city = (cityHint || "").trim();
  if (!city) return base;
  if (base.includes(",")) return base;

  const normalizedBase = base.toLowerCase().replace(/ё/gu, "е");
  const normalizedCity = city.toLowerCase().replace(/ё/gu, "е");
  if (normalizedBase.includes(normalizedCity)) return base;
  return `${base}, ${city}`;
}

export default function MapPage() {
  const { t, language } = useLanguage();
  const mapText = useMemo(() => (language === "en"
    ? {
        hintAddressHouse: "Companies near the entered address (street + house number) are shown within the selected radius.",
        hintStreetRadius: "All companies within the selected radius from the specified street are shown.",
        hintStreetFallback: "Could not resolve the street. A regular query search was performed.",
        geoErrorDetect: "Could not determine your location. Minsk is used by default.",
        geoErrorUnsupported: "Geolocation is not supported by your browser.",
        breadcrumb: "Map Search",
        pageTitle: "🗺️ Company Search on Map",
        pageSubtitle: "Find companies within a selected radius from your location or a specified street.",
        locating: "Detecting location...",
        searchLabel: "What are you looking for?",
        searchPlaceholder: "For example: milk, building materials, car service...",
        searchingButton: "Searching...",
        searchButton: "Search",
        searchHelp:
          "Enter a service, a street, or a street with a house number (for example, “Prititskogo St, 17”). For a street, we show all companies in the radius; for street + house number, companies at that address.",
        quickFiltersLabel: "Quick filters:",
        quickFilters: [
          { value: "молоко", label: "milk" },
          { value: "стройматериалы", label: "building materials" },
          { value: "автосервис", label: "car service" },
          { value: "кафе", label: "cafe" },
          { value: "аптека", label: "pharmacy" },
        ],
      }
    : language === "be"
      ? {
          hintAddressHouse: "Паказаны кампаніі па ўведзеным адрасе (вуліца + дом) у выбраным радыусе.",
          hintStreetRadius: "Паказаны ўсе кампаніі ў выбраным радыусе ад указанай вуліцы.",
          hintStreetFallback: "Не атрымалася вызначыць вуліцу. Выкананы звычайны пошук па запыце.",
          geoErrorDetect: "Не атрымалася вызначыць месцазнаходжанне. Па змаўчанні выкарыстоўваецца Мінск.",
          geoErrorUnsupported: "Геалакацыя не падтрымліваецца браўзерам.",
          breadcrumb: "Пошук на карце",
          pageTitle: "🗺️ Пошук кампаній на карце",
          pageSubtitle: "Знайдзіце кампаніі ў зададзеным радыусе ад вашага месцазнаходжання або ўказанай вуліцы.",
          locating: "Вызначэнне месцазнаходжання...",
          searchLabel: "Што шукаем?",
          searchPlaceholder: "Напрыклад: малако, будаўнічыя матэрыялы, аўтасэрвіс...",
          searchingButton: "Шукаем...",
          searchButton: "Знайсці",
          searchHelp:
            "Увядзіце паслугу, вуліцу або вуліцу з домам (напрыклад, «вул. Прытыцкага, 17»). Для вуліцы паказваем усе кампаніі ў радыусе, для вуліцы+дома — кампаніі па адрасе.",
          quickFiltersLabel: "Хуткія фільтры:",
          quickFilters: [
            { value: "молоко", label: "малако" },
            { value: "стройматериалы", label: "будаўнічыя матэрыялы" },
            { value: "автосервис", label: "аўтасэрвіс" },
            { value: "кафе", label: "кафэ" },
            { value: "аптека", label: "аптэка" },
          ],
        }
      : language === "zh"
        ? {
            hintAddressHouse: "已显示所填地址（街道+门牌号）在所选半径内的公司。",
            hintStreetRadius: "已显示所填街道在所选半径内的全部公司。",
            hintStreetFallback: "无法识别街道，已按普通关键词执行搜索。",
            geoErrorDetect: "无法确定您的位置。默认使用明斯克。",
            geoErrorUnsupported: "您的浏览器不支持地理定位。",
            breadcrumb: "地图搜索",
            pageTitle: "🗺️ 地图公司搜索",
            pageSubtitle: "在您当前位置或指定街道周围的半径范围内查找公司。",
            locating: "正在定位...",
            searchLabel: "要找什么？",
            searchPlaceholder: "例如：牛奶、建材、汽车服务...",
            searchingButton: "搜索中...",
            searchButton: "搜索",
            searchHelp:
              "输入服务、街道，或街道+门牌号（例如“普里季茨基街17号”）。按街道显示半径内所有公司；按街道+门牌号显示该地址公司。",
            quickFiltersLabel: "快捷筛选：",
            quickFilters: [
              { value: "молоко", label: "牛奶" },
              { value: "стройматериалы", label: "建材" },
              { value: "автосервис", label: "汽车服务" },
              { value: "кафе", label: "咖啡馆" },
              { value: "аптека", label: "药店" },
            ],
          }
        : {
            hintAddressHouse: "Показаны компании по введенному адресу (улица + дом) в выбранном радиусе.",
            hintStreetRadius: "Показаны все компании в выбранном радиусе от указанной улицы.",
            hintStreetFallback: "Улицу определить не удалось. Выполнен обычный поиск по запросу.",
            geoErrorDetect: "Не удалось определить местоположение. Используется Минск по умолчанию.",
            geoErrorUnsupported: "Геолокация не поддерживается браузером.",
            breadcrumb: "Поиск на карте",
            pageTitle: "🗺️ Поиск компаний на карте",
            pageSubtitle: "Найдите компании в заданном радиусе от вашего местоположения или указанной улицы",
            locating: "Определение местоположения...",
            searchLabel: "Что ищем?",
            searchPlaceholder: "Например: молоко, строительные материалы, автосервис...",
            searchingButton: "Ищем...",
            searchButton: "Найти",
            searchHelp:
              "Введите услугу, улицу или улицу с домом (например, «ул. Притыцкого, 17»). Для улицы показываем все компании в радиусе, для улицы+дома — компании по адресу.",
            quickFiltersLabel: "Быстрые фильтры:",
            quickFilters: [
              { value: "молоко", label: "молоко" },
              { value: "стройматериалы", label: "стройматериалы" },
              { value: "автосервис", label: "автосервис" },
              { value: "кафе", label: "кафе" },
              { value: "аптека", label: "аптека" },
            ],
          }), [language]);
  const restoredStateRef = useRef(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [userCityHint, setUserCityHint] = useState<string | null>(null);
  const [searchCenter, setSearchCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [searchCenterLabel, setSearchCenterLabel] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [radius, setRadius] = useState(10000); // Default 10km
  const [locationError, setLocationError] = useState("");
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [searchingCompanies, setSearchingCompanies] = useState(false);
  const [searchHint, setSearchHint] = useState("");
  const searchButtonBusy = searchingAddress || searchingCompanies;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(MAP_STATE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as MapPersistedState;
      if (typeof parsed.searchInput === "string") setSearchInput(parsed.searchInput);
      if (typeof parsed.searchQuery === "string") setSearchQuery(parsed.searchQuery);
      if (typeof parsed.radius === "number" && Number.isFinite(parsed.radius) && parsed.radius > 0) {
        setRadius(parsed.radius);
      }
      if (
        parsed.searchCenter &&
        typeof parsed.searchCenter.lat === "number" &&
        Number.isFinite(parsed.searchCenter.lat) &&
        typeof parsed.searchCenter.lng === "number" &&
        Number.isFinite(parsed.searchCenter.lng)
      ) {
        setSearchCenter({ lat: parsed.searchCenter.lat, lng: parsed.searchCenter.lng });
        restoredStateRef.current = true;
      }
      if (typeof parsed.searchCenterLabel === "string") {
        setSearchCenterLabel(parsed.searchCenterLabel || null);
      } else if (parsed.searchCenterLabel === null) {
        setSearchCenterLabel(null);
      }
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: MapPersistedState = {
      searchInput,
      searchQuery,
      radius,
      searchCenter,
      searchCenterLabel,
    };
    try {
      window.sessionStorage.setItem(MAP_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [searchInput, searchQuery, radius, searchCenter, searchCenterLabel]);

  const applySearch = useCallback(async () => {
    const nextQuery = (searchInput || "").trim();
    setSearchHint("");

    if (!nextQuery) {
      if (userLocation) {
        setSearchCenter(userLocation);
      }
      setSearchCenterLabel(null);
      setSearchQuery("");
      return;
    }

    const shouldTryAddressSearch = isAddressLikeLocationQuery(nextQuery) || looksLikeStreetNameFallback(nextQuery);
    if (!shouldTryAddressSearch) {
      if (userLocation) {
        setSearchCenter(userLocation);
      }
      setSearchCenterLabel(null);
      setSearchQuery(nextQuery);
      return;
    }

    setSearchingAddress(true);
    try {
      const geocodeQueries = [withCityHint(nextQuery, userCityHint)];
      if (geocodeQueries[0] !== nextQuery) geocodeQueries.push(nextQuery);

      let resolved: { lat: number; lng: number; address: string } | null = null;
      for (const geocodeQuery of geocodeQueries) {
        const geocodeUrl = `/api/biznesinfo/geocode?q=${encodeURIComponent(geocodeQuery)}${
          userLocation
            ? `&lat=${encodeURIComponent(String(userLocation.lat))}&lng=${encodeURIComponent(String(userLocation.lng))}`
            : ""
        }`;
        const response = await fetch(geocodeUrl, { cache: "no-store" });
        if (!response.ok) continue;

        const data = await response.json();
        const lat = Number(data?.coords?.lat);
        const lng = Number(data?.coords?.lng);
        const kind = typeof data?.kind === "string" ? data.kind : "";
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (!isStreetGeocodeKind(kind)) continue;

        const address = typeof data?.address === "string" ? data.address.trim() : "";
        resolved = { lat, lng, address };
        break;
      }

      if (!resolved) {
        throw new Error("geocode_not_found");
      }

      const hasHouse = hasHouseNumber(nextQuery);
      setSearchCenter({ lat: resolved.lat, lng: resolved.lng });
      setSearchCenterLabel(resolved.address || nextQuery);
      setSearchQuery(hasHouse ? nextQuery : "");
      setSearchHint(
        hasHouse
          ? mapText.hintAddressHouse
          : mapText.hintStreetRadius,
      );
    } catch {
      if (userLocation) {
        setSearchCenter(userLocation);
      }
      setSearchCenterLabel(null);
      setSearchQuery(nextQuery);
      setSearchHint(mapText.hintStreetFallback);
    } finally {
      setSearchingAddress(false);
    }
  }, [searchInput, userLocation, userCityHint, mapText]);

  useEffect(() => {
    const geolocationOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    };

    // Try to get user location
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const detectedLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(detectedLocation);
          setSearchCenter((prev) => {
            if (prev) return prev;
            if (restoredStateRef.current) return prev;
            return detectedLocation;
          });
          setLocationError("");
          setLoadingLocation(false);
        },
        (error) => {
          console.error("Geolocation error:", error);
          setLocationError(mapText.geoErrorDetect);
          // Default to Minsk
          const fallbackLocation = { lat: 53.9, lng: 27.56 };
          setUserLocation(fallbackLocation);
          setSearchCenter((prev) => {
            if (prev) return prev;
            if (restoredStateRef.current) return prev;
            return fallbackLocation;
          });
          setLoadingLocation(false);
        },
        geolocationOptions
      );
    } else {
      setLocationError(mapText.geoErrorUnsupported);
      const fallbackLocation = { lat: 53.9, lng: 27.56 };
      setUserLocation(fallbackLocation);
      setSearchCenter((prev) => {
        if (prev) return prev;
        if (restoredStateRef.current) return prev;
        return fallbackLocation;
      });
      setLoadingLocation(false);
    }
  }, [mapText]);

  useEffect(() => {
    if (!userLocation) {
      setUserCityHint(null);
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const resolveCityHint = async () => {
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
        const address = typeof data?.address === "string" ? data.address : "";
        const city = extractCityHintFromAddress(address);
        if (isActive) {
          setUserCityHint(city);
        }
      } catch {
        if (isActive) {
          setUserCityHint(null);
        }
      }
    };

    void resolveCityHint();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [userLocation?.lat, userLocation?.lng]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        {/* Breadcrumbs */}
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <a href="/" className="hover:text-[#820251]">{t("common.home")}</a>
              <span>/</span>
              <span className="text-[#820251] font-medium">{mapText.breadcrumb}</span>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-6 px-4">
          <div className="max-w-5xl mx-auto">
            {/* Page header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">
                {mapText.pageTitle}
              </h1>
              <p className="text-gray-600">
                {mapText.pageSubtitle}
              </p>
            </div>

            {/* Location status */}
            {loadingLocation ? (
              <div className="bg-white rounded-lg p-6 text-center mb-6">
                <div className="w-8 h-8 border-4 border-[#820251] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-gray-500">{mapText.locating}</p>
              </div>
            ) : locationError ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <p className="text-yellow-700 text-sm">⚠️ {locationError}</p>
              </div>
            ) : null}

            {/* Search input */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {mapText.searchLabel}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={mapText.searchPlaceholder}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#820251]/30 focus:border-[#820251]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applySearch();
                    }
                  }}
                />
                <button
                  onClick={applySearch}
                  disabled={searchButtonBusy}
                  className="px-6 py-2.5 bg-[#820251] text-white rounded-lg font-medium hover:bg-[#7a0150] transition-colors"
                >
                  {searchButtonBusy ? mapText.searchingButton : mapText.searchButton}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {mapText.searchHelp}
              </p>
              {searchHint && (
                <p className="mt-2 text-xs text-[#820251]">{searchHint}</p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs text-gray-500">{mapText.quickFiltersLabel}</span>
                {mapText.quickFilters.map((tag) => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      setSearchInput(tag.value);
                      if (userLocation) {
                        setSearchCenter(userLocation);
                      }
                      setSearchCenterLabel(null);
                      setSearchHint("");
                      setSearchQuery(tag.value);
                    }}
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Map */}
            {userLocation && searchCenter && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <CompanyMap
                  userLocation={userLocation}
                  searchCenter={searchCenter}
                  searchCenterLabel={searchCenterLabel}
                  searchQuery={searchQuery}
                  radius={radius}
                  onRadiusChange={setRadius}
                  onLoadingChange={setSearchingCompanies}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
