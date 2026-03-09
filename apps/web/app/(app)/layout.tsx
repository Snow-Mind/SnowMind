"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  PieChart,
  Settings,
  LogOut,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NeuralSnowflakeLogo } from "@/components/snow/NeuralSnowflake";
import { useAuth } from "@/hooks/useAuth";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import ConnectButton from "@/components/wallet/ConnectButton";
import SmartAccountSetup from "@/components/wallet/SmartAccountSetup";

const NAV_ITEMS = [
  { href: "/onboarding", label: "Activate", icon: Sparkles },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function Sidebar({ onLogout, hasAccount }: { onLogout: () => void; hasAccount: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-[#E8E2DA] bg-[#FAFAF8]/95 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-[#E8E2DA] px-5">
        <NeuralSnowflakeLogo className="h-5 w-5" />
        <span className="font-display text-sm font-semibold text-[#E84142]">
          SnowMind
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.filter((item) => {
            // Show "Activate" only for users without an account; show all other tabs once account exists
            if (item.href === "/onboarding") return !hasAccount;
            return true;
          }).map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
                    isActive
                      ? "bg-[#E84142]/[0.08] text-[#E84142]"
                      : "text-[#5C5550] hover:bg-[#EDE8E3] hover:text-[#1A1715]"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom links */}
      <div className="border-t border-[#E8E2DA] px-3 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#5C5550] transition-colors hover:text-[#1A1715]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Back to Site
        </Link>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#5C5550] transition-colors hover:text-[#DC2626]"
        >
          <LogOut className="h-3.5 w-3.5" />
          Disconnect
        </button>
      </div>
    </aside>
  );
}

function TopBar({
  authenticated,
  isLoading,
  eoaAddress,
  smartAccountAddress,
  hasSmartAccount,
  onLogin,
  onLogout,
}: {
  authenticated: boolean;
  isLoading: boolean;
  eoaAddress: string | null;
  smartAccountAddress: string | null;
  hasSmartAccount: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#E8E2DA] bg-[#F5F0EB]/80 px-6 backdrop-blur-xl">
      <div />
      <div className="flex items-center gap-3">
        <ConnectButton
          authenticated={authenticated}
          isLoading={isLoading}
          eoaAddress={eoaAddress}
          smartAccountAddress={smartAccountAddress}
          hasSmartAccount={hasSmartAccount}
          onLogin={onLogin}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, ready, login, logout, activeWallet, eoaAddress, isLoading: authLoading } = useAuth();
  const smartAccount = useSmartAccount(activeWallet);
  const [setupOpen, setSetupOpen] = useState(false);

  const hasAccount = smartAccount.hasAccount;

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/");
    }
  }, [ready, authenticated, router]);

  // Only redirect FRESH users (no stored smart account) to onboarding
  // Once they've been to onboarding, let them navigate freely
  useEffect(() => {
    if (
      smartAccount.setupStep === "creating" &&
      !smartAccount.address &&
      pathname !== "/onboarding"
    ) {
      // Account is being created for first time — go to onboarding
      router.replace("/onboarding");
    }
  }, [smartAccount.setupStep, smartAccount.address, pathname, router]);

  // Show setup wizard when smart account is being created
  const shouldOpenSetup = authenticated && smartAccount.setupStep === "creating";
  const shouldAutoClose = smartAccount.setupStep === "ready";
  const [prevShouldOpen, setPrevShouldOpen] = useState(false);
  if (shouldOpenSetup !== prevShouldOpen) {
    setPrevShouldOpen(shouldOpenSetup);
    if (shouldOpenSetup) {
      setSetupOpen(true);
    }
  }
  useEffect(() => {
    if (shouldAutoClose) {
      // Auto-close after a short delay to let user see the success
      const timer = setTimeout(() => setSetupOpen(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [shouldAutoClose]);

  // Don't render until auth is ready
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F0EB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E84142] border-t-transparent" />
      </div>
    );
  }

  if (!authenticated) return null;

  return (
    <div className="app-light min-h-screen bg-[#F5F0EB] text-[#1A1715]">
      <Sidebar onLogout={logout} hasAccount={hasAccount} />
      <div className="flex min-h-screen flex-1 flex-col pl-56">
        <TopBar
          authenticated={authenticated}
          isLoading={authLoading}
          eoaAddress={eoaAddress}
          smartAccountAddress={smartAccount.address}
          hasSmartAccount={smartAccount.hasAccount}
          onLogin={login}
          onLogout={logout}
        />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>

      <SmartAccountSetup
        open={setupOpen}
        onOpenChange={setSetupOpen}
        step={smartAccount.setupStep}
        address={smartAccount.address}
        error={smartAccount.error}
        onRetry={smartAccount.retry}
        txHashes={smartAccount.txHashes}
      />
    </div>
  );
}
