import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initializes the database, creates tables, and seeds initial data.
 * Called on server bootstrap.
 * Uses raw SQL with libsql client for reliability.
 */
export async function initializeDatabase(): Promise<void> {
  const dbPath = process.env.DATABASE_URL ?? "file:data/democracy.db";

  // Ensure data directory exists
  const rawPath = dbPath.replace(/^file:/, "");
  const dataDir = rawPath.includes("/") ? rawPath.substring(0, rawPath.lastIndexOf("/")) : ".";
  if (dataDir && !existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  // Import dynamically to avoid circular dependencies
  const { drizzle } = await import("drizzle-orm/libsql");
  const { createClient } = await import("@libsql/client");
  
  const client = createClient({ url: dbPath });
  const db = drizzle(client);

  // Create tables using raw SQL
  console.log("🔧 Creating database tables...");

  try {
    // Countries table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS countries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        region TEXT NOT NULL,
        subregion TEXT,
        income_level TEXT,
        regime_type TEXT,
        eu_member INTEGER DEFAULT 0,
        coe_member INTEGER DEFAULT 0,
        population INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Indicator readings table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS indicator_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        judicial_independence REAL,
        press_freedom REAL,
        electoral_integrity REAL,
        civil_society_space REAL,
        executive_constraints REAL,
        composite_score REAL,
        source TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(country_id, year)
      )
    `);

    // Trajectory classifications table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS trajectory_classifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        status TEXT NOT NULL,
        critical_indicators TEXT,
        warning_indicators TEXT,
        declining_count INTEGER NOT NULL DEFAULT 0,
        degradation_rates TEXT,
        prior_window_mean TEXT,
        recent_window_mean TEXT,
        computed_at INTEGER NOT NULL,
        UNIQUE(country_id, year)
      )
    `);

    // Analogue cases table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS analogue_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT NOT NULL,
        start_year INTEGER NOT NULL,
        end_year INTEGER NOT NULL,
        indicators_degraded TEXT NOT NULL,
        intervention_type TEXT NOT NULL,
        intervention_actor TEXT NOT NULL,
        outcome TEXT NOT NULL,
        outcome_score REAL NOT NULL,
        notes TEXT,
        sources TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Alerts table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        alert_type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'WARNING',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        affected_indicators TEXT,
        previous_value TEXT,
        new_value TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_notes TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // AIP analysis results table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS aip_analysis_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        trajectory_status TEXT NOT NULL,
        critical_flags TEXT,
        top_analogues TEXT,
        trajectory_narrative TEXT,
        primary_risk_factor TEXT,
        analogue_reasoning TEXT,
        recommended_interventions TEXT,
        confidence TEXT,
        analyst_action TEXT,
        raw_response TEXT,
        processing_time_ms INTEGER,
        model_used TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Intervention records table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS intervention_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analogue_case_id INTEGER NOT NULL REFERENCES analogue_cases(id) ON DELETE CASCADE,
        intervention_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        rationale TEXT,
        historical_success_rate REAL,
        outcome TEXT,
        outcome_score REAL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_readings_country_year ON indicator_readings(country_id, year)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_classifications_country ON trajectory_classifications(country_id)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_alerts_country ON alerts(country_id)`);

    console.log("✅ Tables created successfully");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }

  // Check if data already exists
  const existingCountries = await client.execute("SELECT COUNT(*) as count FROM countries");
  const count = existingCountries.rows?.[0]?.count ?? 0;

  if (count === 0) {
    console.log("📦 Seeding database with initial data...");
    await seedDatabase(client);
    console.log("✅ Database seeded successfully");
  } else {
    console.log("✅ Database already populated");
  }

  // Close client
  client.close();
}

// ============================================================================
// Seed Data
// ============================================================================

async function seedDatabase(client: ReturnType<typeof createClient>): Promise<void> {
  const now = Date.now();

  // ============================================================================
  // Seed Countries
  // ============================================================================

  const countriesData = [
    { name: "Hungary", code: "HUN", region: "Europe", subregion: "Eastern Europe", euMember: true, coeMember: true },
    { name: "Georgia", code: "GEO", region: "Asia", subregion: "South Caucasus", euMember: false, coeMember: true },
    { name: "Poland", code: "POL", region: "Europe", subregion: "Eastern Europe", euMember: true, coeMember: true },
    { name: "Tunisia", code: "TUN", region: "Africa", subregion: "North Africa", euMember: false, coeMember: false },
    { name: "Kenya", code: "KEN", region: "Africa", subregion: "East Africa", euMember: false, coeMember: false },
    { name: "Serbia", code: "SRB", region: "Europe", subregion: "Southeastern Europe", euMember: false, coeMember: true },
  ];

  for (const c of countriesData) {
    await client.execute({
      sql: `INSERT INTO countries (name, code, region, subregion, eu_member, coe_member, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.name, c.code, c.region, c.subregion, c.euMember ? 1 : 0, c.coeMember ? 1 : 0, now, now],
    });
  }

  // ============================================================================
  // Seed Indicator Readings (2010-2024)
  // ============================================================================

  const indicatorData: Record<string, Array<{ year: number; ji: number; pf: number; ei: number; cs: number; ec: number }>> = {
    HUN: [
      { year: 2010, ji: 0.74, pf: 0.72, ei: 0.82, cs: 0.86, ec: 0.68 },
      { year: 2011, ji: 0.71, pf: 0.68, ei: 0.80, cs: 0.82, ec: 0.64 },
      { year: 2012, ji: 0.66, pf: 0.58, ei: 0.77, cs: 0.76, ec: 0.58 },
      { year: 2013, ji: 0.58, pf: 0.48, ei: 0.73, cs: 0.70, ec: 0.50 },
      { year: 2014, ji: 0.52, pf: 0.42, ei: 0.69, cs: 0.64, ec: 0.44 },
      { year: 2015, ji: 0.46, pf: 0.38, ei: 0.66, cs: 0.58, ec: 0.38 },
      { year: 2016, ji: 0.40, pf: 0.34, ei: 0.63, cs: 0.52, ec: 0.34 },
      { year: 2017, ji: 0.35, pf: 0.30, ei: 0.60, cs: 0.46, ec: 0.30 },
      { year: 2018, ji: 0.30, pf: 0.27, ei: 0.57, cs: 0.42, ec: 0.27 },
      { year: 2019, ji: 0.27, pf: 0.24, ei: 0.54, cs: 0.38, ec: 0.24 },
      { year: 2020, ji: 0.25, pf: 0.22, ei: 0.51, cs: 0.35, ec: 0.22 },
      { year: 2021, ji: 0.23, pf: 0.20, ei: 0.48, cs: 0.32, ec: 0.20 },
      { year: 2022, ji: 0.22, pf: 0.19, ei: 0.46, cs: 0.30, ec: 0.19 },
      { year: 2023, ji: 0.21, pf: 0.18, ei: 0.44, cs: 0.28, ec: 0.18 },
      { year: 2024, ji: 0.20, pf: 0.17, ei: 0.43, cs: 0.27, ec: 0.17 },
    ],
    GEO: [
      { year: 2010, ji: 0.54, pf: 0.62, ei: 0.70, cs: 0.74, ec: 0.62 },
      { year: 2011, ji: 0.56, pf: 0.64, ei: 0.72, cs: 0.76, ec: 0.64 },
      { year: 2012, ji: 0.60, pf: 0.68, ei: 0.76, cs: 0.80, ec: 0.68 },
      { year: 2013, ji: 0.62, pf: 0.70, ei: 0.78, cs: 0.82, ec: 0.70 },
      { year: 2014, ji: 0.64, pf: 0.72, ei: 0.80, cs: 0.84, ec: 0.72 },
      { year: 2015, ji: 0.66, pf: 0.74, ei: 0.82, cs: 0.86, ec: 0.74 },
      { year: 2016, ji: 0.65, pf: 0.72, ei: 0.80, cs: 0.84, ec: 0.72 },
      { year: 2017, ji: 0.63, pf: 0.70, ei: 0.78, cs: 0.82, ec: 0.70 },
      { year: 2018, ji: 0.60, pf: 0.67, ei: 0.75, cs: 0.79, ec: 0.67 },
      { year: 2019, ji: 0.56, pf: 0.62, ei: 0.71, cs: 0.75, ec: 0.62 },
      { year: 2020, ji: 0.52, pf: 0.57, ei: 0.66, cs: 0.70, ec: 0.57 },
      { year: 2021, ji: 0.47, pf: 0.51, ei: 0.61, cs: 0.64, ec: 0.51 },
      { year: 2022, ji: 0.40, pf: 0.44, ei: 0.55, cs: 0.58, ec: 0.44 },
      { year: 2023, ji: 0.33, pf: 0.36, ei: 0.48, cs: 0.51, ec: 0.38 },
      { year: 2024, ji: 0.28, pf: 0.30, ei: 0.42, cs: 0.45, ec: 0.32 },
    ],
    POL: [
      { year: 2010, ji: 0.80, pf: 0.84, ei: 0.90, cs: 0.92, ec: 0.86 },
      { year: 2011, ji: 0.79, pf: 0.83, ei: 0.89, cs: 0.91, ec: 0.85 },
      { year: 2012, ji: 0.78, pf: 0.82, ei: 0.88, cs: 0.90, ec: 0.84 },
      { year: 2013, ji: 0.77, pf: 0.81, ei: 0.87, cs: 0.89, ec: 0.83 },
      { year: 2014, ji: 0.76, pf: 0.80, ei: 0.86, cs: 0.88, ec: 0.82 },
      { year: 2015, ji: 0.72, pf: 0.76, ei: 0.82, cs: 0.84, ec: 0.77 },
      { year: 2016, ji: 0.65, pf: 0.69, ei: 0.76, cs: 0.78, ec: 0.69 },
      { year: 2017, ji: 0.56, pf: 0.60, ei: 0.70, cs: 0.72, ec: 0.60 },
      { year: 2018, ji: 0.48, pf: 0.52, ei: 0.64, cs: 0.66, ec: 0.52 },
      { year: 2019, ji: 0.42, pf: 0.46, ei: 0.58, cs: 0.60, ec: 0.46 },
      { year: 2020, ji: 0.38, pf: 0.42, ei: 0.54, cs: 0.56, ec: 0.42 },
      { year: 2021, ji: 0.35, pf: 0.38, ei: 0.50, cs: 0.52, ec: 0.38 },
      { year: 2022, ji: 0.34, pf: 0.37, ei: 0.49, cs: 0.51, ec: 0.37 },
      { year: 2023, ji: 0.40, pf: 0.44, ei: 0.56, cs: 0.58, ec: 0.46 },
      { year: 2024, ji: 0.46, pf: 0.50, ei: 0.62, cs: 0.64, ec: 0.52 },
    ],
    TUN: [
      { year: 2010, ji: 0.50, pf: 0.56, ei: 0.62, cs: 0.65, ec: 0.52 },
      { year: 2011, ji: 0.62, pf: 0.70, ei: 0.76, cs: 0.78, ec: 0.65 },
      { year: 2012, ji: 0.68, pf: 0.76, ei: 0.82, cs: 0.84, ec: 0.72 },
      { year: 2013, ji: 0.72, pf: 0.80, ei: 0.86, cs: 0.88, ec: 0.76 },
      { year: 2014, ji: 0.74, pf: 0.82, ei: 0.88, cs: 0.90, ec: 0.78 },
      { year: 2015, ji: 0.75, pf: 0.83, ei: 0.89, cs: 0.91, ec: 0.79 },
      { year: 2016, ji: 0.76, pf: 0.84, ei: 0.90, cs: 0.92, ec: 0.80 },
      { year: 2017, ji: 0.74, pf: 0.81, ei: 0.86, cs: 0.88, ec: 0.76 },
      { year: 2018, ji: 0.72, pf: 0.78, ei: 0.82, cs: 0.84, ec: 0.73 },
      { year: 2019, ji: 0.68, pf: 0.73, ei: 0.77, cs: 0.79, ec: 0.68 },
      { year: 2020, ji: 0.64, pf: 0.68, ei: 0.72, cs: 0.74, ec: 0.63 },
      { year: 2021, ji: 0.54, pf: 0.58, ei: 0.62, cs: 0.64, ec: 0.52 },
      { year: 2022, ji: 0.44, pf: 0.47, ei: 0.50, cs: 0.52, ec: 0.42 },
      { year: 2023, ji: 0.36, pf: 0.38, ei: 0.42, cs: 0.44, ec: 0.34 },
      { year: 2024, ji: 0.28, pf: 0.30, ei: 0.35, cs: 0.37, ec: 0.27 },
    ],
    KEN: [
      { year: 2010, ji: 0.54, pf: 0.58, ei: 0.48, cs: 0.68, ec: 0.56 },
      { year: 2011, ji: 0.55, pf: 0.59, ei: 0.50, cs: 0.69, ec: 0.57 },
      { year: 2012, ji: 0.56, pf: 0.60, ei: 0.52, cs: 0.70, ec: 0.58 },
      { year: 2013, ji: 0.62, pf: 0.66, ei: 0.70, cs: 0.74, ec: 0.66 },
      { year: 2014, ji: 0.64, pf: 0.68, ei: 0.72, cs: 0.76, ec: 0.68 },
      { year: 2015, ji: 0.66, pf: 0.70, ei: 0.74, cs: 0.78, ec: 0.70 },
      { year: 2016, ji: 0.68, pf: 0.72, ei: 0.76, cs: 0.80, ec: 0.72 },
      { year: 2017, ji: 0.58, pf: 0.62, ei: 0.52, cs: 0.72, ec: 0.60 },
      { year: 2018, ji: 0.62, pf: 0.66, ei: 0.68, cs: 0.76, ec: 0.66 },
      { year: 2019, ji: 0.66, pf: 0.70, ei: 0.72, cs: 0.80, ec: 0.70 },
      { year: 2020, ji: 0.68, pf: 0.72, ei: 0.74, cs: 0.82, ec: 0.72 },
      { year: 2021, ji: 0.70, pf: 0.74, ei: 0.76, cs: 0.84, ec: 0.74 },
      { year: 2022, ji: 0.72, pf: 0.76, ei: 0.78, cs: 0.86, ec: 0.76 },
      { year: 2023, ji: 0.74, pf: 0.78, ei: 0.80, cs: 0.88, ec: 0.78 },
      { year: 2024, ji: 0.76, pf: 0.80, ei: 0.82, cs: 0.90, ec: 0.80 },
    ],
    SRB: [
      { year: 2010, ji: 0.52, pf: 0.58, ei: 0.68, cs: 0.72, ec: 0.58 },
      { year: 2011, ji: 0.54, pf: 0.60, ei: 0.70, cs: 0.74, ec: 0.60 },
      { year: 2012, ji: 0.56, pf: 0.62, ei: 0.72, cs: 0.76, ec: 0.62 },
      { year: 2013, ji: 0.58, pf: 0.64, ei: 0.74, cs: 0.78, ec: 0.64 },
      { year: 2014, ji: 0.60, pf: 0.65, ei: 0.74, cs: 0.78, ec: 0.64 },
      { year: 2015, ji: 0.58, pf: 0.62, ei: 0.72, cs: 0.76, ec: 0.62 },
      { year: 2016, ji: 0.56, pf: 0.58, ei: 0.70, cs: 0.74, ec: 0.60 },
      { year: 2017, ji: 0.54, pf: 0.54, ei: 0.68, cs: 0.72, ec: 0.58 },
      { year: 2018, ji: 0.52, pf: 0.50, ei: 0.66, cs: 0.70, ec: 0.56 },
      { year: 2019, ji: 0.50, pf: 0.46, ei: 0.64, cs: 0.68, ec: 0.54 },
      { year: 2020, ji: 0.48, pf: 0.44, ei: 0.62, cs: 0.66, ec: 0.52 },
      { year: 2021, ji: 0.46, pf: 0.42, ei: 0.60, cs: 0.64, ec: 0.50 },
      { year: 2022, ji: 0.44, pf: 0.40, ei: 0.58, cs: 0.62, ec: 0.48 },
      { year: 2023, ji: 0.42, pf: 0.38, ei: 0.56, cs: 0.60, ec: 0.46 },
      { year: 2024, ji: 0.40, pf: 0.36, ei: 0.54, cs: 0.58, ec: 0.44 },
    ],
  };

  const countryIdMap: Record<string, number> = { HUN: 1, GEO: 2, POL: 3, TUN: 4, KEN: 5, SRB: 6 };

  for (const [code, readings] of Object.entries(indicatorData)) {
    const countryId = countryIdMap[code];
    for (const r of readings) {
      const composite = ((r.ji + r.pf + r.ei + r.cs + r.ec) / 5 * 100).toFixed(2);
      await client.execute({
        sql: `INSERT INTO indicator_readings (country_id, year, judicial_independence, press_freedom, electoral_integrity, civil_society_space, executive_constraints, composite_score, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [countryId, r.year, r.ji, r.pf, r.ei, r.cs, r.ec, composite, "V-Dem v14", now],
      });
    }
  }

  // ============================================================================
  // Seed Analogue Cases
  // ============================================================================

  const analoguesData = [
    { country: "Poland", start_year: 2015, end_year: 2023, indicators_degraded: ["judicial_independence", "press_freedom", "executive_constraints"], intervention_type: "judicial_capture", intervention_actor: "ruling_party", outcome: "recovery", outcome_score: 0.62, notes: "PiS captured Constitutional Tribunal Dec 2015. EU Article 7 triggered Dec 2017. December 2023 elections returned Civic Coalition." },
    { country: "Hungary", start_year: 2011, end_year: 2023, indicators_degraded: ["judicial_independence", "press_freedom", "electoral_integrity", "civil_society_space", "executive_constraints"], intervention_type: "coordinated_combined", intervention_actor: "ruling_party", outcome: "failure", outcome_score: 0.18, notes: "Fidesz supermajority 2010. 2011 Constitution. Media Acts. NJC capture. First EU member state Not Free (2021)." },
    { country: "Venezuela", start_year: 2002, end_year: 2013, indicators_degraded: ["judicial_independence", "press_freedom", "electoral_integrity"], intervention_type: "coordinated_combined", intervention_actor: "executive_president", outcome: "failure", outcome_score: 0.15 },
    { country: "Czech Republic", start_year: 1992, end_year: 1997, indicators_degraded: ["press_freedom", "civil_society_space"], intervention_type: "media_takeover", intervention_actor: "ruling_party", outcome: "recovery", outcome_score: 0.88, notes: "Mečiar media capture. NATO/EU accession criteria. 1998 elections defeated Mečiar." },
    { country: "Slovakia", start_year: 1994, end_year: 1998, indicators_degraded: ["press_freedom", "executive_constraints"], intervention_type: "media_takeover", intervention_actor: "oligarchic_network", outcome: "recovery", outcome_score: 0.85 },
    { country: "Croatia", start_year: 1995, end_year: 2000, indicators_degraded: ["judicial_independence", "press_freedom", "electoral_integrity"], intervention_type: "coordinated_combined", intervention_actor: "executive_president", outcome: "recovery", outcome_score: 0.72 },
    { country: "Moldova", start_year: 1998, end_year: 2002, indicators_degraded: ["executive_constraints", "civil_society_space"], intervention_type: "executive_expansion", intervention_actor: "ruling_party", outcome: "recovery", outcome_score: 0.76 },
    { country: "Nicaragua", start_year: 2007, end_year: 2018, indicators_degraded: ["judicial_independence", "press_freedom", "civil_society_space"], intervention_type: "coordinated_combined", intervention_actor: "executive_president", outcome: "failure", outcome_score: 0.22 },
    { country: "Turkey", start_year: 2013, end_year: 2020, indicators_degraded: ["judicial_independence", "press_freedom", "executive_constraints"], intervention_type: "coordinated_combined", intervention_actor: "executive_president", outcome: "failure", outcome_score: 0.25, notes: "Post-Gezi purges. Failed 2016 coup. 2017 constitutional referendum." },
    { country: "India", start_year: 2014, end_year: 2024, indicators_degraded: ["press_freedom", "civil_society_space", "executive_constraints"], intervention_type: "civil_society_restriction", intervention_actor: "ruling_party", outcome: "consolidation", outcome_score: 0.40, notes: "Media consolidation. Foreign funding rules targeting NGOs." },
    { country: "Romania", start_year: 2017, end_year: 2019, indicators_degraded: ["judicial_independence", "press_freedom"], intervention_type: "judicial_capture", intervention_actor: "ruling_party", outcome: "recovery", outcome_score: 0.70, notes: "PSD judicial reforms. EU Commission rule-of-law warning. Civil society protests." },
    { country: "Cambodia", start_year: 2013, end_year: 2018, indicators_degraded: ["press_freedom", "civil_society_space", "electoral_integrity"], intervention_type: "coordinated_combined", intervention_actor: "executive_president", outcome: "failure", outcome_score: 0.20, notes: "CNRP dissolved 2017. Kem Sokha arrested. 2018 elections not credible." },
    { country: "Myanmar", start_year: 2011, end_year: 2021, indicators_degraded: ["civil_society_space", "executive_constraints"], intervention_type: "executive_expansion", intervention_actor: "military", outcome: "failure", outcome_score: 0.10, notes: "Feb 2021 coup reversed democratization. Civil war followed." },
    { country: "Philippines", start_year: 2016, end_year: 2022, indicators_degraded: ["press_freedom", "civil_society_space", "executive_constraints"], intervention_type: "civil_society_restriction", intervention_actor: "executive_president", outcome: "stalled", outcome_score: 0.45, notes: "War on drugs. Media intimidation. Civil society harassed." },
    { country: "Bangladesh", start_year: 2018, end_year: 2024, indicators_degraded: ["press_freedom", "electoral_integrity", "executive_constraints"], intervention_type: "coordinated_combined", intervention_actor: "ruling_party", outcome: "consolidation", outcome_score: 0.35 },
  ];

  for (const a of analoguesData) {
    await client.execute({
      sql: `INSERT INTO analogue_cases (country, start_year, end_year, indicators_degraded, intervention_type, intervention_actor, outcome, outcome_score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [a.country, a.start_year, a.end_year, JSON.stringify(a.indicators_degraded), a.intervention_type, a.intervention_actor, a.outcome, a.outcome_score, a.notes ?? null, now],
    });
  }

  console.log(`📊 Seeded: ${countriesData.length} countries, ${Object.values(indicatorData).flat().length} indicator readings, ${analoguesData.length} analogue cases`);
}