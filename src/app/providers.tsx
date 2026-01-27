"use client";

import { ReactNode } from "react";
import { RegionProvider } from "@/contexts/RegionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <RegionProvider>
        <FavoritesProvider>{children}</FavoritesProvider>
      </RegionProvider>
    </LanguageProvider>
  );
}
