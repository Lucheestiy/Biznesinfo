"use client";

import { ReactNode, useEffect } from "react";
import { RegionProvider } from "@/contexts/RegionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { AuthProvider } from "@/contexts/AuthContext";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-app-hydrated", "1");
  }, []);

  return (
    <LanguageProvider>
      <RegionProvider>
        <AuthProvider>
          <FavoritesProvider>{children}</FavoritesProvider>
        </AuthProvider>
      </RegionProvider>
    </LanguageProvider>
  );
}
