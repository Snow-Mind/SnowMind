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
    return "No rebalance this cycle: recently rebalanced, waiting for the next window.";
  }

  if (lower.includes("total movement below")) {
    return "No rebalance this cycle: required movement was too small.";
  }

  return reason;
}
