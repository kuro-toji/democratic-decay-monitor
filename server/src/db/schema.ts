import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ============================================================================
// Country & Indicators
// ============================================================================

/**
 * Countries table - stores country metadata and latest V-Dem indicators.
 * Used as the primary entity for democratic health tracking.
 */
export const countries = sqliteTable("countries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(), // ISO 3166-1 alpha-3 (e.g., HUN, GEO, POL)
  region: text("region").notNull(), // e.g., "Europe", "Africa", "Asia"
  subregion: text("subregion"), // e.g., "Eastern Europe", "East Africa"
  incomeLevel: text("income_level"), // e.g., "High income", "Upper middle income"
  regimeType: text("regime_type"), // e.g., "Electoral Autocracy", "Liberal Democracy"
  euMember: integer("eu_member", { mode: "boolean" }).default(false),
  coeMember: integer("coe_member", { mode: "boolean" }).default(false),
  population: integer("population"), // in millions
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Indicator readings - stores annual democratic indicator values per country.
 * Covers V-Dem indicators, Freedom House, and World Bank data points.
 * Primary source for trajectory analysis.
 */
export const indicatorReadings = sqliteTable("indicator_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryId: integer("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  // V-Dem Indicators (0-1 scale, higher = healthier)
  judicialIndependence: real("judicial_independence"),
  pressFreedom: real("press_freedom"),
  electoralIntegrity: real("electoral_integrity"),
  civilSocietySpace: real("civil_society_space"),
  executiveConstraints: real("executive_constraints"),
  // Aggregated composite score (0-100)
  compositeScore: real("composite_score"),
  // Source attribution
  source: text("source"), // e.g., "V-Dem v14", "Freedom House 2024"
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// Trajectory & Classification
// ============================================================================

/**
 * Trajectory classifications - computed status for each country/year.
 * Results from the deterministic trajectory engine algorithm.
 * Classifies as DEGRADING, STRESS, or STABLE.
 */
export const trajectoryClassifications = sqliteTable("trajectory_classifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryId: integer("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  status: text("status").notNull(), // "DEGRADING" | "STRESS" | "STABLE"
  // Flagged indicators (JSON array of indicator keys)
  criticalIndicators: text("critical_indicators"), // JSON array
  warningIndicators: text("warning_indicators"), // JSON array
  decliningCount: integer("declining_count").notNull().default(0),
  // Degradation rates per indicator (JSON object)
  degradationRates: text("degradation_rates"), // JSON object { indicator: rate }
  // Prior period comparison data
  priorWindowMean: text("prior_window_mean"), // JSON object
  recentWindowMean: text("recent_window_mean"), // JSON object
  computedAt: integer("computed_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// Historical Analogues
// ============================================================================

/**
 * Analogue cases - historical instances of democratic backsliding.
 * Used for cosine similarity matching to identify similar patterns.
 * Records intervention types, actors, and outcomes for learning.
 */
export const analogueCases = sqliteTable("analogue_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  country: text("country").notNull(),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  // Binary degradation vector (which indicators degraded)
  indicatorsDegraded: text("indicators_degraded").notNull(), // JSON array of indicator keys
  interventionType: text("intervention_type").notNull(), // e.g., "judicial_capture", "media_takeover"
  interventionActor: text("intervention_actor").notNull(), // e.g., "ruling_party", "oligarchic_network"
  outcome: text("outcome").notNull(), // "recovery" | "stalled" | "failure" | "consolidation"
  outcomeScore: real("outcome_score").notNull(), // 0.0 - 1.0 (1.0 = full recovery)
  // Historical notes and context
  notes: text("notes"),
  sources: text("sources"), // JSON array of source URLs/references
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// Alerts System
// ============================================================================

/**
 * Alerts - triggered when trajectory changes or indicators cross thresholds.
 * Core of the alerting system for democratic backsliding detection.
 * Supports multiple alert types and priority levels.
 */
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryId: integer("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // "TRAJECTORY_CHANGE" | "INDICATOR_CRITICAL" | "RAPID_DECLINE" | "ANALOGUE_MATCH"
  priority: text("priority").notNull().default("WARNING"), // "CRITICAL" | "WARNING" | "INFO"
  // Alert details
  title: text("title").notNull(),
  message: text("message").notNull(),
  // Affected indicators (JSON array)
  affectedIndicators: text("affected_indicators"),
  // Previous and new values (for trajectory changes)
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  // Resolution tracking
  resolved: integer("resolved", { mode: "boolean" }).default(false),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  resolvedBy: text("resolved_by"),
  resolutionNotes: text("resolution_notes"),
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// AIP Analysis Results
// ============================================================================

/**
 * AIP analysis results - stored outputs from LLM-assisted analysis.
 * Enables RAG-like retrieval and comparison of past analyses.
 * Tracks confidence and recommended interventions.
 */
export const aipAnalysisResults = sqliteTable("aip_analysis_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countryId: integer("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "cascade" }),
  // Trajectory context at time of analysis
  trajectoryStatus: text("trajectory_status").notNull(),
  criticalFlags: text("critical_flags"), // JSON array
  topAnalogues: text("top_analogues"), // JSON array of { country, similarity }
  // Analysis outputs
  trajectoryNarrative: text("trajectory_narrative"),
  primaryRiskFactor: text("primary_risk_factor"),
  analogueReasoning: text("analogue_reasoning"),
  recommendedInterventions: text("recommended_interventions"), // JSON array
  confidence: text("confidence"), // "HIGH" | "MEDIUM" | "LOW"
  analystAction: text("analyst_action"),
  // Processing metadata
  rawResponse: text("raw_response"), // Full API response for debugging
  processingTimeMs: integer("processing_time_ms"),
  modelUsed: text("model_used"),
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// Intervention Library
// ============================================================================

/**
 * Intervention records - historical intervention attempts from analogues.
 * Used to calculate success rates and inform recommendations.
 */
export const interventionRecords = sqliteTable("intervention_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analogueCaseId: integer("analogue_case_id")
    .notNull()
    .references(() => analogueCases.id, { onDelete: "cascade" }),
  interventionType: text("intervention_type").notNull(),
  actor: text("actor").notNull(),
  rationale: text("rationale"),
  historicalSuccessRate: real("historical_success_rate"), // 0.0 - 1.0
  outcome: text("outcome"),
  outcomeScore: real("outcome_score"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================================
// Type Exports
// ============================================================================

export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;
export type IndicatorReading = typeof indicatorReadings.$inferSelect;
export type NewIndicatorReading = typeof indicatorReadings.$inferInsert;
export type TrajectoryClassification = typeof trajectoryClassifications.$inferSelect;
export type NewTrajectoryClassification = typeof trajectoryClassifications.$inferInsert;
export type AnalogueCase = typeof analogueCases.$inferSelect;
export type NewAnalogueCase = typeof analogueCases.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AIPAnalysisResult = typeof aipAnalysisResults.$inferSelect;
export type NewAIPAnalysisResult = typeof aipAnalysisResults.$inferInsert;
export type InterventionRecord = typeof interventionRecords.$inferSelect;
export type NewInterventionRecord = typeof interventionRecords.$inferInsert;