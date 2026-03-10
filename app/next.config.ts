import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.belta.by",
      },
      {
        protocol: "https",
        hostname: "belta.by",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/catalog/sporttovary",
        destination: "/catalog/sport-zdorove-krasota/sportivnye-tovary-snaryajenie",
        permanent: true,
      },
      {
        source: "/catalog/selskoe-hozyaystvo",
        destination: "/catalog/apk-selskoe-i-lesnoe-hozyaystvo/selskoe-hozyaystvo",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
