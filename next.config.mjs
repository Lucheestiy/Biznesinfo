/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: "standalone", // temporarily disabled for build issues
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
