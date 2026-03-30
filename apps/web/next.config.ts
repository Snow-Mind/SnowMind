import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
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
