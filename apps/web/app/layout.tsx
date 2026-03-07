import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import SnowCanvas from "@/components/snow/SnowCanvas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SnowMind — Autonomous Yield on Avalanche",
  description:
    "AI-powered yield optimization on Avalanche C-Chain. Non-custodial, autonomous, mathematically optimal.",
  openGraph: {
    title: "SnowMind — Autonomous Yield on Avalanche",
    description:
      "AI-powered yield optimization on Avalanche C-Chain. Non-custodial, autonomous, mathematically optimal.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-void text-arctic font-body antialiased min-h-screen">
        <Providers>
          <SnowCanvas />
          <div className="relative z-10">{children}</div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
