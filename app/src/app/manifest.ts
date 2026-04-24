import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const ICON_VERSION = "20260312-3";

export const dynamic = "force-dynamic";

function isIosHomeScreenRiskUa(userAgent: string): boolean {
  const ua = userAgent || "";
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && /Mobile\//i.test(ua);
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent") || "";
  const displayMode = isIosHomeScreenRiskUa(userAgent) ? "browser" : "standalone";

  return {
    name: "Biznesinfo.by — Бизнес-справочник Беларуси",
    short_name: "Biznesinfo.by",
    description:
      "Поиск предприятий, организаций и компаний. Товары и услуги от надежных партнеров.",
    start_url: "/",
    scope: "/",
    display: displayMode,
    orientation: "portrait",
    background_color: "#a0006d",
    theme_color: "#a0006d",
    lang: "ru",
    icons: [
      {
        src: `/favicon-120x120.png?v=${ICON_VERSION}`,
        sizes: "120x120",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/favicon-192x192.png?v=${ICON_VERSION}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: `/favicon-512x512.png?v=${ICON_VERSION}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
