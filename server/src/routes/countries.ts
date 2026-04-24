import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, asc, and, gte, lte } from "drizzle-orm";
import { db, countries, indicatorReadings, trajectoryClassifications, analogueCases } from "../db";
import { classifyTrajectory, computeDegradationVector, findAnalogues, INDICATOR_KEYS, type TrajectoryStatus } from "./trajectoryEngine";

export const countriesRoutes = new Hono();

// ============================================================================
// Request Validation Schemas
// ============================================================================

const CreateCountrySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().length(3).toUpperCase(),
  region: z.string().min(1),
  subregion: z.string().optional(),
  incomeLevel: z.string().optional(),
  regimeType: z.string().optional(),
  euMember: z.boolean().optional(),
  coeMember: z.boolean().optional(),
  population: z.number().int().positive().optional(),
});

const UpdateCountrySchema = CreateCountrySchema.partial();

const CreateIndicatorReadingSchema = z.object({
  countryId: z.number().int().positive(),
  year: z.number().int().min(1990).max(2030),
  judicialIndependence: z.number().min(0).max(1).optional(),
  pressFreedom: z.number().min(0).max(1).optional(),
  electoralIntegrity: z.number().min(0).max(1).optional(),
  civilSocietySpace: z.number().min(0).max(1).optional(),
  executiveConstraints: z.number().min(0).max(1).optional(),
  compositeScore: z.number().min(0).max(100).optional(),
  source: z.string().optional(),
});

// ============================================================================
// Country CRUD
// ============================================================================

/**
 * GET /api/countries
 * List all countries with optional filters and pagination.
 * Includes latest indicator values and trajectory status.
 */
countriesRoutes.get("/", async (c) => {
  try {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = (page - 1) * limit;
    const region = c.req.query("region");
    const status = c.req.query("status") as TrajectoryStatus | undefined;

    // Fetch countries with latest indicator reading
    const allCountries = await db.query.countries.findMany({
      orderBy: [asc(countries.name)],
    });

    // Attach latest trajectory classification
    const result = await Promise.all(
      allCountries.map(async (country) => {
        const latestClassification = await db.query.trajectoryClassifications.findFirst({
          where: eq(trajectoryClassifications.countryId, country.id),
          orderBy: [desc(trajectoryClassifications.year)],
        });

        const latestReading = await db.query.indicatorReadings.findFirst({
          where: eq(indicatorReadings.countryId, country.id),
          orderBy: [desc(indicatorReadings.year)],
        });

        return {
          ...country,
          trajectoryStatus: latestClassification?.status ?? "UNKNOWN",
          latestReading,
        };
      })
    );

    // Filter by region if specified
    const filtered = region ? result.filter((c) => c.region === region) : result;
    const paginated = filtered.slice(offset, offset + limit);

    return c.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching countries:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch countries", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * GET /api/countries/:id
 * Get a single country with full indicator history and trajectory.
 */
countriesRoutes.get("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const country = await db.query.countries.findFirst({
      where: eq(countries.id, id),
    });

    if (!country) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    // Get indicator history
    const readings = await db.query.indicatorReadings.findMany({
      where: eq(indicatorReadings.countryId, id),
      orderBy: [asc(indicatorReadings.year)],
    });

    // Get trajectory classifications
    const classifications = await db.query.trajectoryClassifications.findMany({
      where: eq(trajectoryClassifications.countryId, id),
      orderBy: [desc(trajectoryClassifications.year)],
    });

    // Get analogue matches (top 3 most similar)
    const degradationVector = computeDegradationVector(readings.map(r => ({
      year: r.year,
      judicial_independence: r.judicialIndependence ?? 0,
      press_freedom: r.pressFreedom ?? 0,
      electoral_integrity: r.electoralIntegrity ?? 0,
      civil_society_space: r.civilSocietySpace ?? 0,
      executive_constraints: r.executiveConstraints ?? 0,
    })));

    const allAnalogues = await db.query.analogueCases.findMany();
    const analogueMatches = findAnalogues(degradationVector, allAnalogues, 3);

    return c.json({
      success: true,
      data: {
        ...country,
        readings,
        classifications,
        analogueMatches,
        degradationVector,
      },
    });
  } catch (error) {
    console.error("Error fetching country:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch country", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * POST /api/countries
 * Create a new country entry.
 */
countriesRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const result = CreateCountrySchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const [country] = await db.insert(countries).values(result.data).returning();
    return c.json({ success: true, data: country }, 201);
  } catch (error) {
    console.error("Error creating country:", error);
    return c.json(
      { success: false, error: { message: "Failed to create country", code: "CREATE_ERROR" } },
      500
    );
  }
});

/**
 * PUT /api/countries/:id
 * Update an existing country.
 */
countriesRoutes.put("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const body = await c.req.json();
    const result = UpdateCountrySchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const updated = await db.update(countries)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(countries.id, id))
      .returning();

    if (updated.length === 0) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error updating country:", error);
    return c.json(
      { success: false, error: { message: "Failed to update country", code: "UPDATE_ERROR" } },
      500
    );
  }
});

/**
 * DELETE /api/countries/:id
 * Delete a country and all associated data (cascade).
 */
countriesRoutes.delete("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const deleted = await db.delete(countries).where(eq(countries.id, id)).returning();

    if (deleted.length === 0) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({ success: true, data: { deleted: true, id } });
  } catch (error) {
    console.error("Error deleting country:", error);
    return c.json(
      { success: false, error: { message: "Failed to delete country", code: "DELETE_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Indicator Readings
// ============================================================================

/**
 * GET /api/countries/:id/readings
 * Get all indicator readings for a country.
 */
countriesRoutes.get("/:id/readings", async (c) => {
  try {
    const countryId = Number(c.req.param("id"));
    if (isNaN(countryId)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const startYear = c.req.query("startYear") ? Number(c.req.query("startYear")) : undefined;
    const endYear = c.req.query("endYear") ? Number(c.req.query("endYear")) : undefined;

    const conditions = [eq(indicatorReadings.countryId, countryId)];
    if (startYear) conditions.push(gte(indicatorReadings.year, startYear));
    if (endYear) conditions.push(lte(indicatorReadings.year, endYear));

    const readings = await db.query.indicatorReadings.findMany({
      where: and(...conditions),
      orderBy: [asc(indicatorReadings.year)],
    });

    return c.json({ success: true, data: readings });
  } catch (error) {
    console.error("Error fetching readings:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch readings", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * POST /api/countries/:id/readings
 * Add an indicator reading for a country.
 */
countriesRoutes.post("/:id/readings", async (c) => {
  try {
    const countryId = Number(c.req.param("id"));
    if (isNaN(countryId)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const body = await c.req.json();
    const result = CreateIndicatorReadingSchema.safeParse({ ...body, countryId });

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const [reading] = await db.insert(indicatorReadings).values(result.data).returning();
    return c.json({ success: true, data: reading }, 201);
  } catch (error) {
    console.error("Error creating reading:", error);
    return c.json(
      { success: false, error: { message: "Failed to create reading", code: "CREATE_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Trajectory Analysis
// ============================================================================

/**
 * GET /api/countries/:id/trajectory
 * Compute current trajectory classification for a country.
 * Returns the deterministic analysis result.
 */
countriesRoutes.get("/:id/trajectory", async (c) => {
  try {
    const countryId = Number(c.req.param("id"));
    if (isNaN(countryId)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const country = await db.query.countries.findFirst({
      where: eq(countries.id, countryId),
    });

    if (!country) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    const readings = await db.query.indicatorReadings.findMany({
      where: eq(indicatorReadings.countryId, countryId),
      orderBy: [asc(indicatorReadings.year)],
    });

    if (readings.length < 4) {
      return c.json({
        success: true,
        data: {
          status: "UNKNOWN",
          summary: "INSUFFICIENT_DATA",
          message: "Need at least 4 years of data for trajectory analysis",
        },
      });
    }

    // Convert to format expected by trajectory engine
    const convertedReadings = readings.map(r => ({
      year: r.year,
      judicial_independence: r.judicialIndependence ?? 0,
      press_freedom: r.pressFreedom ?? 0,
      electoral_integrity: r.electoralIntegrity ?? 0,
      civil_society_space: r.civilSocietySpace ?? 0,
      executive_constraints: r.executiveConstraints ?? 0,
    }));

    // Use default baselines (would be loaded from DB in production)
    const defaultBaselines = INDICATOR_KEYS.map(key => ({
      indicator: key,
      global_mean: 0.65,
      one_std_threshold: 0.50,
    }));

    const classification = classifyTrajectory(convertedReadings, defaultBaselines);
    const degradationVector = computeDegradationVector(convertedReadings);

    // Find analogues
    const allAnalogues = await db.query.analogueCases.findMany();
    const analogues = findAnalogues(degradationVector, allAnalogues, 3);

    return c.json({
      success: true,
      data: {
        countryId,
        countryName: country.name,
        countryCode: country.code,
        trajectory: classification,
        degradationVector,
        analogues,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error computing trajectory:", error);
    return c.json(
      { success: false, error: { message: "Failed to compute trajectory", code: "TRAJECTORY_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Batch Analysis
// ============================================================================

/**
 * POST /api/countries/batch-trajectory
 * Compute trajectory classification for all countries.
 * Useful for nightly batch jobs and dashboard overview.
 */
countriesRoutes.post("/batch-trajectory", async (c) => {
  try {
    const allCountries = await db.query.countries.findMany();
    const allAnalogues = await db.query.analogueCases.findMany();
    
    const defaultBaselines = INDICATOR_KEYS.map(key => ({
      indicator: key,
      global_mean: 0.65,
      one_std_threshold: 0.50,
    }));

    const results = await Promise.all(
      allCountries.map(async (country) => {
        const readings = await db.query.indicatorReadings.findMany({
          where: eq(indicatorReadings.countryId, country.id),
          orderBy: [asc(indicatorReadings.year)],
        });

        if (readings.length < 4) {
          return { countryId: country.id, name: country.name, status: "UNKNOWN" };
        }

        const converted = readings.map(r => ({
          year: r.year,
          judicial_independence: r.judicialIndependence ?? 0,
          press_freedom: r.pressFreedom ?? 0,
          electoral_integrity: r.electoralIntegrity ?? 0,
          civil_society_space: r.civilSocietySpace ?? 0,
          executive_constraints: r.executiveConstraints ?? 0,
        }));

        const classification = classifyTrajectory(converted, defaultBaselines);
        const vector = computeDegradationVector(converted);
        const analogues = findAnalogues(vector, allAnalogues, 3);

        // Store classification in DB
        const latestYear = readings[readings.length - 1].year;
        await db.insert(trajectoryClassifications).values({
          countryId: country.id,
          year: latestYear,
          status: classification.status,
          criticalIndicators: JSON.stringify(classification.flags.filter(f => f.status === "CRITICAL").map(f => f.indicator)),
          warningIndicators: JSON.stringify(classification.flags.filter(f => f.status === "WARNING").map(f => f.indicator)),
          decliningCount: classification.flags.filter(f => f.status !== "OK").length,
          degradationRates: JSON.stringify(classification.flags.reduce((acc, f) => ({ ...acc, [f.indicator]: f.current_value }), {})),
        });

        return {
          countryId: country.id,
          name: country.name,
          code: country.code,
          region: country.region,
          status: classification.status,
          criticalCount: classification.flags.filter(f => f.status === "CRITICAL").length,
          warningCount: classification.flags.filter(f => f.status === "WARNING").length,
          topAnalogue: analogues[0] ? analogues[0].case.country : null,
        };
      })
    );

    // Summary statistics
    const summary = {
      total: results.length,
      degrading: results.filter(r => r.status === "DEGRADING").length,
      stress: results.filter(r => r.status === "STRESS").length,
      stable: results.filter(r => r.status === "STABLE").length,
      unknown: results.filter(r => r.status === "UNKNOWN").length,
    };

    return c.json({
      success: true,
      data: {
        results,
        summary,
        computedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error computing batch trajectory:", error);
    return c.json(
      { success: false, error: { message: "Failed to compute batch trajectory", code: "BATCH_ERROR" } },
      500
    );
  }
});