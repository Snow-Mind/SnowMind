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

  if (depositUsd <= 3000) return 12;
  if (depositUsd <= 10000) return 4;
  if (depositUsd <= 100000) return 2;
  return 1;
}

export function getRebalanceCadence(totalDepositedUsd: number): RebalanceCadence {
  const intervalHours = getRebalanceIntervalHours(totalDepositedUsd);
  return {
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    label: `${intervalHours}h`,
  };
}

export function getRebalancePollingIntervalMs(totalDepositedUsd: number): number {
  const intervalHours = getRebalanceIntervalHours(totalDepositedUsd);

  if (intervalHours >= 12) return 15 * 60 * 1000;
  if (intervalHours >= 4) return 5 * 60 * 1000;
  if (intervalHours >= 2) return 2 * 60 * 1000;
  return 60 * 1000;
}