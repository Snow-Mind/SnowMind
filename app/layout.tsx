import type { Metadata } from "next";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { ArrowRight } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SnowMind Docs",
    template: "%s | SnowMind Docs",
  },
  description:
    "Documentation for SnowMind — autonomous, non-custodial yield optimization on Avalanche.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-snow-bg text-snow-text antialiased">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-snow-border bg-snow-surface/80 backdrop-blur-md px-4 py-3 md:px-6">
          <div className="flex items-center gap-4">
            <MobileNav />
            <Link href="/" className="flex items-center gap-2">
              <span className="font-bold text-lg text-snow-red tracking-tight">
                SnowMind
              </span>
              <span className="text-sm text-snow-muted font-medium">Docs</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://snowmind.xyz/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-snow-red px-4 py-1.5 text-sm font-semibold text-white hover:bg-snow-red-hover transition-colors"
            >
              Launch App
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </header>

        <div className="flex">
          <Sidebar />
          <main className="flex-1 min-w-0 px-6 py-8 md:px-10 lg:px-16 max-w-4xl">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
