"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  const { t } = useLanguage();
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
  const [searchHint, setSearchHint] = useState("");

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
      const geocodeQuery = withCityHint(nextQuery, userCityHint);
      const geocodeUrl = `/api/biznesinfo/geocode?q=${encodeURIComponent(geocodeQuery)}${
        userLocation
          ? `&lat=${encodeURIComponent(String(userLocation.lat))}&lng=${encodeURIComponent(String(userLocation.lng))}`
          : ""
      }`;
      const response = await fetch(geocodeUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`geocode_status:${response.status}`);
      }

      const data = await response.json();
      const lat = Number(data?.coords?.lat);
      const lng = Number(data?.coords?.lng);
      const kind = typeof data?.kind === "string" ? data.kind : "";
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("geocode_invalid_coords");
      }
      if (!isStreetGeocodeKind(kind)) {
        throw new Error("geocode_not_street");
      }

      const address = typeof data?.address === "string" ? data.address.trim() : "";
      const hasHouse = hasHouseNumber(nextQuery);
      setSearchCenter({ lat, lng });
      setSearchCenterLabel(address || nextQuery);
      setSearchQuery(hasHouse ? nextQuery : "");
      setSearchHint(
        hasHouse
          ? "Показаны компании по введенному адресу (улица + дом) в выбранном радиусе."
          : "Показаны все компании в выбранном радиусе от указанной улицы.",
      );
    } catch {
      if (userLocation) {
        setSearchCenter(userLocation);
      }
      setSearchCenterLabel(null);
      setSearchQuery(nextQuery);
      setSearchHint("Улицу определить не удалось. Выполнен обычный поиск по запросу.");
    } finally {
      setSearchingAddress(false);
    }
  }, [searchInput, userLocation, userCityHint]);

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
          setLocationError("Не удалось определить местоположение. Используется Минск по умолчанию.");
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
      setLocationError("Геолокация не поддерживается браузером.");
      const fallbackLocation = { lat: 53.9, lng: 27.56 };
      setUserLocation(fallbackLocation);
      setSearchCenter((prev) => {
        if (prev) return prev;
        if (restoredStateRef.current) return prev;
        return fallbackLocation;
      });
      setLoadingLocation(false);
    }
  }, []);

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
              <span className="text-[#820251] font-medium">Поиск на карте</span>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-6 px-4">
          <div className="max-w-5xl mx-auto">
            {/* Page header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">
                🗺️ Поиск компаний на карте
              </h1>
              <p className="text-gray-600">
                Найдите компании в заданном радиусе от вашего местоположения или указанной улицы
              </p>
            </div>

            {/* Location status */}
            {loadingLocation ? (
              <div className="bg-white rounded-lg p-6 text-center mb-6">
                <div className="w-8 h-8 border-4 border-[#820251] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-gray-500">Определение местоположения...</p>
              </div>
            ) : locationError ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <p className="text-yellow-700 text-sm">⚠️ {locationError}</p>
              </div>
            ) : null}

            {/* Search input */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Что ищем?
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Например: молоко, строительные материалы, автосервис..."
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
                  disabled={searchingAddress}
                  className="px-6 py-2.5 bg-[#820251] text-white rounded-lg font-medium hover:bg-[#7a0150] transition-colors"
                >
                  {searchingAddress ? "Ищем..." : "Найти"}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Введите услугу, улицу или улицу с домом (например, «ул. Притыцкого, 17»). Для улицы показываем все компании в радиусе, для улицы+дома — компании по адресу.
              </p>
              {searchHint && (
                <p className="mt-2 text-xs text-[#820251]">{searchHint}</p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs text-gray-500">Быстрые фильтры:</span>
                {["молоко", "стройматериалы", "автосервис", "кафе", "аптека"].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setSearchInput(tag);
                      if (userLocation) {
                        setSearchCenter(userLocation);
                      }
                      setSearchCenterLabel(null);
                      setSearchHint("");
                      setSearchQuery(tag);
                    }}
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                  >
                    {tag}
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
