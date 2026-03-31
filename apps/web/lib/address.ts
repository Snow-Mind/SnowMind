const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidEvmAddress(value: string | null | undefined): value is `0x${string}` {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized === "undefined" || normalized === "null") return false;
  return EVM_ADDRESS_REGEX.test(normalized);
}

export function normalizeEvmAddress(value: string | null | undefined): string | null {
  if (!isValidEvmAddress(value)) return null;
  return value;
}
