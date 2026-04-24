import { describe, it, expect } from "vitest";
import {
  computeDegradationVector,
  classifyTrajectory,
  findAnalogues,
} from "../trajectoryEngine";
import type { CountryIndicator, IndicatorBaseline, AnalogCase } from "../../data/types";

const baselines: IndicatorBaseline[] = [
  { indicator: "judicial_independence", global_mean: 0.72, one_std_threshold: 0.58 },
  { indicator: "press_freedom", global_mean: 0.75, one_std_threshold: 0.62 },
  { indicator: "electoral_integrity", global_mean: 0.78, one_std_threshold: 0.65 },
  { indicator: "civil_society_space", global_mean: 0.80, one_std_threshold: 0.68 },
  { indicator: "executive_constraints", global_mean: 0.74, one_std_threshold: 0.60 },
];

const makeReadings = (vals: number[][]): CountryIndicator[] =>
  vals.map((v, i) => ({
    year: 2010 + i,
    judicial_independence: v[0],
    press_freedom: v[1],
    electoral_integrity: v[2],
    civil_society_space: v[3],
    executive_constraints: v[4],
  }));

describe("computeDegradationVector", () => {
  it("returns zeros for insufficient data", () => {
    const result = computeDegradationVector(makeReadings([[0.8, 0.8, 0.8, 0.8, 0.8]]));
    expect(result).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns zeros for stable readings (no decline)", () => {
    const stable = Array.from({ length: 12 }, (_, i) => [
      0.80 + (i % 2) * 0.01,
      0.82 + (i % 2) * 0.01,
      0.85 + (i % 2) * 0.01,
      0.88 + (i % 2) * 0.01,
      0.80 + (i % 2) * 0.01,
    ]);
    const result = computeDegradationVector(makeReadings(stable));
    expect(result.every((v) => v < 0.05)).toBe(true);
  });

  it("returns high values for steep recent decline", () => {
    const declining = [
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.79, 0.79, 0.84, 0.87, 0.79],
      [0.70, 0.70, 0.75, 0.80, 0.70],
      [0.50, 0.50, 0.60, 0.65, 0.50],
    ];
    const result = computeDegradationVector(makeReadings(declining));
    expect(result[0]).toBeGreaterThan(0.15);
  });
});

describe("classifyTrajectory", () => {
  it("returns STABLE for steady readings", () => {
    const readings = Array.from({ length: 12 }, (_, i) => [
      0.80 + (i % 3) * 0.01,
      0.82 + (i % 3) * 0.01,
      0.85 + (i % 3) * 0.01,
      0.88 + (i % 3) * 0.01,
      0.80 + (i % 3) * 0.01,
    ]);
    const result = classifyTrajectory(makeReadings(readings), baselines);
    expect(result.status).toBe("STABLE");
  });

  it("returns DEGRADING when 3+ indicators decline >15%", () => {
    const readings = [
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.80, 0.80, 0.85, 0.88, 0.80],
      [0.79, 0.79, 0.84, 0.87, 0.79],
      [0.70, 0.70, 0.75, 0.80, 0.70],
      [0.50, 0.50, 0.60, 0.65, 0.50],
    ];
    const result = classifyTrajectory(makeReadings(readings), baselines);
    expect(result.status).toBe("DEGRADING");
  });

  it("returns STRESS when 1-2 indicators decline >15%", () => {
    const readings: number[][] = [];
    for (let i = 0; i < 15; i++) {
      readings.push([0.80, 0.82, 0.85, 0.88, 0.80]);
    }
    readings[14] = [0.55, 0.82, 0.85, 0.88, 0.80];
    const result = classifyTrajectory(makeReadings(readings), baselines);
    expect(result.status).toBe("STRESS");
  });

  it("flags CRITICAL when indicator drops below threshold", () => {
    const readings: number[][] = [];
    for (let i = 0; i < 15; i++) {
      readings.push([0.80, 0.82, 0.85, 0.88, 0.80]);
    }
    readings[14] = [0.45, 0.82, 0.85, 0.88, 0.80];
    const result = classifyTrajectory(makeReadings(readings), baselines);
    const judicialFlag = result.flags.find((f) => f.indicator === "judicial_independence");
    expect(judicialFlag?.status).toBe("CRITICAL");
  });
});

describe("findAnalogues", () => {
  const cases: AnalogCase[] = [
    {
      country: "Venezuela",
      start_year: 2002,
      end_year: 2008,
      indicators_degraded: ["judicial_independence", "press_freedom", "electoral_integrity"],
      intervention_type: "coordinated_combined",
      intervention_actor: "executive_president",
      outcome: "failure",
      outcome_score: 0.22,
    },
    {
      country: "Hungary",
      start_year: 2010,
      end_year: 2015,
      indicators_degraded: ["press_freedom", "executive_constraints"],
      intervention_type: "media_takeover",
      intervention_actor: "ruling_party",
      outcome: "failure",
      outcome_score: 0.28,
    },
    {
      country: "Kenya",
      start_year: 2010,
      end_year: 2013,
      indicators_degraded: ["electoral_integrity", "civil_society_space"],
      intervention_type: "electoral_manipulation",
      intervention_actor: "ruling_party",
      outcome: "recovery",
      outcome_score: 0.78,
    },
    {
      country: "Poland",
      start_year: 2015,
      end_year: 2019,
      indicators_degraded: ["judicial_independence", "press_freedom", "executive_constraints"],
      intervention_type: "judicial_capture",
      intervention_actor: "ruling_party",
      outcome: "stalled",
      outcome_score: 0.45,
    },
  ];

  it("returns top 3 matches sorted by similarity", () => {
    const vector = [0.5, 0.8, 0.3, 0.2, 0.6];
    const results = findAnalogues(vector, cases);
    expect(results.length).toBe(3);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThanOrEqual(results[2].similarity);
  });

  it("returns empty array for empty cases", () => {
    const vector = [0.5, 0.8, 0.3, 0.2, 0.6];
    const results = findAnalogues(vector, []);
    expect(results).toEqual([]);
  });

  it("returns Venezuela first for judicial+press heavy vector", () => {
    const vector = [1, 1, 1, 0, 0];
    const results = findAnalogues(vector, cases);
    expect(results[0].case.country).toBe("Venezuela");
  });

  it("returns Hungary first for press+exec heavy vector", () => {
    const vector = [0, 1, 0, 0, 1];
    const results = findAnalogues(vector, cases);
    expect(results[0].case.country).toBe("Hungary");
  });
});