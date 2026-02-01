"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLanguage } from "@/contexts/LanguageContext";

type Coords = { lat: number; lng: number };

let yandexMapsLoadPromise: Promise<any> | null = null;
let yandexMapsApiKeyPromise: Promise<string | null> | null = null;
const geocodeCache = new Map<string, Coords>();

async function fetchYandexMapsApiKey(): Promise<string | null> {
  if (yandexMapsApiKeyPromise) return yandexMapsApiKeyPromise;
  yandexMapsApiKeyPromise = fetch("/api/public-config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const key = (json?.yandexMapsApiKey || "").trim();
      return key || null;
    })
    .catch(() => null);
  return yandexMapsApiKeyPromise;
}

async function loadYandexMaps(apiKey: string): Promise<any> {
  if (typeof window === "undefined") return null;
  const existingApi = (window as any).ymaps;
  if (existingApi) return existingApi;
  if (yandexMapsLoadPromise) return yandexMapsLoadPromise;

  yandexMapsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-yandex-maps="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).ymaps));
      existing.addEventListener("error", () => reject(new Error("yandex_maps_script_load_failed")));
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.yandexMaps = "1";
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.onload = () => resolve((window as any).ymaps);
    script.onerror = () => reject(new Error("yandex_maps_script_load_failed"));
    document.head.appendChild(script);
  });

  return yandexMapsLoadPromise;
}

function ymapsReady(ymaps: any): Promise<void> {
  return new Promise((resolve) => {
    ymaps.ready(resolve);
  });
}

function normalizeGeocodeQuery(address: string): string {
  const trimmed = (address || "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.includes("беларус")) return trimmed;
  if (lower.includes("belarus")) return trimmed;
  return `Беларусь, ${trimmed}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export default function CompanyLocationMap(props: {
  companyName: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const { t } = useLanguage();
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  const [resolvedCoords, setResolvedCoords] = useState<Coords | null>(null);
  const [resolvedFromAddress, setResolvedFromAddress] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  const initialCoords = useMemo<Coords | null>(() => {
    if (isFiniteNumber(props.lat) && isFiniteNumber(props.lng)) return { lat: props.lat, lng: props.lng };
    return null;
  }, [props.lat, props.lng]);

  const geocodeQuery = useMemo(() => normalizeGeocodeQuery(props.address || ""), [props.address]);

  useEffect(() => {
    setResolvedCoords(initialCoords);
    setResolvedFromAddress(false);
  }, [initialCoords]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setMapsError(null);
      setMapsReady(false);

      const apiKey = await fetchYandexMapsApiKey();
      if (cancelled) return;
      setHasApiKey(Boolean(apiKey));
      if (!apiKey) return;

      const ymaps = await loadYandexMaps(apiKey);
      if (cancelled) return;
      if (!ymaps) throw new Error("yandex_maps_not_available");
      await ymapsReady(ymaps);
      if (cancelled) return;

      let coords = initialCoords;
      let derivedFromAddress = false;

      if (!coords && geocodeQuery) {
        const cached = geocodeCache.get(geocodeQuery);
        if (cached) {
          coords = cached;
          derivedFromAddress = true;
        } else {
          try {
            const response = await ymaps.geocode(geocodeQuery, { results: 1 });
            const first = response?.geoObjects?.get?.(0) || null;
            const raw = first?.geometry?.getCoordinates?.() || null;
            if (Array.isArray(raw) && raw.length >= 2 && isFiniteNumber(raw[0]) && isFiniteNumber(raw[1])) {
              coords = { lat: raw[0], lng: raw[1] };
              geocodeCache.set(geocodeQuery, coords);
              derivedFromAddress = true;
            }
          } catch {
            // ignore geocode errors; still render map with search control
          }
        }
      }

      if (cancelled) return;
      setResolvedCoords(coords);
      setResolvedFromAddress(derivedFromAddress);

      const el = mapElRef.current;
      if (!el) return;

      if (mapRef.current) {
        try {
          mapRef.current.destroy();
        } catch {
          // ignore
        }
        mapRef.current = null;
      }

      const center = coords ? [coords.lat, coords.lng] : [53.902735, 27.555696]; // Minsk
      const zoom = coords ? 16 : 6;

      const map = new ymaps.Map(
        el,
        { center, zoom, controls: [] },
        { suppressMapOpenBlock: true },
      );
      mapRef.current = map;

      try {
        map.behaviors.disable("scrollZoom");
      } catch {
        // ignore
      }

      map.controls.add(new ymaps.control.ZoomControl({ options: { position: { right: 10, top: 50 } } }));
      map.controls.add(new ymaps.control.GeolocationControl({ options: { position: { right: 10, top: 10 } } }));
      map.controls.add(
        new ymaps.control.SearchControl({
          options: {
            provider: "yandex#search",
            size: "large",
            noPlacemark: false,
            placeholderContent: t("map.searchPlaceholder"),
          },
        }),
      );

      if (coords) {
        const placemark = new ymaps.Placemark(
          [coords.lat, coords.lng],
          { iconCaption: props.companyName },
          { preset: "islands#redIcon" },
        );
        map.geoObjects.add(placemark);
      }

      if (!cancelled) setMapsReady(true);
    }

    init().catch((e) => {
      if (cancelled) return;
      setMapsError(String((e as Error)?.message || "yandex_maps_error"));
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.destroy();
        } catch {
          // ignore
        }
        mapRef.current = null;
      }
    };
  }, [geocodeQuery, initialCoords, props.companyName, t]);

  const canBuildRoute = resolvedCoords != null;

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-md p-6 border-l-4 border-[#7a0150]">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <span className="text-2xl">🗺️</span>
          {t("company.locationOnMap")}
        </h2>
        {canBuildRoute && (
          <a
            href={`https://yandex.ru/maps/?rtext=~${resolvedCoords!.lat},${resolvedCoords!.lng}&rtt=auto`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#820251] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#7a0150] transition-colors text-sm"
          >
            {t("company.buildRoute")}
          </a>
        )}
      </div>

      {hasApiKey === false && initialCoords && (
        <>
          <div className="text-sm text-gray-500 mb-3">
            {t("map.needsApiKeyShort")}
          </div>
          <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
            <iframe
              src={`https://yandex.ru/map-widget/v1/?ll=${initialCoords.lng}%2C${initialCoords.lat}&z=16&pt=${initialCoords.lng}%2C${initialCoords.lat}%2Cpm2rdm`}
              width="100%"
              height="100%"
              frameBorder="0"
              allowFullScreen
              className="w-full h-full"
            ></iframe>
          </div>
        </>
      )}

      {hasApiKey === false && !initialCoords && (
        <div className="text-gray-500">
          {t("map.unavailableNoCoordsNoKey")}
        </div>
      )}

      {hasApiKey !== false && (
        <>
          <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative">
            <div ref={mapElRef} className="w-full h-full" />
            {!mapsReady && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                {mapsError ? t("map.loadError") : t("map.loading")}
              </div>
            )}
          </div>
          {resolvedFromAddress && (
            <div className="text-xs text-gray-500 mt-3">
              {t("map.coordsFromAddressNote")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
