import { describe, it, expect } from "vitest";
import { tryParseJSON, parseFromStream } from "../aipAnalysis";

describe("tryParseJSON", () => {
  it("parses a well-formed JSON response", () => {
    const input = `{
      "trajectory_narrative": "Test narrative.",
      "primary_risk_factor": "press_freedom",
      "analogue_reasoning": "Analogue reasoning text.",
      "recommended_interventions": [
        {
          "type": "judicial_capture",
          "actor": "ruling_party",
          "rationale": "Works historically.",
          "historical_success_rate": 0.62
        }
      ],
      "confidence": "MEDIUM",
      "analyst_action": "Flag for escalation."
    }`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe("Test narrative.");
    expect(result!.confidence).toBe("MEDIUM");
    expect(result!.recommended_interventions).toHaveLength(1);
    expect(result!.recommended_interventions[0].historical_success_rate).toBe(0.62);
  });

  it("strips markdown fences", () => {
    const input = `\`\`\`json
{
  "trajectory_narrative": "From fenced response.",
  "primary_risk_factor": "judicial_independence",
  "analogue_reasoning": "Reasoning.",
  "recommended_interventions": [],
  "confidence": "HIGH",
  "analyst_action": "Act now."
}
\`\`\``;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe("From fenced response.");
  });

  it("handles truncation — finds JSON between first { and last }", () => {
    const input = `Some text before {
  "trajectory_narrative": "Partially cut",
  "primary_risk_factor": "press_freedom",
  "analogue_reasoning": "Reasoning.",
  "recommended_interventions": [],
  "confidence": "LOW"
} and some text after it`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe("Partially cut");
    expect(result!.confidence).toBe("LOW");
  });

  it("falls back to field-by-field recovery for deeply truncated JSON", () => {
    const input = `{"trajectory_narrative": "Recovered narrative", "primary_risk_factor": "press_freedom", "analogue_reasoning": "Reasoning text here", "recommended_interventions": [{"type": "media_takeover", "actor": "ruling_party", "rationale": "Works historically.", "historical_success_rate": 0.55}], "confidence": "HIGH", "analyst_action": "Act."`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe("Recovered narrative");
  });

  it("returns null for completely invalid input", () => {
    const result = tryParseJSON("not json at all");
    expect(result).toBeNull();
  });

  it("normalises confidence to valid values", () => {
    const input = `{"trajectory_narrative": "N", "primary_risk_factor": "R", "analogue_reasoning": "A", "recommended_interventions": [], "confidence": "INVALID", "analyst_action": "A"}`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("MEDIUM"); // fallback
  });

  it("handles embedded quotes in string values", () => {
    const input = `{"trajectory_narrative": "He said \\"this is bad\\" and left.", "primary_risk_factor": "press_freedom", "analogue_reasoning": "N/A", "recommended_interventions": [], "confidence": "MEDIUM", "analyst_action": "Flag."}`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe('He said "this is bad" and left.');
  });

  it("handles numbers in narrative strings", () => {
    const input = `{"trajectory_narrative": "Values dropped from 0.82 to 0.34 in 3 years.", "primary_risk_factor": "press_freedom", "analogue_reasoning": "N/A", "recommended_interventions": [], "confidence": "HIGH", "analyst_action": "Monitor."}`;
    const result = tryParseJSON(input);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toContain("0.82");
  });
});

describe("parseFromStream", () => {
  it("parses streaming output via parseFromStream", () => {
    const full = `{"trajectory_narrative": "Streamed result.","primary_risk_factor":"press_freedom","analogue_reasoning":"A","recommended_interventions":[],"confidence":"HIGH","analyst_action":"Monitor."}`;
    const result = parseFromStream(full);
    expect(result).not.toBeNull();
    expect(result!.trajectory_narrative).toBe("Streamed result.");
    expect(result!.confidence).toBe("HIGH");
  });

  it("returns null for empty string", () => {
    expect(parseFromStream("")).toBeNull();
  });
});
