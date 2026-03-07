"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { GLSLHills } from "@/components/ui/glsl-hills";

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* GLSL Hills animation — full-screen background */}
      <GLSLHills />

      {/* Fixed header */}
      <header className="fixed top-0 left-0 w-full z-20 flex items-center justify-between px-5 py-4 md:px-10 md:py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Snow Mind"
            width={120}
            height={38}
            className="h-[38px] w-auto"
            priority
          />
          <span className="font-sans font-bold text-xl text-[#E84142] tracking-[-0.02em]">
            SnowMind
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="#how-it-works"
            className="font-sans font-medium text-sm text-[#1A1715] hover:opacity-70 transition-opacity duration-200"
          >
            How It Works
          </Link>
          <Link
            href="#docs"
            className="font-sans font-medium text-sm text-[#1A1715] hover:opacity-70 transition-opacity duration-200"
          >
            Docs
          </Link>
          <Link
            href="/dashboard"
            className="bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-sm px-6 py-2.5 rounded-lg hover:bg-[#D63031] transition-colors duration-200"
          >
            Launch App
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex flex-col gap-[5px] p-1 z-30"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span
            className="block w-[22px] h-[2px] bg-[#1A1715] rounded-sm origin-center transition-all duration-300"
            style={
              menuOpen
                ? { transform: "translateY(7px) rotate(45deg)" }
                : undefined
            }
          />
          <span
            className="block w-[22px] h-[2px] bg-[#1A1715] rounded-sm transition-all duration-300"
            style={menuOpen ? { opacity: 0 } : undefined}
          />
          <span
            className="block w-[22px] h-[2px] bg-[#1A1715] rounded-sm origin-center transition-all duration-300"
            style={
              menuOpen
                ? { transform: "translateY(-7px) rotate(-45deg)" }
                : undefined
            }
          />
        </button>
      </header>

      {/* Mobile dropdown menu */}
      <div
        className="fixed top-[68px] left-4 right-4 z-30 md:hidden bg-white/95 backdrop-blur-xl rounded-xl flex flex-col items-center gap-1 border border-[#E8E2DA] shadow-lg overflow-hidden transition-all duration-300"
        style={{
          maxHeight: menuOpen ? 250 : 0,
          opacity: menuOpen ? 1 : 0,
          padding: menuOpen ? "16px" : "0 16px",
        }}
      >
        <Link
          href="#how-it-works"
          onClick={() => setMenuOpen(false)}
          className="w-full text-center py-3 text-[#1A1715] font-sans font-medium text-base rounded-lg hover:bg-[#F5F0EB] transition-colors"
        >
          How It Works
        </Link>
        <Link
          href="#docs"
          onClick={() => setMenuOpen(false)}
          className="w-full text-center py-3 text-[#1A1715] font-sans font-medium text-base rounded-lg hover:bg-[#F5F0EB] transition-colors"
        >
          Docs
        </Link>
        <Link
          href="/dashboard"
          onClick={() => setMenuOpen(false)}
          className="w-full text-center py-3 mt-1 bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base rounded-lg hover:bg-[#D63031] transition-colors"
        >
          Launch App
        </Link>
      </div>

      {/* Centered hero content */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center pointer-events-none px-6">
        <h1 className="hero-fadein-1 font-sans font-bold text-[40px] md:text-[64px] text-[#1A1715] tracking-[-0.02em] leading-[1.1]">
          Earn more. Risk less.
        </h1>

        <p className="hero-fadein-2 font-sans font-normal text-[15px] md:text-[18px] text-[#5C5550] max-w-[520px] leading-[1.6] mt-5">
          Your AI agent that finds the best yield on Avalanche.
          Automatically.
        </p>

        <button
          className="hero-fadein-3 pointer-events-auto bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base px-10 py-4 rounded-[10px] mt-8 hover:bg-[#D63031] hover:scale-[1.02] transition-all duration-200 cursor-pointer"
          style={{
            boxShadow: "0 4px 24px rgba(232, 65, 66, 0.3)",
          }}
          onClick={() => console.log("Create Agent clicked")}
        >
          Create Agent
        </button>

        <a
          href="#how-it-works"
          className="hero-fadein-4 pointer-events-auto text-[#5C5550] font-sans font-medium text-sm mt-4 hover:underline hover:underline-offset-[3px] transition-all duration-200 cursor-pointer"
        >
          Learn how it works &rarr;
        </a>
      </div>
    </div>
  );
}
