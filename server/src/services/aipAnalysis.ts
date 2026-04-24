import { runAIPAnalysisStream as streamAnalysis, runAIPAnalysis as nonStreamAnalysis, type AIPResult, type AIPIntervention } from "../routes/aipService";

// Re-export from centralized service
export { runAIPAnalysis, runAIPAnalysisStream, parseFromStream, type AIPResult, type AIPIntervention } from "../routes/aipService";

export interface AIPAnalysisParams {
  country: string;
  currentIndicators: Record<string, number>;
  trajectoryClass: string;
  criticalFlags: string[];
  topAnalogues: Array<{ case: { country: string; start_year: number; end_year: number; indicators_degraded: string[]; outcome: string; outcome_score: number }; similarity: number }>;
}

export interface AIPResult {
  trajectory_narrative: string;
  primary_risk_factor: string;
  analogue_reasoning: string;
  recommended_interventions: AIPIntervention[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  analyst_action: string;
}

export interface AIPIntervention {
  type: string;
  actor: string;
  rationale: string;
  historical_success_rate: number;
}