"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CrystalCardProps {
  children: React.ReactNode;
  className?: string;
  glowOnHover?: boolean;
  onClick?: () => void;
}

export default function CrystalCard({
  children,
  className,
  glowOnHover = true,
  onClick,
}: CrystalCardProps) {
  return (
    <motion.div
      className={cn("crystal-card p-5", className)}
      whileHover={
        glowOnHover
          ? { y: -2, boxShadow: "0 0 48px rgba(0, 196, 255, 0.08), 0 12px 40px rgba(0, 0, 0, 0.15)" }
          : undefined
      }
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </motion.div>
  );
}
