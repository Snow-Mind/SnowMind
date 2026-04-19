export type RiskBand = "Low" | "Medium" | "High";

const NINE_POINT_MIN = 0;
const NINE_POINT_MAX = 9;

function normalizeNinePointScore(rawScore: number, fallback: number): number {
  const parsedScore = Number.isFinite(rawScore) ? rawScore : fallback;
  return Math.min(NINE_POINT_MAX, Math.max(NINE_POINT_MIN, Math.round(parsedScore)));
}

export function toNinePointRiskScore(
  rawScore: number,
  rawScoreMax: number | undefined,
  fallbackScore = NINE_POINT_MIN,
): number {
  const fallback = normalizeNinePointScore(fallbackScore, NINE_POINT_MIN);
  const parsedScore = Number.isFinite(rawScore) ? rawScore : fallback;
  const parsedScoreMax = Number.isFinite(rawScoreMax) && Number(rawScoreMax) > 0
    ? Number(rawScoreMax)
    : NINE_POINT_MAX;

  if (parsedScoreMax === NINE_POINT_MAX) {
    return normalizeNinePointScore(parsedScore, fallback);
  }

  const scaled = (Math.max(NINE_POINT_MIN, parsedScore) / parsedScoreMax) * NINE_POINT_MAX;
  return normalizeNinePointScore(scaled, fallback);
}

export function riskBandFromScore(rawScore: number): RiskBand {
  const score = normalizeNinePointScore(rawScore, NINE_POINT_MIN);
  if (score >= 6) {
    return "Low";
  }
  if (score >= 3) {
    return "Medium";
  }
  return "High";
}

export function riskBandClassName(band: RiskBand): string {
  if (band === "Low") {
    return "bg-[#059669]/10 text-[#059669]";
  }
  if (band === "Medium") {
    return "bg-[#D97706]/10 text-[#D97706]";
  }
  return "bg-[#DC2626]/10 text-[#DC2626]";
}

export function riskBandLabel(band: RiskBand): string {
  return `${band} Risk`;
}

export const RISK_BAND_TOOLTIP =
  "Risk band from 9-point score (Low Risk: 6-9, Medium Risk: 3-5, High Risk: 0-2).";
