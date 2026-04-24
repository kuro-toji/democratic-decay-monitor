import { Hono } from "hono";
import { db } from "../db";

export const healthRoutes = new Hono();

// ============================================================================
// Health Check
// ============================================================================

/**
 * GET /api/health
 * Returns server status and basic statistics.
 * Used for deployment monitoring and readiness checks.
 */
healthRoutes.get("/", (c) => {
  const start = Date.now();

  try {
    // Test database connectivity
    const dbOk = db.query.countries.findMany({ limit: 1 }).then(() => true).catch(() => false);

    return c.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${Date.now() - start}ms`,
      version: process.env.npm_package_version ?? "1.0.0",
      environment: process.env.NODE_ENV ?? "development",
      services: {
        database: dbOk ? "connected" : "disconnected",
        api: "operational",
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      503
    );
  }
});

// ============================================================================
// Readiness Check
// ============================================================================

/**
 * GET /api/health/ready
 * Returns whether the server is ready to accept traffic.
 */
healthRoutes.get("/ready", async (c) => {
  try {
    // Check database
    await db.query.countries.findMany({ limit: 1 });

    return c.json({
      success: true,
      ready: true,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return c.json(
      {
        success: false,
        ready: false,
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
});

// ============================================================================
// Liveness Check
// ============================================================================

/**
 * GET /api/health/live
 * Simple liveness probe - returns 200 if server process is alive.
 * Does not check dependencies (use /ready for full checks).
 */
healthRoutes.get("/live", (c) => {
  return c.json({
    success: true,
    alive: true,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
});