"use client";

import { memo, useEffect, useState, useCallback, useMemo, useRef, type UIEvent } from "react";
import { YMaps, Map as YandexMap, Placemark, Circle } from "@pbe/react-yandex-maps";

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
  searchQuery?: string;
  radius: number;
  onRadiusChange?: (_radius: number) => void;
}

const RADIUS_OPTIONS = [
  { value: 5000, label: "5 км" },
  { value: 10000, label: "10 км" },
  { value: 20000, label: "20 км" },
  { value: 30000, label: "30 км" },
  { value: 50000, label: "50 км" },
];
const MIN_CUSTOM_RADIUS_KM = 1;
const MAX_CUSTOM_RADIUS_KM = 100;
const MAP_FETCH_LIMIT = 2000;
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

function formatDistanceKm(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters)) return "";
  return `${(distanceMeters / 1000).toFixed(1).replace(".", ",")} км`;
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
  searchQuery = "", 
  radius, 
  onRadiusChange 
}: CompanyMapProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [loading, setLoading] = useState(false);
  const [visibleCompanyCount, setVisibleCompanyCount] = useState(INITIAL_VISIBLE_COMPANIES);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [loadingUserAddress, setLoadingUserAddress] = useState(false);
  const [customRadiusKm, setCustomRadiusKm] = useState(() => formatRadiusInputValue(radius));
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const fetchNearbyCompanies = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const url = `/api/biznesinfo/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radius}&q=${encodeURIComponent(searchQuery)}&limit=${MAP_FETCH_LIMIT}`;
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
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      console.error("Failed to fetch nearby companies:", error);
      if (requestSeq === requestSeqRef.current) {
        setCompanies([]);
        setTotalCompanies(0);
        setVisibleCompanyCount(INITIAL_VISIBLE_COMPANIES);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [userLocation, radius, searchQuery]);

  useEffect(() => {
    fetchNearbyCompanies();
  }, [fetchNearbyCompanies]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
  const isPresetRadius = useMemo(() => RADIUS_OPTIONS.some((opt) => opt.value === radius), [radius]);
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
  const userAddressText = userAddress || (loadingUserAddress ? "Определяем адрес..." : `Координаты: ${userCoordinatesText}`);
  const userBalloonHtml = `
    <div style="padding:8px;max-width:260px;">
      <div style="font-size:14px;font-weight:700;color:#d60032;margin-bottom:6px;">Вы здесь</div>
      <div style="font-size:12px;line-height:1.45;color:#333;">${escapeHtml(userAddressText)}</div>
    </div>
  `;
  const userHintText = userAddress ? `Вы здесь: ${userAddress}` : "Вы здесь";

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
      ? `${formatDistanceKm(company.distance)} от вас`
      : "Расстояние уточняется";

    const bodyLines = [
      address,
      phone ? `Телефон: ${phone}` : "",
      distanceText,
    ].filter(Boolean);

    const body = bodyLines.join("<br/>");
    const footer = `<a href="/company/${encodeURIComponent(company.id)}" style="color:#820251;text-decoration:underline;">Открыть карточку</a>`;

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

  return (
    <div className="w-full">
      {/* Radius selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-gray-600 text-sm py-2">Радиус поиска:</span>
        {RADIUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onRadiusChange?.(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              radius === opt.value
                ? "bg-[#820251] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {opt.label}
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
            placeholder="Свой"
            className="w-14 border-0 bg-transparent text-sm text-gray-800 focus:outline-none"
            aria-label="Свой радиус в километрах"
          />
          <span className="text-xs text-gray-500">км</span>
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
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-gray-600">
          {loading ? "Поиск..." : `Найдено: ${totalCompanies} компаний`}
        </span>
        <button
          onClick={fetchNearbyCompanies}
          className="text-sm text-[#820251] hover:underline"
          disabled={loading}
        >
          🔄 Обновить
        </button>
      </div>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-[#d60032] shadow">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 38 52" aria-hidden="true">
            <path d="M19 2C10.2 2 3 9.2 3 18c0 12.1 13 27.5 16 31.8C22 45.5 35 30.1 35 18 35 9.2 27.8 2 19 2z" fill="#FF1744" />
            <circle cx="19" cy="18" r="7" fill="#ffffff" />
            <circle cx="19" cy="18" r="3.3" fill="#FF1744" />
          </svg>
          <span>Вы здесь</span>
        </div>
        <YMaps query={{ apikey: process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || "" }}>
          <YandexMap
            defaultState={{
              center: [userLocation.lat, userLocation.lng],
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
              geometry={[[userLocation.lat, userLocation.lng], radius]}
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
                balloonContentHeader: "Вы здесь",
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
          <a
            key={company.id}
            href={`/company/${company.id}`}
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-[#820251]/30 hover:bg-gray-50 transition-colors"
          >
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <CompanyListLogo companyId={company.id} logoUrl={company.logo_url} alt={company.name} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 truncate">{company.name}</div>
              <div className="text-sm text-gray-500 truncate">{company.address}</div>
            </div>
            <div className="text-sm text-[#820251] font-medium whitespace-nowrap">
              {Number.isFinite(company.distance) ? formatDistanceKm(company.distance) : "—"}
            </div>
          </a>
        ))}
        {hiddenTotalCount > 0 && (
          <div className="text-center py-2">
            <div className="text-sm text-gray-500">
              {hasMoreLoadedCompanies
                ? `Прокрутите ниже, чтобы показать ещё ${nextLoadBatchCount} компаний`
                : `...и ещё ${hiddenTotalCount} компаний`}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Показано {shownCompanyCount} из {effectiveTotalCompanies}
              {hasServerUnloadedRemainder ? ` (загружено ${companies.length})` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(CompanyMap);
