import type { MetadataRoute } from "next";

const ICON_VERSION = "20260312-3";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Biznesinfo.by — Бизнес-справочник Беларуси",
    short_name: "Biznesinfo.by",
    description:
      "Поиск предприятий, организаций и компаний. Товары и услуги от надежных партнеров.",
    start_url: "/",
    scope: "/",
    display: "standalone",
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
