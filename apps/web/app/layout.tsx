import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SnowMind — Autonomous Yield on Avalanche",
  description:
    "Autonomous yield optimization on Avalanche C-Chain. Non-custodial, mathematically optimal.",
  openGraph: {
    title: "SnowMind — Autonomous Yield on Avalanche",
    description:
      "Autonomous yield optimization on Avalanche C-Chain. Non-custodial, mathematically optimal.",
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
      <body className={`${dmSans.className} bg-[#F5F0EB] text-[#1A1715] font-sans antialiased min-h-screen`}>
        <Providers>
          <div className="relative z-10">{children}</div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
