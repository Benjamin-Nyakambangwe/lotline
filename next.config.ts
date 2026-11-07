import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Lot photos are proxied and cached by our server, so browsers never contact ABC directly.
    // Paths are immutable UUIDs, so a long cache is safe.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn-s3.abcauctions.co.zw",
        pathname: "/**",
        search: "",
      },
    ],
    qualities: [60, 75],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    maximumRedirects: 0,
  },
};

export default nextConfig;
