import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, aipAnalysisResults, countries } from "../db";
import { runAIPAnalysis, buildUserMessage, AIPResult } from "../services/aipAnalysis";
import { computeDegradationVector, findAnalogues, INDICATOR_KEYS, classifyTrajectory } from "../routes/trajectoryEngine";

export const aipRoutes = new Hono();

// ============================================================================
// Request Validation Schemas
// ============================================================================

const RunAnalysisSchema = z.object({
  countryId: z.number().int().positive(),
  useStream: z.boolean().optional().default(false),
});

// ============================================================================
// AIP Analysis
// ============================================================================

/**
 * POST /api/aip/analyze
 * Run AI-powered analysis for a specific country.
 * Returns trajectory narrative, risk factors, and intervention recommendations.
 */
aipRoutes.post("/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const result = RunAnalysisSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const { countryId, useStream } = result.data;

    // Fetch country data
    const country = await db.query.countries.findFirst({
      where: eq(countries.id, countryId),
    });

    if (!country) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    // Get indicator readings
    const readings = await db.query.indicatorReadings.findMany({
      where: eq(aipAnalysisResults.countryId, countryId),
      orderBy: [{ column: "year", asc: true }],
    });

    // Fallback: use country readings from indicator_readings table
    const { indicatorReadings: irTable } = await import("../db/schema");
    const indicatorReadings = await db.query.indicatorReadings.findMany({
      where: eq(indicatorReadings.countryId, countryId),
    });

    if (indicatorReadings.length < 4) {
      return c.json({
        success: false,
        error: { message: "Insufficient data for analysis (need at least 4 years)", code: "INSUFFICIENT_DATA" },
      }, 400);
    }

    // Compute trajectory
    const convertedReadings = indicatorReadings.map(r => ({
      year: r.year,
      judicial_independence: r.judicialIndependence ?? 0,
      press_freedom: r.pressFreedom ?? 0,
      electoral_integrity: r.electoralIntegrity ?? 0,
      civil_society_space: r.civilSocietySpace ?? 0,
      executive_constraints: r.executiveConstraints ?? 0,
    }));

    const defaultBaselines = INDICATOR_KEYS.map(key => ({
      indicator: key,
      global_mean: 0.65,
      one_std_threshold: 0.50,
    }));

    const trajectory = classifyTrajectory(convertedReadings, defaultBaselines);
    const degradationVector = computeDegradationVector(convertedReadings);

    // Get analogues
    const allAnalogues = await db.query.analogueCases.findMany();
    const analogues = findAnalogues(degradationVector, allAnalogues, 3);

    // Current indicators (latest reading)
    const latestReading = indicatorReadings[indicatorReadings.length - 1];
    const currentIndicators = {
      judicial_independence: latestReading.judicialIndependence ?? 0,
      press_freedom: latestReading.pressFreedom ?? 0,
      electoral_integrity: latestReading.electoralIntegrity ?? 0,
      civil_society_space: latestReading.civilSocietySpace ?? 0,
      executive_constraints: latestReading.executiveConstraints ?? 0,
    };

    const criticalFlags = trajectory.flags
      .filter(f => f.status === "CRITICAL")
      .map(f => f.indicator);

    const startTime = Date.now();

    // Run analysis
    const analysisResult = await runAIPAnalysis({
      country: country.name,
      currentIndicators,
      trajectoryClass: trajectory.status,
      criticalFlags,
      topAnalogues: analogues,
    });

    const processingTimeMs = Date.now() - startTime;

    // Store result in database
    const [savedResult] = await db.insert(aipAnalysisResults).values({
      countryId,
      trajectoryStatus: trajectory.status,
      criticalFlags: JSON.stringify(criticalFlags),
      topAnalogues: JSON.stringify(analogues.map(a => ({ country: a.case.country, similarity: a.similarity }))),
      trajectoryNarrative: analysisResult.trajectory_narrative,
      primaryRiskFactor: analysisResult.primary_risk_factor,
      analogueReasoning: analysisResult.analogue_reasoning,
      recommendedInterventions: JSON.stringify(analysisResult.recommended_interventions),
      confidence: analysisResult.confidence,
      analystAction: analysisResult.analyst_action,
      processingTimeMs,
      modelUsed: "MiniMax-M2.5",
    }).returning();

    return c.json({
      success: true,
      data: {
        ...analysisResult,
        id: savedResult.id,
        countryId,
        countryName: country.name,
        processingTime: `${processingTimeMs}ms`,
        timestamp: savedResult.createdAt,
      },
    });
  } catch (error) {
    console.error("Error running AIP analysis:", error);
    return c.json(
      { success: false, error: { message: "Failed to run analysis", code: "ANALYSIS_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Stream Analysis (SSE)
// ============================================================================

/**
 * POST /api/aip/analyze/stream
 * Run AI analysis with Server-Sent Events streaming.
 * Returns JSON chunks as they're generated by the LLM.
 */
aipRoutes.post("/analyze/stream", async (c) => {
  try {
    const body = await c.req.json();
    const result = RunAnalysisSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const { countryId } = result.data;

    // Fetch country
    const country = await db.query.countries.findFirst({
      where: eq(countries.id, countryId),
    });

    if (!country) {
      return c.json({ success: false, error: { message: "Country not found", code: "NOT_FOUND" } }, 404);
    }

    // Get indicator readings
    const indicatorReadings = await db.query.indicatorReadings.findMany({
      where: eq(indicatorReadings.countryId, countryId),
    });

    if (indicatorReadings.length < 4) {
      return c.json({
        success: false,
        error: { message: "Insufficient data for analysis", code: "INSUFFICIENT_DATA" },
      }, 400);
    }

    // Compute trajectory (same as above)
    const convertedReadings = indicatorReadings.map(r => ({
      year: r.year,
      judicial_independence: r.judicialIndependence ?? 0,
      press_freedom: r.pressFreedom ?? 0,
      electoral_integrity: r.electoralIntegrity ?? 0,
      civil_society_space: r.civilSocietySpace ?? 0,
      executive_constraints: r.executiveConstraints ?? 0,
    }));

    const defaultBaselines = INDICATOR_KEYS.map(key => ({
      indicator: key,
      global_mean: 0.65,
      one_std_threshold: 0.50,
    }));

    const trajectory = classifyTrajectory(convertedReadings, defaultBaselines);
    const degradationVector = computeDegradationVector(convertedReadings);
    const allAnalogues = await db.query.analogueCases.findMany();
    const analogues = findAnalogues(degradationVector, allAnalogues, 3);

    const latestReading = indicatorReadings[indicatorReadings.length - 1];
    const currentIndicators = {
      judicial_independence: latestReading.judicialIndependence ?? 0,
      press_freedom: latestReading.pressFreedom ?? 0,
      electoral_integrity: latestReading.electoralIntegrity ?? 0,
      civil_society_space: latestReading.civilSocietySpace ?? 0,
      executive_constraints: latestReading.executiveConstraints ?? 0,
    };

    const criticalFlags = trajectory.flags
      .filter(f => f.status === "CRITICAL")
      .map(f => f.indicator);

    // Stream response
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const { runAIPAnalysisStream } = await import("../services/aipAnalysis");
    
    await runAIPAnalysisStream(
      {
        country: country.name,
        currentIndicators,
        trajectoryClass: trajectory.status,
        criticalFlags,
        topAnalogues: analogues,
      },
      (chunk) => {
        c.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

    c.write("data: [DONE]\n\n");
    return c.body(null);
  } catch (error) {
    console.error("Error in stream analysis:", error);
    c.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Stream failed" })}\n\n`);
    return c.body(null);
  }
});

// ============================================================================
// Analysis History
// ============================================================================

/**
 * GET /api/aip/history/:countryId
 * Get analysis history for a country.
 */
aipRoutes.get("/history/:countryId", async (c) => {
  try {
    const countryId = Number(c.req.param("countryId"));
    if (isNaN(countryId)) {
      return c.json({ success: false, error: { message: "Invalid country ID", code: "INVALID_ID" } }, 400);
    }

    const history = await db.query.aipAnalysisResults.findMany({
      where: eq(aipAnalysisResults.countryId, countryId),
      orderBy: [{ column: "createdAt", desc: true }],
      limit: 20,
    });

    return c.json({ success: true, data: history });
  } catch (error) {
    console.error("Error fetching analysis history:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch history", code: "FETCH_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Batch Analysis
// ============================================================================

/**
 * POST /api/aip/batch
 * Run analysis for all DEGRADING countries.
 * Used for nightly batch jobs.
 */
aipRoutes.post("/batch", async (c) => {
  try {
    // Get all DEGRADING countries
    const { trajectoryClassifications } = await import("../db/schema");
    const degrading = await db.query.trajectoryClassifications.findMany({
      where: eq(trajectoryClassifications.status, "DEGRADING"),
    });

    const countryIds = [...new Set(degrading.map(t => t.countryId))];

    const results = await Promise.allSettled(
      countryIds.map(async (countryId) => {
        const country = await db.query.countries.findFirst({
          where: eq(countries.id, countryId),
        });
        
        if (!country) return { countryId, success: false, error: "Country not found" };

        // Trigger analysis via internal call
        const analysis = await runAIPAnalysisForCountry(countryId, country.name);
        return { countryId, countryName: country.name, success: true, result: analysis };
      })
    );

    const succeeded = results.filter(r => r.status === "fulfilled" && r.value.success).length;
    const failed = results.length - succeeded;

    return c.json({
      success: true,
      data: {
        total: results.length,
        succeeded,
        failed,
        results: results.map(r => 
          r.status === "fulfilled" 
            ? { countryName: r.value.countryName, success: r.value.success }
            : { error: "Failed" }
        ),
      },
    });
  } catch (error) {
    console.error("Error in batch analysis:", error);
    return c.json(
      { success: false, error: { message: "Failed to run batch analysis", code: "BATCH_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

async function runAIPAnalysisForCountry(countryId: number, countryName: string): Promise<AIPResult | null> {
  const indicatorReadings = await db.query.indicatorReadings.findMany({
    where: eq(indicatorReadings.countryId, countryId),
  });

  if (indicatorReadings.length < 4) return null;

  const convertedReadings = indicatorReadings.map(r => ({
    year: r.year,
    judicial_independence: r.judicialIndependence ?? 0,
    press_freedom: r.pressFreedom ?? 0,
    electoral_integrity: r.electoralIntegrity ?? 0,
    civil_society_space: r.civilSocietySpace ?? 0,
    executive_constraints: r.executiveConstraints ?? 0,
  }));

  const defaultBaselines = INDICATOR_KEYS.map(key => ({
    indicator: key,
    global_mean: 0.65,
    one_std_threshold: 0.50,
  }));

  const trajectory = classifyTrajectory(convertedReadings, defaultBaselines);
  const degradationVector = computeDegradationVector(convertedReadings);
  const allAnalogues = await db.query.analogueCases.findMany();
  const analogues = findAnalogues(degradationVector, allAnalogues, 3);

  const latestReading = indicatorReadings[indicatorReadings.length - 1];
  const currentIndicators = {
    judicial_independence: latestReading.judicialIndependence ?? 0,
    press_freedom: latestReading.pressFreedom ?? 0,
    electoral_integrity: latestReading.electoralIntegrity ?? 0,
    civil_society_space: latestReading.civilSocietySpace ?? 0,
    executive_constraints: latestReading.executiveConstraints ?? 0,
  };

  const criticalFlags = trajectory.flags
    .filter(f => f.status === "CRITICAL")
    .map(f => f.indicator);

  const { runAIPAnalysis } = await import("../services/aipAnalysis");
  return runAIPAnalysis({
    country: countryName,
    currentIndicators,
    trajectoryClass: trajectory.status,
    criticalFlags,
    topAnalogues: analogues,
  });
}

// Type for indicator readings (imported from schema)
import { indicatorReadings } from "../db/schema";