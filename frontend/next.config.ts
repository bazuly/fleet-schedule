import type { NextConfig } from "next";

/** В контейнере фронтенд ходит к бэкенду по имени сервиса. Браузер снаружи этого адреса не видит. */
const API_PROXY_URL = process.env.API_PROXY_URL || "http://backend:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_PROXY_URL}/api/:path*` }];
  },
};

export default nextConfig;
