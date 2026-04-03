/**
 * Formatting utilities for currency and percentages.
 */

interface FormatUsdOptions {
  minFractionDigits?: number;
  maxFractionDigits?: number;
}

export function formatUsd(value: number, options: FormatUsdOptions = {}): string {
  const maxFractionDigits = options.maxFractionDigits ?? 2;
  const minFractionDigits = options.minFractionDigits ?? Math.min(2, maxFractionDigits);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatPct(value: number, fractionDigits = 2): string {
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatTvl(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
