import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    typedEnv: true,
  },
};

export default nextConfig;
