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

        <button
          onClick={handleLaunchApp}
          className="bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-sm px-6 py-2.5 rounded-lg hover:bg-[#D63031] transition-colors duration-200"
        >
          Launch App
        </button>
      </header>

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
                <a
                  href="https://discord.com/invite/xDkwdfX4W8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                  aria-label="Discord"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"/></svg>
                </a>
                <a
                  href="https://t.me/snowmind_xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
                  aria-label="Telegram"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
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
