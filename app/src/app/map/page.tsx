"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CompanyMap from "@/components/CompanyMap";
import { useLanguage } from "@/contexts/LanguageContext";

export default function MapPage() {
  const { t } = useLanguage();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [radius, setRadius] = useState(10000); // Default 10km
  const [locationError, setLocationError] = useState("");
  const [loadingLocation, setLoadingLocation] = useState(true);

  const applySearch = useCallback(() => {
    setSearchQuery((searchInput || "").trim());
  }, [searchInput]);

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
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationError("");
          setLoadingLocation(false);
        },
        (error) => {
          console.error("Geolocation error:", error);
          setLocationError("Не удалось определить местоположение. Используется Минск по умолчанию.");
          // Default to Minsk
          setUserLocation({ lat: 53.9, lng: 27.56 });
          setLoadingLocation(false);
        },
        geolocationOptions
      );
    } else {
      setLocationError("Геолокация не поддерживается браузером.");
      setUserLocation({ lat: 53.9, lng: 27.56 });
      setLoadingLocation(false);
    }
  }, []);

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
                Найдите ближайшие компании в заданном радиусе от вашего местоположения
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
                  className="px-6 py-2.5 bg-[#820251] text-white rounded-lg font-medium hover:bg-[#7a0150] transition-colors"
                >
                  Найти
                </button>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs text-gray-500">Быстрые фильтры:</span>
                {["молоко", "стройматериалы", "автосервис", "кафе", "аптека"].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setSearchInput(tag);
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
            {userLocation && (
              <div className="bg-white rounded-lg shadow-sm p-4">
                <CompanyMap
                  userLocation={userLocation}
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
