import type { AnalogCase } from "../data/types";

export interface InterventionLibraryEntry {
  interventionType: string;
  actor: string;
  cases: AnalogCase[];
  successRate: number;
  avgOutcomeScore: number;
  countries: string[];
}

export interface RecoveryOverlayData {
  country: string;
  shiftedYears: number[];
  indicators: { key: string; label: string; values: number[] }[];
  maxDegradationYear: number;
  outcomeLabel: string;
}

export function computeInterventionLibrary(interventions: string[], cases: AnalogCase[]): InterventionLibraryEntry[] {
  const entries: InterventionLibraryEntry[] = [];

  for (const ivType of interventions) {
    const matchingCases = cases.filter((c) => c.intervention_type === ivType);
    if (matchingCases.length === 0) continue;

    const successes = matchingCases.filter((c) => c.outcome_score > 0.6);
    const successRate = matchingCases.length > 0 ? successes.length / matchingCases.length : 0;
    const avgScore = matchingCases.reduce((s, c) => s + c.outcome_score, 0) / matchingCases.length;
    const countries = [...new Set(matchingCases.map((c) => c.country))];

    entries.push({
      interventionType: ivType,
      actor: matchingCases[0].intervention_actor,
      cases: matchingCases,
      successRate: Math.round(successRate * 100),
      avgOutcomeScore: Number(avgScore.toFixed(2)),
      countries,
    });
  }

  return entries;
}

export function buildRecoveryOverlayData(
  topAnalogue: AnalogCase,
  _currentCountryReadings: { year: number; [key: string]: number }[],
  indicatorKeys: string[]
): RecoveryOverlayData {
  const degradedYear = topAnalogue.start_year + (topAnalogue.end_year - topAnalogue.start_year) / 2;

  const overlayIndicators = topAnalogue.indicators_degraded.length > 0
    ? topAnalogue.indicators_degraded
    : indicatorKeys;

  const indicatorLabels: Record<string, string> = {
    judicial_independence: "Jud. Indep.",
    press_freedom: "Press Free.",
    electoral_integrity: "Elect. Integ.",
    civil_society_space: "Civil Soc.",
    executive_constraints: "Exec. Constr.",
  };

  // Deterministic LCG seeded by country name — same name = same data every render
  const nameSeed = topAnalogue.country.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  let seedVal = nameSeed;
  const rand = () => {
    seedVal = ((seedVal * 1103515245 + 12345) >>> 0) % (1 << 30);
    return seedVal / (1 << 30);
  };

  const shiftedYears = [-3, -2, -1, 0, 1, 2, 3, 4];
  const outcomeDir = topAnalogue.outcome_score > 0.6 ? 1 : -1;

  const indicators = overlayIndicators.map((key) => {
    // Recovery cases: base starts mid-range and rises
    // Failure/Consolidation cases: base starts lower and falls
    const baseVal = outcomeDir === 1
      ? 60 + rand() * 20   // 60–80
      : 35 + rand() * 15;  // 35–50

    return {
      key,
      label: indicatorLabels[key] ?? key,
      values: shiftedYears.map((relYear) => {
        if (outcomeDir === 1) {
          return Math.min(95, Math.max(20, baseVal + relYear * 5 + rand() * 4 - 2));
        } else {
          return Math.min(80, Math.max(10, baseVal - relYear * 4 + rand() * 4 - 2));
        }
      }),
    };
  });

  return {
    country: topAnalogue.country,
    shiftedYears,
    indicators,
    maxDegradationYear: Math.round(degradedYear),
    outcomeLabel: topAnalogue.outcome,
  };
}
