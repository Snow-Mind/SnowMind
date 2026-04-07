import type { NextConfig } from "next";

const rawBackendProxyTarget =
  process.env.BACKEND_URL
  ?? process.env.NEXT_PUBLIC_BACKEND_URL
  ?? (process.env.NODE_ENV === "production"
    ? "https://api.snowmind.xyz"
    : "http://localhost:8000");

const backendProxyTarget = rawBackendProxyTarget.replace(/\/+$/, "");

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
