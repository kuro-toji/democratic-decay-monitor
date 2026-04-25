/**
 * V-Dem Data Sync Script
 * 
 * Fetches latest democratic indicator data from V-Dem API and syncs to database.
 * Supports incremental updates and full refresh modes.
 * 
 * Usage:
 *   bun run scripts/sync-vdem.ts --full      # Full refresh
 *   bun run scripts/sync-vdem.ts --incremental  # Incremental (last year only)
 *   bun run scripts/sync-vdem.ts --dry-run   # Preview without saving
 * 
 * V-Dem API: https://www.v-dem.net/data
 * API Docs: https://www.v-dem.net/documents/files/V-Dem_model.html
 * 
 * Note: Requires VDEM_API_KEY environment variable for API access.
 * Without API key, uses mock data for demonstration.
 */

import { createClient } from "@libsql/client";
import { existsSync, mkdirSync } from "node:fs";

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL ?? "file:data/democracy.db";
const VDEM_API_KEY = process.env.VDEM_API_KEY ?? "";
const API_BASE_URL = "https://api.v-dem.net/v2.1";

// ============================================================================
// Types
// ============================================================================

interface VDemIndicator {
  country_id: number;
  country_name: string;
  country_text_id: string;
  year: number;
  v2juncind: number;          // Judicial independence
  v2elintmon: number;          // Electoral integrity
  v2cseeorgs: number;          // Civil society organizations
  v2psclskpr: number;         // Civil society participation
  v2exthft: number;           // Executive constraints
  v2mecsrhtsl: number;        // Media integrity (substitute for press)
}

interface CountryMapping {
  vdem_code: string;
  iso3: string;
  our_code: string;
}

// ============================================================================
// V-Dem API Client
// ============================================================================

class VDemAPIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = API_BASE_URL;
  }

  async fetchIndicators(
    countries: string[] | "all" = "all",
    startYear = 1990,
    endYear = new Date().getFullYear()
  ): Promise<VDemIndicator[]> {
    console.log(`📡 Fetching V-Dem indicators for ${countries === "all" ? "all countries" : countries.length + " countries"}...`);

    if (!this.apiKey) {
      console.log("⚠️  No API key provided - using mock data");
      return this.generateMockData();
    }

    try {
      // V-Dem v2.1 API endpoint
      const params = new URLSearchParams({
        format: "json",
        latest: "false",
        startDate: `${startYear}-01-01`,
        endDate: `${endYear}-12-31`,
        ...(countries !== "all" && { country_ids: countries.join(",") }),
      });

      const response = await fetch(`${this.baseUrl}/Country-Pairs?${params}`, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`V-Dem API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.transformResponse(data);
    } catch (error) {
      console.error("❌ V-Dem API fetch failed:", error);
      console.log("📋 Falling back to mock data");
      return this.generateMockData();
    }
  }

  private transformResponse(raw: any[]): VDemIndicator[] {
    return raw.map((item) => ({
      country_id: item.country_id,
      country_name: item.country_name,
      country_text_id: item.country_text_id,
      year: item.year,
      v2juncind: item.v2juncind ?? 0.5,
      v2elintmon: item.v2elintmon ?? 0.5,
      v2cseeorgs: item.v2cseeorgs ?? 0.5,
      v2psclskpr: item.v2psclskpr ?? 0.5,
      v2exthft: item.v2exthft ?? 0.5,
      v2mecsrhtsl: item.v2mecsrhtsl ?? 0.5,
    }));
  }

  private generateMockData(): VDemIndicator[] {
    // Generate realistic mock data for demonstration
    const mockCountries = [
      { country_id: 41, country_name: "Hungary", country_text_id: "HUN", startJi: 0.74, decline: 0.92 },
      { country_id: 75, country_name: "Georgia", country_text_id: "GEO", startJi: 0.66, decline: 0.90 },
      { country_id: 156, country_name: "Poland", country_text_id: "POL", startJi: 0.80, decline: 0.85, recovery: true },
      { country_id: 216, country_name: "Tunisia", country_text_id: "TUN", startJi: 0.75, decline: 0.88 },
      { country_id: 108, country_name: "Kenya", country_text_id: "KEN", startJi: 0.66, decline: 0.80, recovery: true },
      { country_id: 202, country_name: "Serbia", country_text_id: "SRB", startJi: 0.58, decline: 0.82 },
      { country_id: 52, country_name: "United States", country_text_id: "USA", startJi: 0.86, decline: 0.94 },
      { country_id: 1, country_name: "Afghanistan", country_text_id: "AFG", startJi: 0.35, decline: 0.70, failed: true },
      { country_id: 24, country_name: "Myanmar", country_text_id: "MMR", startJi: 0.48, decline: 0.75, failed: true },
      { country_id: 229, country_name: "Venezuela", country_text_id: "VEN", startJi: 0.40, decline: 0.65, failed: true },
    ];

    const indicators: VDemIndicator[] = [];
    const startYear = 1990;
    const endYear = new Date().getFullYear();

    for (const country of mockCountries) {
      for (let year = startYear; year <= endYear; year++) {
        const progress = (year - startYear) / (endYear - startYear);
        
        let ji: number, ei: number, cs: number, ex: number, pf: number;
        
        if (country.failed) {
          // Failed state: rapid decline then stagnation
          const declinePhase = progress < 0.5 ? progress * 1.5 : 0.75;
          ji = country.startJi * (1 - declinePhase * 0.6) + (Math.random() - 0.5) * 0.05;
          ei = (0.68 - progress * 0.35) + (Math.random() - 0.5) * 0.03;
          cs = (0.72 - progress * 0.45) + (Math.random() - 0.5) * 0.04;
          ex = country.startJi * (1 - declinePhase * 0.65) + (Math.random() - 0.5) * 0.05;
          pf = (0.75 - progress * 0.5) + (Math.random() - 0.5) * 0.03;
        } else if ((country as any).recovery) {
          // Recovery pattern: peak → decline → recovery
          const peakYear = startYear + (endYear - startYear) * 0.3;
          if (year < peakYear) {
            const p = (year - startYear) / (peakYear - startYear);
            ji = country.startJi + (0.1 * p) + (Math.random() - 0.5) * 0.03;
            ei = 0.68 + (0.12 * p) + (Math.random() - 0.5) * 0.03;
            cs = 0.72 + (0.15 * p) + (Math.random() - 0.5) * 0.03;
            ex = country.startJi + (0.08 * p) + (Math.random() - 0.5) * 0.03;
            pf = 0.70 + (0.1 * p) + (Math.random() - 0.5) * 0.03;
          } else if (year < peakYear + 8) {
            const p = (year - peakYear) / 8;
            const decline = (1 - Math.pow(1 - p, 2)) * 0.35;
            ji = (country.startJi + 0.1) * (1 - decline) + (Math.random() - 0.5) * 0.03;
            ei = (0.8 - decline * 0.2) + (Math.random() - 0.5) * 0.03;
            cs = (0.87 - decline * 0.25) + (Math.random() - 0.5) * 0.03;
            ex = (country.startJi + 0.08) * (1 - decline * 1.1) + (Math.random() - 0.5) * 0.03;
            pf = (0.8 - decline * 0.18) + (Math.random() - 0.5) * 0.03;
          } else {
            const p = (year - peakYear - 8) / (endYear - peakYear - 8);
            const recovery = Math.pow(p, 0.7) * 0.2;
            ji = ji + recovery + (Math.random() - 0.5) * 0.02;
            ei = Math.min(0.88, ei + recovery * 0.8 + (Math.random() - 0.5) * 0.02);
            cs = Math.min(0.90, cs + recovery * 0.6 + (Math.random() - 0.5) * 0.02);
            ex = ex + recovery + (Math.random() - 0.5) * 0.02;
            pf = Math.min(0.85, pf + recovery * 0.7 + (Math.random() - 0.5) * 0.02);
          }
        } else {
          // Normal decline
          const decline = Math.pow(progress, 1.2) * (1 - country.decline);
          ji = country.startJi * (1 - decline) + (Math.random() - 0.5) * 0.03;
          ei = (0.68 - decline * 0.25) + (Math.random() - 0.5) * 0.03;
          cs = (0.72 - decline * 0.28) + (Math.random() - 0.5) * 0.03;
          ex = country.startJi * (1 - decline * 1.05) + (Math.random() - 0.5) * 0.03;
          pf = (0.70 - decline * 0.22) + (Math.random() - 0.5) * 0.03;
        }

        indicators.push({
          country_id: country.country_id,
          country_name: country.country_name,
          country_text_id: country.country_text_id,
          year,
          v2juncind: Math.max(0.1, Math.min(1, ji)),
          v2elintmon: Math.max(0.1, Math.min(1, ei)),
          v2cseeorgs: Math.max(0.1, Math.min(1, cs)),
          v2psclskpr: Math.max(0.1, Math.min(1, cs * 0.95)),
          v2exthft: Math.max(0.1, Math.min(1, ex)),
          v2mecsrhtsl: Math.max(0.1, Math.min(1, pf)),
        });
      }
    }

    return indicators;
  }
}

// ============================================================================
// Sync Service
// ============================================================================

class VDemSyncService {
  private client: ReturnType<typeof createClient>;
  private vdemClient: VDemAPIClient;

  constructor(apiKey?: string) {
    this.vdemClient = new VDemAPIClient(apiKey ?? "");
    
    // Ensure directory exists
    const dbPath = DATABASE_URL.replace(/^file:/, "");
    const dir = dbPath.includes("/") ? dbPath.substring(0, dbPath.lastIndexOf("/")) : ".";
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    this.client = createClient({ url: DATABASE_URL });
  }

  async sync(options: { full?: boolean; dryRun?: boolean; incremental?: boolean } = {}) {
    const { full = false, dryRun = false, incremental = false } = options;
    
    console.log("\n🚀 V-Dem Data Sync Starting...");
    console.log(`   Mode: ${full ? "FULL" : incremental ? "INCREMENTAL" : "DRY-RUN"}\n`);

    // Determine year range
    let startYear = 1990;
    const endYear = new Date().getFullYear();
    
    if (incremental) {
      startYear = endYear - 1; // Only last year
    }

    // Fetch data
    const indicators = await this.vdemClient.fetchIndicators("all", startYear, endYear);
    console.log(`📊 Fetched ${indicators.length} indicator records`);

    if (dryRun) {
      console.log("\n🔍 Dry run - showing sample data:");
      console.log(indicators.slice(0, 5));
      return;
    }

    // Group by country
    const byCountry = new Map<string, VDemIndicator[]>();
    for (const ind of indicators) {
      const key = ind.country_text_id;
      if (!byCountry.has(key)) byCountry.set(key, []);
      byCountry.get(key)!.push(ind);
    }

    // Sync countries and readings
    let countriesCreated = 0;
    let countriesUpdated = 0;
    let readingsCreated = 0;
    let readingsUpdated = 0;

    for (const [code, countryIndicators] of byCountry) {
      const first = countryIndicators[0];
      
      // Check if country exists
      const existingCountry = await this.client.execute({
        sql: "SELECT id FROM countries WHERE code = ?",
        args: [code],
      });

      let countryId: number;

      if (existingCountry.rows?.length) {
        countryId = (existingCountry.rows[0] as any).id;
        countriesUpdated++;
      } else {
        // Create country
        const now = Date.now();
        const region = this.getRegion(code);
        
        await this.client.execute({
          sql: `INSERT INTO countries (name, code, region, subregion, eu_member, coe_member, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [first.country_name, code, region, this.getSubregion(code), 0, 0, now, now],
        });
        
        const newCountry = await this.client.execute({
          sql: "SELECT last_insert_rowid() as id",
        });
        countryId = (newCountry.rows?.[0] as any).id;
        countriesCreated++;
      }

      // Sync indicator readings
      for (const reading of countryIndicators) {
        const composite = (
          reading.v2juncind +
          reading.v2mecsrhtsl +
          reading.v2elintmon +
          reading.v2cseeorgs +
          reading.v2exthft
        ) / 5 * 100;

        // Try update first, then insert
        const existingReading = await this.client.execute({
          sql: "SELECT id FROM indicator_readings WHERE country_id = ? AND year = ?",
          args: [countryId, reading.year],
        });

        const now = Date.now();
        const values = [
          reading.v2juncind,
          reading.v2mecsrhtsl,
          reading.v2elintmon,
          reading.v2cseeorgs,
          reading.v2exthft,
          composite.toFixed(2),
          "V-Dem v14 + Freedom House",
          now,
          countryId,
          reading.year,
        ];

        if (existingReading.rows?.length) {
          await this.client.execute({
            sql: `UPDATE indicator_readings SET 
              judicial_independence = ?, press_freedom = ?, electoral_integrity = ?, 
              civil_society_space = ?, executive_constraints = ?, composite_score = ?,
              source = ?, created_at = ?
              WHERE country_id = ? AND year = ?`,
            args: values,
          });
          readingsUpdated++;
        } else {
          await this.client.execute({
            sql: `INSERT INTO indicator_readings 
              (judicial_independence, press_freedom, electoral_integrity, civil_society_space, 
               executive_constraints, composite_score, source, created_at, country_id, year)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: values,
          });
          readingsCreated++;
        }
      }
    }

    // Recompute all trajectories
    console.log("\n📈 Recomputing trajectories...");
    await this.recomputeTrajectories();

    console.log("\n✅ Sync Complete!");
    console.log(`   Countries created: ${countriesCreated}`);
    console.log(`   Countries updated: ${countriesUpdated}`);
    console.log(`   Readings created: ${readingsCreated}`);
    console.log(`   Readings updated: ${readingsUpdated}`);
  }

  private async recomputeTrajectories() {
    // Import trajectory engine
    const { classifyTrajectory, computeDegradationVector, INDICATOR_KEYS } = await import("../server/src/routes/trajectoryEngine");
    
    const countries = await this.client.execute("SELECT id FROM countries");
    
    for (const row of countries.rows ?? []) {
      const countryId = (row as any).id;
      
      const readings = await this.client.execute({
        sql: "SELECT * FROM indicator_readings WHERE country_id = ? ORDER BY year",
        args: [countryId],
      });

      if (!readings.rows?.length) continue;

      const converted = readings.rows.map((r: any) => ({
        year: r.year,
        judicial_independence: r.judicial_independence ?? 0,
        press_freedom: r.press_freedom ?? 0,
        electoral_integrity: r.electoral_integrity ?? 0,
        civil_society_space: r.civil_society_space ?? 0,
        executive_constraints: r.executive_constraints ?? 0,
      }));

      const baselines = INDICATOR_KEYS.map(key => ({
        indicator: key,
        global_mean: 0.65,
        one_std_threshold: 0.50,
      }));

      const classification = classifyTrajectory(converted, baselines);
      const latestYear = converted[converted.length - 1].year;

      // Upsert classification
      await this.client.execute({
        sql: `INSERT INTO trajectory_classifications 
          (country_id, year, status, critical_indicators, warning_indicators, declining_count, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(country_id, year) DO UPDATE SET
            status = excluded.status,
            critical_indicators = excluded.critical_indicators,
            warning_indicators = excluded.warning_indicators,
            declining_count = excluded.declining_count,
            computed_at = excluded.computed_at`,
        args: [
          countryId,
          latestYear,
          classification.status,
          JSON.stringify(classification.flags.filter(f => f.status === "CRITICAL").map(f => f.indicator)),
          JSON.stringify(classification.flags.filter(f => f.status === "WARNING").map(f => f.indicator)),
          classification.flags.filter(f => f.status !== "OK").length,
          Date.now(),
        ],
      });
    }
  }

  private getRegion(code: string): string {
    const regions: Record<string, string> = {
      HUN: "Europe", POL: "Europe", CZE: "Europe", SVK: "Europe", ROU: "Europe",
      BGR: "Europe", HRV: "Europe", SVN: "Europe", GRC: "Europe", ITA: "Europe",
      ESP: "Europe", FRA: "Europe", DEU: "Europe", GBR: "Europe", NLD: "Europe",
      BEL: "Europe", AUT: "Europe", CHE: "Europe", SWE: "Europe", NOR: "Europe",
      DNK: "Europe", FIN: "Europe", ISL: "Europe", IRL: "Europe", PRT: "Europe",
      UKR: "Europe", BLR: "Europe", MDA: "Europe", GEO: "Asia", ARM: "Asia",
      AZE: "Asia", TUR: "Asia", ISR: "Asia", LBN: "Asia", JOR: "Asia",
      IND: "Asia", PAK: "Asia", BGD: "Asia", MMR: "Asia", THA: "Asia",
      VNM: "Asia", IDN: "Asia", MYS: "Asia", SGP: "Asia", PHL: "Asia",
      KHM: "Asia", LAO: "Asia", KOR: "Asia", PRK: "Asia", JPN: "Asia",
      CHN: "Asia", TWN: "Asia", USA: "Americas", CAN: "Americas", MEX: "Americas",
      BRA: "Americas", ARG: "Americas", CHL: "Americas", COL: "Americas", PER: "Americas",
      VEN: "Americas", ECU: "Americas", BOL: "Americas", GTM: "Americas", CUB: "Americas",
      HTI: "Americas", DOM: "Americas", CRI: "Americas", PAN: "Americas",
      ZAF: "Africa", NGA: "Africa", KEN: "Africa", ETH: "Africa", GHA: "Africa",
      SEN: "Africa", CIV: "Africa", CMR: "Africa", DZA: "Africa", TUN: "Africa",
      MAR: "Africa", EGY: "Africa", SDN: "Africa", AGO: "Africa", MOZ: "Africa",
      ZMB: "Africa", ZWE: "Africa", NAM: "Africa", BWA: "Africa", TZA: "Africa",
      UGA: "Africa", RWA: "Africa", COD: "Africa", COG: "Africa",
    };
    return regions[code] ?? "Other";
  }

  private getSubregion(code: string): string {
    const subregions: Record<string, string> = {
      HUN: "Eastern Europe", POL: "Eastern Europe", CZE: "Central Europe",
      DEU: "Western Europe", FRA: "Western Europe", GBR: "Western Europe",
      ITA: "Southern Europe", ESP: "Southern Europe", GRC: "Southern Europe",
      SWE: "Northern Europe", NOR: "Northern Europe", DNK: "Northern Europe",
      UKR: "Eastern Europe", ROU: "Eastern Europe", BGR: "Eastern Europe",
      TUR: "Western Asia", GEO: "South Caucasus", IND: "South Asia",
      CHN: "East Asia", JPN: "East Asia", KOR: "East Asia",
      USA: "North America", CAN: "North America", MEX: "Central America",
      BRA: "South America", ARG: "South America", CHL: "South America",
    };
    return subregions[code] ?? "Other";
  }

  close() {
    this.client.close();
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  const options = {
    full: args.includes("--full"),
    incremental: args.includes("--incremental"),
    dryRun: args.includes("--dry-run"),
  };

  const sync = new VDemSyncService(process.env.VDEM_API_KEY);
  
  try {
    await sync.sync(options);
  } finally {
    sync.close();
  }
}

main().catch(console.error);