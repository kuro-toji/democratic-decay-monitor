export type IndicatorKey =
  | "judicial_independence"
  | "press_freedom"
  | "electoral_integrity"
  | "civil_society_space"
  | "executive_constraints";

export interface CountryIndicator {
  year: number;
  judicial_independence: number;
  press_freedom: number;
  electoral_integrity: number;
  civil_society_space: number;
  executive_constraints: number;
}

export interface CountryData {
  country: string;
  country_code: string;
  readings: CountryIndicator[];
}

export type InterventionType =
  | "constitutional_reform"
  | "judicial_capture"
  | "media_takeover"
  | "civil_society_restriction"
  | "executive_expansion"
  | "electoral_manipulation"
  | "coordinated_combined";

export type InterventionActor =
  | "ruling_party"
  | "executive_president"
  | "oligarchic_network"
  | "foreign_actor"
  | "military"
  | "coalition";

export type Outcome = "recovery" | "stalled" | "failure" | "consolidation";

export interface AnalogCase {
  country: string;
  start_year: number;
  end_year: number;
  indicators_degraded: IndicatorKey[];
  intervention_type: InterventionType;
  intervention_actor: InterventionActor;
  outcome: Outcome;
  outcome_score: number;
}

export interface IndicatorBaseline {
  indicator: IndicatorKey;
  global_mean: number;
  one_std_threshold: number;
}

export interface IndicatorsDataset {
  countries: CountryData[];
}

export interface AnaloguesDataset {
  cases: AnalogCase[];
}

export interface BaselinesDataset {
  baselines: IndicatorBaseline[];
}
