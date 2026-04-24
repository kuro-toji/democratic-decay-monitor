import type {
  CountryIndicator,
  IndicatorKey,
  IndicatorBaseline,
  AnalogCase,
} from "../data/types";

export type TrajectoryStatus = "STABLE" | "STRESS" | "DEGRADING";

export interface IndicatorFlag {
  indicator: IndicatorKey;
  status: "CRITICAL" | "WARNING" | "OK";
  current_value: number;
  threshold: number;
}

export interface TrajectoryResult {
  status: TrajectoryStatus;
  flags: IndicatorFlag[];
  summary: string;
}

export interface Analogue {
  case: AnalogCase;
  similarity: number;
}

export const INDICATOR_KEYS: IndicatorKey[] = [
  "judicial_independence",
  "press_freedom",
  "electoral_integrity",
  "civil_society_space",
  "executive_constraints",
];

export function computeDegradationVector(
  readings: CountryIndicator[]
): number[] {
  const n = readings.length;
  if (n < 4) {
    return INDICATOR_KEYS.map(() => 0);
  }

  const recentCount = Math.min(3, Math.floor(n / 3));
  const recentStart = n - recentCount;
  const priorStart = Math.max(0, recentStart - 5);
  const priorCount = recentStart - priorStart;

  if (priorCount < 2) {
    return INDICATOR_KEYS.map(() => 0);
  }

  const recentSlice = readings.slice(recentStart, n);
  const priorSlice = readings.slice(priorStart, recentStart);

  const recentAvg = INDICATOR_KEYS.map((key) => {
    const sum = recentSlice.reduce((acc, r) => acc + r[key], 0);
    return sum / recentSlice.length;
  });

  const priorAvg = INDICATOR_KEYS.map((key) => {
    const sum = priorSlice.reduce((acc, r) => acc + r[key], 0);
    return sum / priorSlice.length;
  });

  return INDICATOR_KEYS.map((_, i) => {
    const prior = priorAvg[i];
    if (prior === 0) return 0;
    const rate = (prior - recentAvg[i]) / prior;
    return Math.max(0, Math.min(1, rate));
  });
}

export function classifyTrajectory(
  readings: CountryIndicator[],
  baselines: IndicatorBaseline[]
): TrajectoryResult {
  const n = readings.length;
  if (n < 4) {
    return { status: "STABLE", flags: [], summary: "INSUFFICIENT_DATA" };
  }

  const recentCount = Math.min(3, Math.floor(n / 3));
  const recentStart = n - recentCount;
  const priorStart = Math.max(0, recentStart - 5);
  const priorCount = recentStart - priorStart;

  if (priorCount < 2) {
    return { status: "STABLE", flags: [], summary: "INSUFFICIENT_PRIOR_DATA" };
  }

  const recentSlice = readings.slice(recentStart, n);
  const priorSlice = readings.slice(priorStart, recentStart);

  const priorAvg = INDICATOR_KEYS.map((key) => {
    const sum = priorSlice.reduce((acc, r) => acc + r[key], 0);
    return sum / priorSlice.length;
  });

  let declining = 0;
  const flags: IndicatorFlag[] = [];
  const lastReading = recentSlice[recentSlice.length - 1];

  for (let i = 0; i < INDICATOR_KEYS.length; i++) {
    const key = INDICATOR_KEYS[i];
    const prior = priorAvg[i];
    const current = lastReading[key];
    const baseline = baselines.find((b) => b.indicator === key);

    const declinePct = prior > 0 ? (prior - current) / prior : 0;

    if (declinePct > 0.15) declining++;

    if (baseline) {
      let status: IndicatorFlag["status"] = "OK";
      if (current < baseline.one_std_threshold) {
        status = "CRITICAL";
      } else if (current < baseline.global_mean * 0.9) {
        status = "WARNING";
      }
      flags.push({
        indicator: key,
        status,
        current_value: Number(current.toFixed(3)),
        threshold: baseline.one_std_threshold,
      });
    }
  }

  let status: TrajectoryStatus;
  if (declining >= 3) {
    status = "DEGRADING";
  } else if (declining >= 1) {
    status = "STRESS";
  } else {
    status = "STABLE";
  }

  const criticalCount = flags.filter((f) => f.status === "CRITICAL").length;

  return {
    status,
    flags,
    summary: `${status}${criticalCount > 0 ? ` [${criticalCount} CRITICAL]` : ""}`,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function buildDegradationVectorFromCase(caseData: AnalogCase): number[] {
  return INDICATOR_KEYS.map((key) =>
    caseData.indicators_degraded.includes(key) ? 1 : 0
  );
}

export function findAnalogues(
  currentVector: number[],
  cases: AnalogCase[],
  topN = 3
): Analogue[] {
  const scored = cases.map((c) => ({
    case: c,
    similarity: cosineSimilarity(currentVector, buildDegradationVectorFromCase(c)),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}