/**
 * Formatting utilities for currency and percentages.
 */

interface FormatUsdOptions {
  minFractionDigits?: number;
  maxFractionDigits?: number;
}

interface FormatUsdExactOptions {
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

/**
 * Format USD while preserving meaningful precision for tiny non-zero values.
 * Useful for "net earned" so small balances still show real accrual.
 */
export function formatUsdExact(value: number, options: FormatUsdExactOptions = {}): string {
  const abs = Math.abs(value);
  const maxFractionDigits = options.maxFractionDigits ?? 12;

  if (abs > 0 && abs < 0.01) {
    const suggested = Math.ceil(-Math.log10(abs)) + 2;
    const decimals = Math.max(2, Math.min(maxFractionDigits, suggested));

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  return formatUsd(value, { maxFractionDigits: Math.min(6, maxFractionDigits) });
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
