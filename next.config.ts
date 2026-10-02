import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/quiz-offline-sw.js", headers: [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Service-Worker-Allowed", value: "/quiz-offline" },
    ] }];
  },
  experimental: {
    typedEnv: true,
  },
};

export default nextConfig;
