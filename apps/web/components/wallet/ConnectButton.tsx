"use client";

import { Copy, ExternalLink, LogOut, Loader2, ChevronDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPLORER } from "@/lib/constants";
import { toast } from "sonner";

interface ConnectButtonProps {
  authenticated: boolean;
  isLoading: boolean;
  eoaAddress: string | null;
  smartAccountAddress: string | null;
  hasSmartAccount: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export default function ConnectButton({
  authenticated,
  isLoading,
  eoaAddress,
  smartAccountAddress,
  hasSmartAccount,
  onLogin,
  onLogout,
}: ConnectButtonProps) {
  // Not authenticated
  if (!authenticated) {
    return (
      <Button
        onClick={onLogin}
        disabled={isLoading}
        className="bg-gradient-to-r from-glacier to-frost text-white hover:opacity-90"
        size="sm"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wallet className="h-4 w-4" />
        )}
        {isLoading ? "Connecting..." : "Connect"}
      </Button>
    );
  }

  // Authenticated but smart account creating
  if (!hasSmartAccount) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-void-2/50 px-3 py-1.5">
        <Loader2 className="h-3 w-3 animate-spin text-glacier" />
        <span className="text-xs text-muted-foreground">Setting up...</span>
      </div>
    );
  }

  const displayAddress = smartAccountAddress ?? eoaAddress;
  const truncated = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : "Connected";

  const copyAddress = () => {
    if (displayAddress) {
      navigator.clipboard.writeText(displayAddress);
      toast.success("Address copied");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-border/50 bg-void-2/50 px-3 py-1.5 transition-colors hover:border-glacier/30">
          <span className="inline-block h-2 w-2 rounded-full bg-mint" />
          <span className="font-mono text-xs text-muted-foreground">
            {truncated}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-border-frost bg-void-2/95 backdrop-blur-xl">
        {smartAccountAddress && (
          <>
            <div className="px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Smart Account</p>
              <a
                href={EXPLORER.address(smartAccountAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-xs text-glacier hover:underline"
              >
                {smartAccountAddress.slice(0, 10)}...{smartAccountAddress.slice(-6)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
              <p className="text-[10px] text-muted-foreground">View on Snowtrace ↗</p>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={copyAddress}>
          <Copy className="h-4 w-4" />
          Copy Address
        </DropdownMenuItem>
        {displayAddress && (
          <DropdownMenuItem asChild>
            <a
              href={EXPLORER.address(displayAddress)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              View on Explorer
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} variant="destructive">
          <LogOut className="h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
