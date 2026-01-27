"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface FavoritesContextType {
  favorites: string[];
  addFavorite: (companyId: string) => void;
  removeFavorite: (companyId: string) => void;
  isFavorite: (companyId: string) => boolean;
  toggleFavorite: (companyId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "biznes_favorites";

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          if (parsed.every((v) => typeof v === "string")) {
            setFavorites(parsed);
          } else {
            setFavorites([]);
          }
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    }
  }, [favorites, isInitialized]);

  const addFavorite = useCallback((companyId: string) => {
    setFavorites((prev) => {
      if (prev.includes(companyId)) return prev;
      return [...prev, companyId];
    });
  }, []);

  const removeFavorite = useCallback((companyId: string) => {
    setFavorites((prev) => prev.filter((id) => id !== companyId));
  }, []);

  const isFavorite = useCallback(
    (companyId: string) => favorites.includes(companyId),
    [favorites]
  );

  const toggleFavorite = useCallback((companyId: string) => {
    setFavorites((prev) => {
      if (prev.includes(companyId)) {
        return prev.filter((id) => id !== companyId);
      }
      return [...prev, companyId];
    });
  }, []);

  if (!isInitialized) {
    return null;
  }

  return (
    <FavoritesContext.Provider
      value={{ favorites, addFavorite, removeFavorite, isFavorite, toggleFavorite }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return context;
}
