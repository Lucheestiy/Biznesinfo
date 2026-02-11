"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from "react";
import { useAuth } from "./AuthContext";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";

interface FavoritesContextType {
  favorites: string[];
  addFavorite: (companyId: string) => void;
  removeFavorite: (companyId: string) => void;
  isFavorite: (companyId: string) => boolean;
  toggleFavorite: (companyId: string) => void;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "biznes_favorites";

function normalizeFavoriteId(raw: string): string {
  return companySlugForUrl((raw || "").trim());
}

function normalizeFavoritesList(rawIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds || []) {
    const id = normalizeFavoriteId(raw);
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { enabled, user, loading: authLoading } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const didMigrateRef = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          if (parsed.every((v) => typeof v === "string")) {
            setFavorites(normalizeFavoritesList(parsed));
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

  // Sync favorites with server when logged in.
  useEffect(() => {
    if (!isInitialized) return;
    if (authLoading) return;
    if (!enabled || !user) return;
    let cancelled = false;

    const run = async () => {
      setIsSyncing(true);
      try {
        const res = await fetch("/api/user/favorites", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const serverFavs = normalizeFavoritesList(
          Array.isArray(data?.favorites) ? data.favorites.filter((v: any) => typeof v === "string") : [],
        );

        // If server empty but local has items, migrate local -> server once.
        if (!didMigrateRef.current && serverFavs.length === 0 && favorites.length > 0) {
          const putRes = await fetch("/api/user/favorites", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ favorites: normalizeFavoritesList(favorites) }),
          });
          const putData = await putRes.json().catch(() => ({}));
          if (putRes.ok) {
            const updated = normalizeFavoritesList(
              Array.isArray(putData?.favorites) ? putData.favorites : favorites,
            );
            didMigrateRef.current = true;
            if (!cancelled) setFavorites(updated);
            return;
          }
        }

        if (!cancelled) setFavorites(serverFavs);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, user, authLoading, isInitialized, favorites]);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    }
  }, [favorites, isInitialized]);

  const addFavorite = useCallback((companyId: string) => {
    const normalizedId = normalizeFavoriteId(companyId);
    if (!normalizedId) return;
    setFavorites((prev) => {
      if (prev.includes(normalizedId)) return prev;
      return [...prev, normalizedId];
    });
  }, []);

  const removeFavorite = useCallback((companyId: string) => {
    const normalizedId = normalizeFavoriteId(companyId);
    if (!normalizedId) return;
    setFavorites((prev) => prev.filter((id) => id !== normalizedId));
  }, []);

  const isFavorite = useCallback(
    (companyId: string) => favorites.includes(normalizeFavoriteId(companyId)),
    [favorites]
  );

  const toggleFavorite = useCallback((companyId: string) => {
    const normalizedId = normalizeFavoriteId(companyId);
    if (!normalizedId) return;
    const shouldRemove = favorites.includes(normalizedId);
    setFavorites((prev) => {
      if (prev.includes(normalizedId)) return prev.filter((id) => id !== normalizedId);
      return [...prev, normalizedId];
    });

    // Best-effort server persistence when logged in.
    if (enabled && user) {
      fetch("/api/user/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: normalizedId, action: shouldRemove ? "remove" : "add" }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const next = Array.isArray(data?.favorites) ? normalizeFavoritesList(data.favorites) : null;
          if (next) setFavorites(next);
        })
        .catch(() => {});
    }
  }, [enabled, favorites, user]);

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
