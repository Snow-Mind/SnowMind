"use client";

import { useEffect, useRef, useState } from "react";

interface Testimonial {
  quote: string;
  name: string;
  handle: string;
  url: string;
}

const testimonials: Testimonial[] = [
  {
    quote:
      "The rebalance logs are incredible. I can see exactly why it moved my funds and verify every tx on Snowtrace. This is how DeFi agents should work.",
    name: "Beta Tester",
    handle: "@avalanche_user",
    url: "https://x.com",
  },
  {
    quote:
      "I was skeptical about letting an agent manage my USDC, but the session key scoping sold me. It literally cannot call transfer or approve. That's real security.",
    name: "Beta Tester",
    handle: "@defi_builder",
    url: "https://x.com",
  },
  {
    quote:
      "Set it up in 5 minutes, deposited, and forgot about it. Checked back a week later and my yield was better than anything I was doing manually across 3 protocols.",
    name: "Beta Tester",
    handle: "@yield_farmer",
    url: "https://x.com",
  },
];

export default function Testimonials() {
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="bg-[#FAFAF8] py-12 md:py-20 px-6">
      <div className="max-w-[1100px] mx-auto text-center">
        <p className="font-sans font-semibold text-[13px] text-[#E84142] tracking-[0.08em] uppercase">
          FROM OUR BETA TESTERS
        </p>
        <h2 className="font-sans font-bold text-[28px] md:text-[36px] text-[#1A1715] mt-3">
          Real users. Real feedback.
        </h2>

        <div ref={sectionRef} className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-14">
          {testimonials.map((t, i) => (
            <div
              key={t.handle}
              className={visible ? "card-visible" : "card-hidden"}
              style={{
                animationDelay: visible ? `${i * 120}ms` : undefined,
              }}
            >
              <div className="bg-[#F5F0EB] rounded-2xl p-7 text-left h-full flex flex-col justify-between transition-all duration-200 hover:-translate-y-1">
                <p className="font-sans font-normal text-[15px] text-[#3A3530] leading-[1.7] italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <div>
                    <p className="font-sans font-semibold text-[14px] text-[#1A1715]">
                      {t.name}
                    </p>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans font-medium text-[13px] text-[#E84142] hover:underline"
                    >
                      {t.handle}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
