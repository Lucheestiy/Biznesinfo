"use client";

import { ReactNode } from "react";
import { RegionProvider } from "@/contexts/RegionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { AuthProvider } from "@/contexts/AuthContext";

export function Providers({ children }: { children: ReactNode }) {
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
