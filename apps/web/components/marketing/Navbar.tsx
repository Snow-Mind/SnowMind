"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useMotionValueEvent, useScroll, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/demo", label: "Demo" },
  { href: "/activity", label: "Activity" },
] as const;

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 50);
  });

  return (
    <>
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 transition-colors duration-300"
        animate={{
          backgroundColor: scrolled
            ? "rgba(5, 10, 20, 0.85)"
            : "rgba(5, 10, 20, 0)",
          backdropFilter: scrolled ? "blur(20px) saturate(120%)" : "blur(0px)",
          borderBottomColor: scrolled
            ? "rgba(0, 196, 255, 0.08)"
            : "rgba(0, 196, 255, 0)",
        }}
        style={{ borderBottomWidth: 1, borderBottomStyle: "solid" }}
        transition={{ duration: 0.3 }}
      >
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          {/* Wordmark */}
          <Link href="/" className="flex items-center gap-2">
            <NeuralSnowflakeLogo className="h-5 w-5" />
            <span className="font-display text-sm font-semibold tracking-tight text-arctic">
              SnowMind
            </span>
          </Link>

          {/* Desktop Links — pill-style nav */}
          <div className="hidden items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-1 py-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3.5 py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {/* CTA */}
            <Link
              href="/dashboard"
              className="glacier-btn !py-1.5 !px-4 !text-[11px] !rounded-full !font-medium"
            >
              Launch App
            </Link>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white md:hidden"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>
      </motion.header>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 flex flex-col bg-void/95 backdrop-blur-xl pt-16 px-6 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <nav className="flex flex-col gap-1 mt-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/[0.04] hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="mt-4 glacier-btn text-center justify-center !rounded-lg"
              >
                Launch App
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
