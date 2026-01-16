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
};

export default nextConfig;
