export interface RebalanceCadence {
  intervalHours: number;
  intervalMs: number;
  label: string;
}

function normalizeDepositUsd(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

export function getRebalanceIntervalHours(totalDepositedUsd: number): number {
  const depositUsd = normalizeDepositUsd(totalDepositedUsd);

  if (depositUsd <= 100) return 24;
  if (depositUsd <= 1000) return 12;
  if (depositUsd <= 10000) return 8;
  return 6;
}

export function getRebalanceCadence(totalDepositedUsd: number): RebalanceCadence {
  const intervalHours = getRebalanceIntervalHours(totalDepositedUsd);
  return {
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    label: `${intervalHours}h`,
  };
}