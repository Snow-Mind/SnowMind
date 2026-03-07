import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#F5F0EB] text-[#1A1715] font-sans antialiased min-h-screen">
        <Providers>
          <div className="relative z-10">{children}</div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
