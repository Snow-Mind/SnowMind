import Link from "next/link";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import Navbar from "@/components/marketing/Navbar";

function Footer() {
  return (
    <footer className="border-t border-white/[0.04] bg-void">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <NeuralSnowflakeLogo className="h-3.5 w-3.5 opacity-50" />
          <span className="text-[11px] text-slate-600">
            &copy; {new Date().getFullYear()} SnowMind
          </span>
        </div>
        <div className="flex items-center gap-5">
          {[
            { href: "#", label: "Privacy" },
            { href: "#", label: "Terms" },
            { href: "https://github.com/Snow-Mind", label: "GitHub" },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-[11px] text-slate-600 transition-colors hover:text-slate-400"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      {children}
      <Footer />
    </>
  );
}
