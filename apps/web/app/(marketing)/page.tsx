"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import Testimonials from "@/components/marketing/Testimonials";
import { renderCanvas, stopCanvas } from "@/components/ui/canvas";
import {
  Shield,
  Key,
  Activity,
  Lock,
  Twitter,
  Linkedin,
  Mail,
  BookOpen,
} from "lucide-react";

const steps = [
  {
    num: "01",
    title: "Create an Account",
    description:
      "We create a smart account powered by ZeroDev, the most trusted smart account infrastructure, just for you.",
    icon: Shield,
  },
  {
    num: "02",
    title: "Activate Your Agent",
    description:
      "Select your protocols, customize your strategy, and deposit your funds.",
    icon: Key,
  },
  {
    num: "03",
    title: "Watch Your Money Grow",
    description:
      "Your agent optimizes yield across protocols within strict safety rules. No unauthorized transfers, no risky calls, no surprises. Just steady, transparent growth.",
    icon: Activity,
  },
];

const protocols = [
  { name: "Aave", logo: "/protocols/aave-official.svg" },
  { name: "Benqi", logo: "/protocols/benqi-official.svg" },
  { name: "Spark", logo: "/protocols/spark-official.svg" },
  { name: "Euler", logo: "/protocols/euler-official.svg" },
  { name: "Silo", logo: "/protocols/silo-official.svg" },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);
  const router = useRouter();

  const dashboardTarget =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
      ? "/dashboard"
      : "https://app.snowmind.xyz/dashboard";

  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardsRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setCardsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(cardsRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    renderCanvas();
    return () => stopCanvas();
  }, []);

  const handleLaunchApp = () => {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
    ) {
      router.push(dashboardTarget);
      return;
    }

    // Authentication must occur on app.snowmind.xyz so session state is
    // established on the same host as protected routes.
    window.location.href = "https://app.snowmind.xyz/dashboard";
  };

  return (
    <div>
      {/* Fixed header */}
      <header className="fixed top-0 left-0 w-full z-50 flex items-center justify-between px-5 py-4 md:px-10 md:py-5 bg-[#F5F0EB]/90 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/snowmind-logo.png"
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

        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="#how-it-works"
            className="font-sans font-medium text-sm text-[#1A1715] hover:opacity-70 transition-opacity duration-200"
          >
            How It Works
          </Link>
          <button
            onClick={handleLaunchApp}
            className="bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-sm px-6 py-2.5 rounded-lg hover:bg-[#D63031] transition-colors duration-200"
          >
            Launch App
          </button>
        </nav>

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
        className="fixed top-[68px] left-4 right-4 z-50 md:hidden bg-white/95 backdrop-blur-xl rounded-xl flex flex-col items-center gap-1 border border-[#E8E2DA] shadow-lg overflow-hidden transition-all duration-300"
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
        <button
          onClick={() => {
            setMenuOpen(false);
            handleLaunchApp();
          }}
          className="w-full text-center py-3 mt-1 bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base rounded-lg hover:bg-[#D63031] transition-colors"
        >
          Launch App
        </button>
      </div>

      {/* ═══ HERO — ContainerScroll with video ═══ */}
      <div className="bg-[#F5F0EB] overflow-hidden pt-16 md:pt-20">
        <ContainerScroll
          titleComponent={
            <>
              <h1 className="hero-fadein-1 font-sans font-bold text-[40px] md:text-[64px] text-[#1A1715] tracking-[-0.02em] leading-[1.1]">
                Earn more. Risk less.
              </h1>
              <p className="hero-fadein-2 font-sans font-normal text-[15px] md:text-[18px] text-[#5C5550] max-w-[520px] mx-auto leading-[1.6] mt-5">
                Your autonomous agent that finds the best yield on Avalanche.
                Safely and automatically.
              </p>
              <button
                className="hero-fadein-3 bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base px-10 py-4 rounded-[10px] mt-8 hover:bg-[#D63031] hover:scale-[1.02] transition-all duration-200 cursor-pointer"
                style={{ boxShadow: "0 4px 24px rgba(232, 65, 66, 0.3)" }}
                onClick={handleLaunchApp}
              >
                Create Agent
              </button>
            </>
          }
        >
          <video
            src="/landing-demo.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            controls={false}
            className="block h-full w-full object-fill rounded-2xl"
          />
        </ContainerScroll>
      </div>

      {/* ═══ TRUST STRIP — Protocol logos ═══ */}
      <section className="bg-[#F5F0EB] py-6 md:py-10 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          {/* Protocol logos */}
          <p className="font-sans font-medium text-[13px] text-[#8A837C] tracking-[0.06em] uppercase mb-6">
            Built on
          </p>
          <div className="flex items-center justify-center gap-8 md:gap-12 flex-wrap">
            {protocols.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity duration-200"
              >
                <Image
                  src={p.logo}
                  alt={p.name}
                  width={28}
                  height={28}
                  className="h-7 w-7"
                />
                <span className="font-sans font-semibold text-[15px] text-[#3A3530]">
                  {p.name}
                </span>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section
        id="how-it-works"
        className="bg-[#F5F0EB] py-12 md:py-20 px-6"
      >
        <div className="max-w-[1100px] mx-auto text-center">
          <p className="font-sans font-semibold text-[13px] text-[#E84142] tracking-[0.08em] uppercase">
            HOW IT WORKS
          </p>
          <h2 className="font-sans font-bold text-[28px] md:text-[36px] text-[#1A1715] mt-3">
            Three steps. That&apos;s it.
          </h2>

          <div ref={cardsRef} className="relative mt-14">
            {/* Connecting dashed line — desktop only */}
            <div className="hidden md:block absolute top-1/2 left-[16.67%] right-[16.67%] -translate-y-1/2 z-0 border-t border-dashed border-[#E8E2DA]" />

            {/* Cards */}
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6">
              {steps.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.num}
                    className={cardsVisible ? "card-visible" : "card-hidden"}
                    style={{
                      animationDelay: cardsVisible
                        ? `${i * 150}ms`
                        : undefined,
                    }}
                  >
                    <div
                      className="relative h-full bg-[#FAFAF8] border border-[#E8E2DA] rounded-2xl p-8 overflow-hidden text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(26,23,21,0.08)]"
                      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
                    >
                      <span className="absolute top-4 left-6 font-sans font-bold text-[48px] text-[#E84142] opacity-20 select-none leading-none">
                        {step.num}
                      </span>
                      <div className="relative pt-10">
                        <Icon className="w-6 h-6 text-[#E84142] mb-4" />
                        <h3 className="font-sans font-bold text-[22px] text-[#1A1715]">
                          {step.title}
                        </h3>
                        <p className="font-sans font-normal text-[15px] text-[#5C5550] leading-[1.6] mt-2">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ YOUR FUNDS. YOUR RULES. ═══ */}
      <section className="bg-[#FAFAF8] py-12 md:py-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <p className="font-sans font-semibold text-[13px] text-[#E84142] tracking-[0.08em] uppercase">
            SECURITY
          </p>
          <h2 className="font-sans font-bold text-[28px] md:text-[36px] text-[#1A1715] mt-3">
            Your funds. Your rules.
          </h2>
          <p className="font-sans font-normal text-[15px] md:text-[17px] text-[#5C5550] leading-[1.6] mt-4 max-w-[600px] mx-auto">
            Every safeguard is enforced on-chain.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-12">
            <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left">
              <div className="flex items-center gap-3 mb-3">
                <Shield className="w-5 h-5 text-[#E84142]" />
                <h3 className="font-sans font-bold text-[17px] text-[#1A1715]">
                  Non-custodial
                </h3>
              </div>
              <p className="font-sans font-normal text-[14px] text-[#5C5550] leading-[1.6]">
                Your funds stay in your own smart account at all times. We never hold, access, or control your money.
              </p>
            </div>

            <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left">
              <div className="flex items-center gap-3 mb-3">
                <Key className="w-5 h-5 text-[#E84142]" />
                <h3 className="font-sans font-bold text-[17px] text-[#1A1715]">
                  Scoped permissions
                </h3>
              </div>
              <p className="font-sans font-normal text-[14px] text-[#5C5550] leading-[1.6]">
                The agent can only supply and withdraw from lending markets. It cannot transfer, approve, or access anything else. Ever.
              </p>
            </div>

            <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left">
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-5 h-5 text-[#E84142]" />
                <h3 className="font-sans font-bold text-[17px] text-[#1A1715]">
                  Real-time risk monitoring
                </h3>
              </div>
              <p className="font-sans font-normal text-[14px] text-[#5C5550] leading-[1.6]">
                Automated risk checks run in real-time, faster than any human could react.
              </p>
            </div>

            <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left">
              <div className="flex items-center gap-3 mb-3">
                <Lock className="w-5 h-5 text-[#E84142]" />
                <h3 className="font-sans font-bold text-[17px] text-[#1A1715]">
                  Withdraw anytime
                </h3>
              </div>
              <p className="font-sans font-normal text-[14px] text-[#5C5550] leading-[1.6]">
                One click. No lockups, no waiting periods, no penalties. Your funds are always yours to take back.
              </p>
            </div>
          </div>

          {/* ZeroDev */}
          <div className="mt-10 pt-6 border-t border-[#E8E2DA]">
            <p className="font-sans font-medium text-[13px] text-[#8A837C] tracking-[0.06em] uppercase mb-4">
              Smart account powered by
            </p>
            <div className="flex items-center justify-center opacity-70">
              <Image
                src="/protocols/zerodev.svg"
                alt="ZeroDev"
                width={140}
                height={40}
                className="h-10 w-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <Testimonials />

      {/* ═══ FINAL CTA ═══ */}
      <section className="bg-[#F5F0EB] py-16 md:py-24 px-6">
        <div className="max-w-[600px] mx-auto text-center">
          <h2 className="font-sans font-bold text-[28px] md:text-[40px] text-[#1A1715] tracking-[-0.02em] leading-[1.15]">
            Start earning smarter yield today.
          </h2>
          <p className="font-sans font-normal text-[15px] md:text-[17px] text-[#5C5550] leading-[1.6] mt-4">
            Non-custodial. Transparent. Built for Avalanche.
          </p>
          <button
            onClick={handleLaunchApp}
            className="bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base px-10 py-4 rounded-[10px] mt-8 hover:bg-[#D63031] hover:scale-[1.02] transition-all duration-200 cursor-pointer"
            style={{ boxShadow: "0 4px 24px rgba(232, 65, 66, 0.3)" }}
          >
            Create Agent
          </button>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-[#1A1715] py-12 md:py-16 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex w-full flex-col justify-between gap-10 lg:flex-row lg:items-start">
            {/* Left column: logo, description, socials */}
            <div className="flex w-full flex-col gap-5 lg:max-w-[340px]">
              <div className="flex items-center gap-2.5">
                <Image
                  src="/snowmind-logo.png"
                  alt="Snow Mind"
                  width={100}
                  height={30}
                  className="h-[30px] w-auto"
                />
                <span className="font-sans font-bold text-lg text-[#FAFAF8]">
                  SnowMind
                </span>
              </div>
              <p className="font-sans font-normal text-[14px] text-[#8A837C] leading-[1.6]">
                A customizable yield optimization agent on Avalanche.
              </p>
              <div className="flex items-center gap-5">
                <a
                  href="https://x.com/snowmind_xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                  aria-label="Twitter"
                >
                  <Twitter className="w-5 h-5" />
                </a>
                <a
                  href="https://www.linkedin.com/company/snowmindxyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                  aria-label="LinkedIn"
                >
                  <Linkedin className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Right columns: links */}
            <div className="grid w-full grid-cols-2 gap-8 lg:max-w-[400px] lg:gap-16">
              <div>
                <h3 className="font-sans font-bold text-[14px] text-[#FAFAF8] mb-4">
                  Resources
                </h3>
                <ul className="space-y-3">
                  <li>
                    <a
                      href="https://docs.snowmind.xyz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans font-medium text-[14px] text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                    >
                      Docs
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://docs.snowmind.xyz/overview/teams"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans font-medium text-[14px] text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                    >
                      Team
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:contact@snowmind.xyz"
                      className="font-sans font-medium text-[14px] text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                    >
                      Contact
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-sans font-bold text-[14px] text-[#FAFAF8] mb-4">
                  Legal
                </h3>
                <ul className="space-y-3">
                  <li>
                    <a
                      href="https://docs.snowmind.xyz/other/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans font-medium text-[14px] text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                    >
                      Privacy Policy
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://docs.snowmind.xyz/other/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans font-medium text-[14px] text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                    >
                      Terms of Service
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div
            className="mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
          >
            <span className="font-sans font-normal text-[13px] text-[#5C5550]">
              &copy; 2026 SnowMind. All rights reserved.
            </span>
          </div>
        </div>
      </footer>

      {/* ═══ CURSOR WAVE TRAIL ═══ */}
      <canvas
        className="pointer-events-none fixed inset-0 z-[60]"
        id="canvas"
      />
    </div>
  );
}
