"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  driftSpeed: number;
  driftAmplitude: number;
  opacity: number;
  blur: number;
  color: string;
}

const PARTICLE_COUNT = 160;
const COLORS = [
  "255,255,255",       // pure white
  "220,240,255",       // ice white
  "180,225,255",       // faint blue
  "0,196,255",         // glacier
];

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    // Depth layer: 0 = far background (small, blurry), 1 = mid, 2 = foreground (large, sharp)
    const layer = Math.random();
    const isFar = layer < 0.4;
    const isMid = layer < 0.75;

    const size = isFar
      ? Math.random() * 1.5 + 0.5
      : isMid
        ? Math.random() * 2.5 + 1.5
        : Math.random() * 4 + 3;

    const blur = isFar ? Math.random() * 3 + 2 : isMid ? Math.random() * 1 : 0;
    const speed = isFar
      ? Math.random() * 0.3 + 0.1
      : isMid
        ? Math.random() * 0.6 + 0.3
        : Math.random() * 1.0 + 0.5;

    const opacity = isFar
      ? Math.random() * 0.2 + 0.1
      : isMid
        ? Math.random() * 0.35 + 0.15
        : Math.random() * 0.5 + 0.3;

    return {
      x: Math.random() * width,
      y: Math.random() * height,
      size,
      speed,
      drift: Math.random() * Math.PI * 2,
      driftSpeed: Math.random() * 0.008 + 0.003,
      driftAmplitude: Math.random() * 1.5 + 0.5,
      opacity,
      blur,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
}

export default function SnowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let particles = createParticles(width, height);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    if (prefersReducedMotion) {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.opacity * 0.3})`;
        ctx.fill();
      }
      return () => window.removeEventListener("resize", onResize);
    }

    let raf: number;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        // Fall downward
        p.y += p.speed;
        p.drift += p.driftSpeed;
        p.x += Math.sin(p.drift) * p.driftAmplitude;

        // Wrap: bottom → top
        if (p.y > height + 20) {
          p.y = -20;
          p.x = Math.random() * width;
        }
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;

        ctx.save();
        ctx.globalAlpha = p.opacity;

        if (p.blur > 0) {
          ctx.shadowBlur = p.blur + p.size * 2;
          ctx.shadowColor = `rgba(${p.color}, 0.5)`;
        } else {
          ctx.shadowBlur = p.size * 3;
          ctx.shadowColor = `rgba(${p.color}, 0.4)`;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, 1)`;
        ctx.fill();
        ctx.restore();
      }

      raf = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
