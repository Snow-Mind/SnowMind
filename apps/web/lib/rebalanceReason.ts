function formatCadenceWindow(rawReason: string): string | null {
  const match = rawReason.match(/min_gap=([^,)]+)/i);
  if (!match) return null;

  const rawWindow = match[1].trim();
  const duration = rawWindow.match(/^(?:(\d+)\s+day[s]?,\s*)?(\d+):(\d{2}):(\d{2})$/i);
  if (!duration) return null;

  const days = Number(duration[1] ?? "0");
  const hours = Number(duration[2] ?? "0");
  const minutes = Number(duration[3] ?? "0");
  const seconds = Number(duration[4] ?? "0");

  const totalHours = days * 24 + hours;
  if (minutes === 0 && seconds === 0) {
    return `${totalHours}h`;
  }

  return `${totalHours}h ${minutes}m`;
}

export function humanizeRebalanceReason(rawReason: string | null | undefined): string {
  const reason = (rawReason ?? "").trim();
  if (!reason) return "";

  const lower = reason.toLowerCase();

  if (lower.includes("profitability gate") || lower.includes("projected short-term improvement is too small")) {
    return "No rebalance this cycle: expected short-term benefit was small.";
  }

  if (lower.includes("apy improvement below beat margin")) {
    return "No rebalance this cycle: rate difference between markets was too small.";
  }

  if (lower.includes("last rebalance too recent")) {
    const cadenceWindow = formatCadenceWindow(reason);
    if (cadenceWindow) {
      return `No rebalance this cycle: waiting for the ${cadenceWindow} cadence window for this deposit tier.`;
    }
    return "No rebalance this cycle: recently rebalanced, waiting for the configured cadence window.";
  }

  if (lower.includes("total movement below")) {
    return "No rebalance this cycle: required movement was too small.";
  }

  return reason;
}
