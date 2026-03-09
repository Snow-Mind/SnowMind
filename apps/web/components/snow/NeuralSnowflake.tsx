"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface NeuralSnowflakeProps {
  protocols?: number;
  allocations?: number[];
  className?: string;
}

const ARM_COUNT = 6;
const CENTER = 100;
const MAX_ARM_LENGTH = 70;

function normalize(allocs: number[] | undefined): number[] {
  if (!allocs || allocs.length === 0) return Array(ARM_COUNT).fill(1);
  const max = Math.max(...allocs, 1);
  const padded = [...allocs];
  while (padded.length < ARM_COUNT) padded.push(0);
  return padded.slice(0, ARM_COUNT).map((a) => Math.max(0.3, a / max));
}

export default function NeuralSnowflake({
  allocations,
  className,
}: NeuralSnowflakeProps) {
  const scales = normalize(allocations);
  const armAngle = 360 / ARM_COUNT;

  return (
    <svg
      viewBox="0 0 200 200"
      className={cn("animate-[spin_30s_linear_infinite]", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Center ring */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={6}
        fill="none"
        stroke="#00C4FF"
        strokeWidth={1.5}
        className="animate-crystal-pulse"
        style={{ transformOrigin: "100px 100px" }}
      />
      <circle cx={CENTER} cy={CENTER} r={3} fill="#00C4FF" opacity={0.6} />

      {/* Six arms with branches */}
      {scales.map((scale, i) => {
        const angle = ((armAngle * i - 90) * Math.PI) / 180;
        const len = MAX_ARM_LENGTH * scale;
        const endX = CENTER + Math.cos(angle) * len;
        const endY = CENTER + Math.sin(angle) * len;

        const branches = [0.4, 0.7].map((t) => {
          const bx = CENTER + Math.cos(angle) * len * t;
          const by = CENTER + Math.sin(angle) * len * t;
          const bLen = len * 0.25;
          const lA = angle - Math.PI / 4;
          const rA = angle + Math.PI / 4;
          return {
            x: bx,
            y: by,
            lx: bx + Math.cos(lA) * bLen,
            ly: by + Math.sin(lA) * bLen,
            rx: bx + Math.cos(rA) * bLen,
            ry: by + Math.sin(rA) * bLen,
          };
        });

        return (
          <g key={i} opacity={0.6 + scale * 0.4}>
            {/* Main arm */}
            <line
              x1={CENTER}
              y1={CENTER}
              x2={endX}
              y2={endY}
              stroke="#00C4FF"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {/* Branch pairs */}
            {branches.map((b, j) => (
              <g key={j}>
                <line
                  x1={b.x}
                  y1={b.y}
                  x2={b.lx}
                  y2={b.ly}
                  stroke="#00C4FF"
                  strokeWidth={1}
                  strokeLinecap="round"
                  opacity={0.7}
                />
                <line
                  x1={b.x}
                  y1={b.y}
                  x2={b.rx}
                  y2={b.ry}
                  stroke="#00C4FF"
                  strokeWidth={1}
                  strokeLinecap="round"
                  opacity={0.7}
                />
              </g>
            ))}
            {/* Tip dot */}
            <circle cx={endX} cy={endY} r={2} fill="#00C4FF" opacity={0.8} />
          </g>
        );
      })}
    </svg>
  );
}

/** Lightweight static snowflake logo for navbars/footers */
export function NeuralSnowflakeLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/snowmind-logo.png"
      alt="SnowMind"
      width={20}
      height={20}
      className={cn(className)}
      unoptimized
    />
  );
}
