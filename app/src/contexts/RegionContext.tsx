"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { regions } from "@/data/regions";
import { safeLocalStorageRemove, safeLocalStorageSet } from "@/lib/browser/safeStorage";

interface RegionContextType {
  selectedRegion: string | null;
  setSelectedRegion: (region: string | null) => void;
  regionName: string;
}

const RegionContext = createContext<RegionContextType | undefined>(undefined);

const REGION_STORAGE_KEY = "biznes_selected_region";

const regionNames: Record<string, string> = Object.fromEntries(regions.map((r) => [r.slug, r.name]));

export function RegionProvider({ children }: { children: ReactNode }) {
  const [selectedRegion, setSelectedRegionState] = useState<string | null>(null);

  useEffect(() => {
    // Don't restore saved region - always start with "Выбрать регион"
    safeLocalStorageRemove(REGION_STORAGE_KEY);
  }, []);

  const setSelectedRegion = useCallback((region: string | null) => {
    setSelectedRegionState(region);
    if (region) {
      safeLocalStorageSet(REGION_STORAGE_KEY, region);
    } else {
      safeLocalStorageRemove(REGION_STORAGE_KEY);
    }
  }, []);

  const regionName = selectedRegion ? regionNames[selectedRegion] || selectedRegion : "Все регионы";

  return (
    <RegionContext.Provider value={{ selectedRegion, setSelectedRegion, regionName }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  const context = useContext(RegionContext);
  if (context === undefined) {
    throw new Error("useRegion must be used within a RegionProvider");
  }
  return context;
}
