import type { NextConfig } from "next";

const DEFAULT_PRODUCTION_BACKEND_TARGET = "https://snowmindbackend-production-10ed.up.railway.app";
const DEFAULT_DEVELOPMENT_BACKEND_TARGET = "http://localhost:8000";

const APP_HOSTS = new Set([
  "app.snowmind.xyz",
  "snowmind.xyz",
  "www.snowmind.xyz",
]);

function normalizeBackendProxyTarget(rawValue: string | undefined): string | null {
  if (!rawValue) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedHost = parsed.hostname.toLowerCase();

    // Guard against /api rewrite loops when backend target is app host.
    if (APP_HOSTS.has(normalizedHost)) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return null;
  }
}

const defaultBackendProxyTarget = process.env.NODE_ENV === "production"
  ? DEFAULT_PRODUCTION_BACKEND_TARGET
  : DEFAULT_DEVELOPMENT_BACKEND_TARGET;

const backendProxyTarget =
  normalizeBackendProxyTarget(process.env.BACKEND_URL)
  ?? normalizeBackendProxyTarget(process.env.NEXT_PUBLIC_BACKEND_URL)
  ?? defaultBackendProxyTarget;

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendProxyTarget}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          { type: "host", value: "app.snowmind.xyz" },
          { type: "header", key: "x-forwarded-proto", value: "http" },
        ],
        destination: "https://app.snowmind.xyz/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          { type: "host", value: "snowmind.xyz" },
          { type: "header", key: "x-forwarded-proto", value: "http" },
        ],
        destination: "https://www.snowmind.xyz/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          { type: "host", value: "www.snowmind.xyz" },
          { type: "header", key: "x-forwarded-proto", value: "http" },
        ],
        destination: "https://www.snowmind.xyz/:path*",
        permanent: true,
      },
      {
        source: "/demo",
        destination: "/how-it-works",
        permanent: true,
      },
      {
        source: "/activity",
        destination: "/how-it-works",
        permanent: true,
      },
      {
        source: "/docs",
        destination: "https://docs.snowmind.xyz/",
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: "https://docs.snowmind.xyz/:path*",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "snowmind.xyz" },
      { protocol: "https", hostname: "www.snowmind.xyz" },
      { protocol: "https", hostname: "app.aave.com" },
      { protocol: "https", hostname: "app.benqi.fi" },
      { protocol: "https", hostname: "app.euler.finance" },
      { protocol: "https", hostname: "app.spark.fi" },
    ],
  },
  transpilePackages: ["@snowmind/shared-types"],
};

export default nextConfig;
