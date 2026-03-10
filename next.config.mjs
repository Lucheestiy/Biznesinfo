/** @type {import('next').NextConfig} */
const nextConfig = {
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
