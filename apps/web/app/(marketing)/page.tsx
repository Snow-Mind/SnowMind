"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { GLSLHills } from "@/components/ui/glsl-hills";
import { useAuth } from "@/hooks/useAuth";
import {
  Shield,
  TrendingUp,
  Eye,
  Lock,
  ShieldCheck,
  Snowflake,
} from "lucide-react";

const steps = [
  {
    num: "01",
    title: "Deposit",
    description:
      "Connect your wallet and deposit USDC. Your funds stay in your own smart account. We never hold your money.",
    icon: Shield,
  },
  {
    num: "02",
    title: "Optimize",
    description:
      "Our agent monitors lending rates across Avalanche and moves your capital to where it earns the most, within safe boundaries.",
    icon: TrendingUp,
  },
  {
    num: "03",
    title: "Earn",
    description:
      "Watch your yield grow. Check your dashboard anytime to see exactly where your funds are and why the agent made each decision.",
    icon: Eye,
  },
];

const features = [
  {
    title: "Your wallet. Your funds.",
    description:
      "Your capital stays in your own smart account at all times. We can never access, move, or withdraw your funds. You hold the keys.",
    icon: Lock,
  },
  {
    title: "See every decision.",
    description:
      "Every allocation, every rebalance, every move comes with an explanation. You always know where your money is and why it\u2019s there.",
    icon: Eye,
  },
  {
    title: "Safety over yield. Always.",
    description:
      "Protocol concentration limits, risk-adjusted allocation, and conservative defaults. We\u2019d rather miss 1% upside than expose you to unnecessary risk.",
    icon: ShieldCheck,
  },
  {
    title: "Built for Avalanche.",
    description:
      "Not a multi-chain afterthought. SnowMind is purpose-built for Avalanche\u2019s lending ecosystem, starting with Aave V3, Benqi, and Spark.",
    icon: Snowflake,
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const router = useRouter();
  const { authenticated, login, ready } = useAuth();

  const scrollProgressRef = useRef(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    let progress = 0;

    const handleScroll = () => {
      progress = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));

      if (window.innerWidth >= 768) {
        scrollProgressRef.current = progress;
      } else {
        scrollProgressRef.current = 0;
      }
    };

    const updateVisuals = () => {
      if (heroRef.current) {
        const heroOpacity = Math.max(0, 1 - progress / 0.3);
        const heroScale = 1 - Math.min(progress / 0.3, 1) * 0.03;
        heroRef.current.style.opacity = String(heroOpacity);
        heroRef.current.style.transform = `scale(${heroScale})`;
      }

      if (overlayRef.current) {
        overlayRef.current.style.opacity = String(
          Math.max(0, (progress - 0.8) / 0.2),
        );
      }

      if (scrollIndicatorRef.current) {
        scrollIndicatorRef.current.style.opacity = String(
          Math.max(0, 1 - progress / 0.15),
        );
      }

      rafId = requestAnimationFrame(updateVisuals);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    rafId = requestAnimationFrame(updateVisuals);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, []);

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
    if (!featuresRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setFeaturesVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(featuresRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      {/* Fixed header */}
      <header className="fixed top-0 left-0 w-full z-50 flex items-center justify-between px-5 py-4 md:px-10 md:py-5">
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
            onClick={() => {
              if (authenticated) {
                router.push("/dashboard");
              } else if (ready) {
                login();
              }
            }}
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
            if (authenticated) {
              router.push("/dashboard");
            } else if (ready) {
              login();
            }
          }}
          className="w-full text-center py-3 mt-1 bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base rounded-lg hover:bg-[#D63031] transition-colors"
        >
          Launch App
        </button>
      </div>

      {/* ═══ HERO SCROLL ZONE (200vh for scroll-lock transition) ═══ */}
      <div style={{ height: "200vh" }}>
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          {/* GLSL Hills — full-screen background */}
          <GLSLHills scrollProgressRef={scrollProgressRef} />

          {/* Hero content — fades out with scroll */}
          <div
            ref={heroRef}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center pointer-events-none px-6"
          >
            <h1 className="hero-fadein-1 font-sans font-bold text-[40px] md:text-[64px] text-[#1A1715] tracking-[-0.02em] leading-[1.1]">
              Earn more. Risk less.
            </h1>

            <p className="hero-fadein-2 font-sans font-normal text-[15px] md:text-[18px] text-[#5C5550] max-w-[520px] leading-[1.6] mt-5">
          Your agent that finds the best yield on Avalanche. Safely and
          automatically.
            </p>

            <button
              className="hero-fadein-3 pointer-events-auto bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-base px-10 py-4 rounded-[10px] mt-8 hover:bg-[#D63031] hover:scale-[1.02] transition-all duration-200 cursor-pointer"
              style={{ boxShadow: "0 4px 24px rgba(232, 65, 66, 0.3)" }}
              onClick={() => {
                if (authenticated) {
                  router.push("/dashboard");
                } else if (ready) {
                  login();
                }
              }}
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

          {/* Cream transition overlay — fades in at end of scroll */}
          <div
            ref={overlayRef}
            className="absolute inset-0 z-15 pointer-events-none bg-[#F5F0EB]"
            style={{ opacity: 0 }}
          />

          {/* Scroll indicator — mouse icon */}
          <div
            ref={scrollIndicatorRef}
            className="absolute bottom-10 left-0 right-0 z-10 flex flex-col items-center justify-center pointer-events-none scroll-indicator"
          >
            <div className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-[#8A837C] pt-1.5">
              <div className="h-2 w-1 rounded-full bg-[#8A837C] animate-scroll-dot" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ LANDING VIDEO ═══ */}
      <section className="bg-[#F5F0EB] px-6 pb-6 md:pb-10">
        <div className="mx-auto max-w-[1100px] overflow-hidden rounded-2xl border border-[#E8E2DA] bg-black">
          <video
            src="/landing-demo.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            controls={false}
            className="block h-auto w-full"
          />
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

      {/* ═══ WHY SNOW MIND ═══ */}
      <section className="bg-[#FAFAF8] py-12 md:py-20 px-6">
        <div className="max-w-[1100px] mx-auto text-center">
          <p className="font-sans font-semibold text-[13px] text-[#E84142] tracking-[0.08em] uppercase">
            WHY SNOWMIND
          </p>
          <h2 className="font-sans font-bold text-[28px] md:text-[36px] text-[#1A1715] mt-3">
            Smart yield. Uncompromising security.
          </h2>

          <div
            ref={featuresRef}
            className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-14"
          >
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className={
                    featuresVisible ? "card-visible" : "card-hidden"
                  }
                  style={{
                    animationDelay: featuresVisible
                      ? `${i * 100}ms`
                      : undefined,
                  }}
                >
                  <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left transition-all duration-200 hover:-translate-y-1">
                    <Icon className="w-7 h-7 text-[#E84142] mb-4" />
                    <h3 className="font-sans font-bold text-[18px] text-[#1A1715]">
                      {feature.title}
                    </h3>
                    <p className="font-sans font-normal text-[14px] text-[#5C5550] leading-[1.6] mt-2">
                      {feature.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-[#1A1715] py-8 md:py-12 px-6">
        <div className="max-w-[1100px] mx-auto">
          {/* Top row */}
          <div className="flex flex-col md:flex-row items-center md:items-center justify-between gap-6">
            <Image
              src="/snowmind-logo.png"
              alt="Snow Mind"
              width={100}
              height={30}
              className="h-[30px] w-auto"
            />
            <nav className="flex items-center gap-8">
              <a
                href="#how-it-works"
                className="font-sans font-medium text-sm text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
              >
                How It Works
              </a>
              <a
                href="https://x.com/mark_nakatani"
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans font-medium text-sm text-[#8A837C] hover:text-[#FAFAF8] transition-colors duration-200"
              >
                Twitter
              </a>
            </nav>
          </div>

          {/* Divider + bottom row */}
          <div
            className="mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
          >
            <span className="font-sans font-normal text-[13px] text-[#8A837C]">
              &copy; 2026 SnowMind. All rights reserved.
            </span>
            <span className="font-sans font-medium text-[13px] text-[#5C5550] italic">
              Earn more. Risk less.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
