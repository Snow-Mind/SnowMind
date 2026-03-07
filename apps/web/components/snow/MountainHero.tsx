"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const GenerativeMountainScene = dynamic(
  () => import("@/components/ui/mountain-scene"),
  { ssr: false }
);

export default function MountainHero() {
  return (
    <Suspense fallback={<div className="absolute inset-0 w-full h-full bg-[#0f172a]" />}>
      <GenerativeMountainScene />
    </Suspense>
  );
}
