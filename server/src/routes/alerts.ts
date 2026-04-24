import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, asc, and, gte, lte, inArray } from "drizzle-orm";
import { db, alerts, countries } from "../db";
import { createAlert, AlertType, AlertPriority } from "../services/alertEngine";

export const alertsRoutes = new Hono();

// ============================================================================
// Request Validation Schemas
// ============================================================================

const ResolveAlertSchema = z.object({
  resolvedBy: z.string().optional(),
  resolutionNotes: z.string().optional(),
});

const CreateAlertSchema = z.object({
  countryId: z.number().int().positive(),
  alertType: z.enum(["TRAJECTORY_CHANGE", "INDICATOR_CRITICAL", "RAPID_DECLINE", "ANALOGUE_MATCH"]),
  priority: z.enum(["CRITICAL", "WARNING", "INFO"]).optional(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  affectedIndicators: z.array(z.string()).optional(),
  previousValue: z.string().optional(),
  newValue: z.string().optional(),
});

// ============================================================================
// Alert CRUD
// ============================================================================

/**
 * GET /api/alerts
 * List all alerts with filtering and pagination.
 * Supports filtering by country, type, priority, and resolution status.
 */
alertsRoutes.get("/", async (c) => {
  try {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = (page - 1) * limit;
    
    const countryId = c.req.query("countryId") ? Number(c.req.query("countryId")) : undefined;
    const alertType = c.req.query("type") as AlertType | undefined;
    const priority = c.req.query("priority") as AlertPriority | undefined;
    const resolved = c.req.query("resolved") === "true" ? true : c.req.query("resolved") === "false" ? false : undefined;
    const startDate = c.req.query("startDate") ? new Date(c.req.query("startDate")!) : undefined;
    const endDate = c.req.query("endDate") ? new Date(c.req.query("endDate")!) : undefined;

    // Build query conditions
    const conditions = [];
    if (countryId) conditions.push(eq(alerts.countryId, countryId));
    if (alertType) conditions.push(eq(alerts.alertType, alertType));
    if (priority) conditions.push(eq(alerts.priority, priority));
    if (resolved !== undefined) conditions.push(eq(alerts.resolved, resolved));
    if (startDate) conditions.push(gte(alerts.createdAt, startDate));
    if (endDate) conditions.push(lte(alerts.createdAt, endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch alerts with country info
    const allAlerts = await db.query.alerts.findMany({
      where: whereClause,
      orderBy: [desc(alerts.createdAt)],
    });

    // Attach country info
    const alertsWithCountry = await Promise.all(
      allAlerts.map(async (alert) => {
        const country = await db.query.countries.findFirst({
          where: eq(countries.id, alert.countryId),
        });
        return { ...alert, country };
      })
    );

    const paginated = alertsWithCountry.slice(offset, offset + limit);

    return c.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total: allAlerts.length,
        totalPages: Math.ceil(allAlerts.length / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch alerts", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * GET /api/alerts/active
 * Get all unresolved alerts, grouped by priority.
 * Primary endpoint for the alert panel on the frontend.
 */
alertsRoutes.get("/active", async (c) => {
  try {
    const activeAlerts = await db.query.alerts.findMany({
      where: eq(alerts.resolved, false),
      orderBy: [desc(alerts.createdAt)],
    });

    // Group by priority
    const grouped = {
      CRITICAL: activeAlerts.filter(a => a.priority === "CRITICAL"),
      WARNING: activeAlerts.filter(a => a.priority === "WARNING"),
      INFO: activeAlerts.filter(a => a.priority === "INFO"),
    };

    // Attach country info
    const withCountry = await Promise.all(
      activeAlerts.map(async (alert) => {
        const country = await db.query.countries.findFirst({
          where: eq(countries.id, alert.countryId),
        });
        return { ...alert, country };
      })
    );

    return c.json({
      success: true,
      data: {
        alerts: withCountry,
        summary: {
          total: activeAlerts.length,
          critical: grouped.CRITICAL.length,
          warning: grouped.WARNING.length,
          info: grouped.INFO.length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching active alerts:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch active alerts", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * GET /api/alerts/:id
 * Get a single alert by ID.
 */
alertsRoutes.get("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid alert ID", code: "INVALID_ID" } }, 400);
    }

    const alert = await db.query.alerts.findFirst({
      where: eq(alerts.id, id),
    });

    if (!alert) {
      return c.json({ success: false, error: { message: "Alert not found", code: "NOT_FOUND" } }, 404);
    }

    const country = await db.query.countries.findFirst({
      where: eq(countries.id, alert.countryId),
    });

    return c.json({
      success: true,
      data: { ...alert, country },
    });
  } catch (error) {
    console.error("Error fetching alert:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch alert", code: "FETCH_ERROR" } },
      500
    );
  }
});

/**
 * POST /api/alerts
 * Create a new alert manually.
 * Typically alerts are auto-generated, but this allows manual entry.
 */
alertsRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const result = CreateAlertSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const alert = await createAlert({
      countryId: result.data.countryId,
      alertType: result.data.alertType,
      priority: result.data.priority ?? "WARNING",
      title: result.data.title,
      message: result.data.message,
      affectedIndicators: result.data.affectedIndicators,
      previousValue: result.data.previousValue,
      newValue: result.data.newValue,
    });

    return c.json({ success: true, data: alert }, 201);
  } catch (error) {
    console.error("Error creating alert:", error);
    return c.json(
      { success: false, error: { message: "Failed to create alert", code: "CREATE_ERROR" } },
      500
    );
  }
});

/**
 * PUT /api/alerts/:id/resolve
 * Mark an alert as resolved.
 */
alertsRoutes.put("/:id/resolve", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid alert ID", code: "INVALID_ID" } }, 400);
    }

    const body = await c.req.json();
    const result = ResolveAlertSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        { success: false, error: { message: "Validation failed", code: "VALIDATION_ERROR", details: result.error.flatten() } },
        400
      );
    }

    const updated = await db.update(alerts)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: result.data.resolvedBy,
        resolutionNotes: result.data.resolutionNotes,
      })
      .where(eq(alerts.id, id))
      .returning();

    if (updated.length === 0) {
      return c.json({ success: false, error: { message: "Alert not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error resolving alert:", error);
    return c.json(
      { success: false, error: { message: "Failed to resolve alert", code: "UPDATE_ERROR" } },
      500
    );
  }
});

/**
 * POST /api/alerts/evaluate
 * Trigger evaluation of all countries for new alerts.
 * This is typically called by a scheduled job, but can be invoked manually.
 */
alertsRoutes.post("/evaluate", async (c) => {
  try {
    const { evaluateAllCountries } = await import("../services/alertEngine");
    const results = await evaluateAllCountries();

    return c.json({
      success: true,
      data: {
        evaluated: results.evaluated,
        newAlerts: results.newAlerts,
        clearedAlerts: results.clearedAlerts,
        evaluatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error evaluating alerts:", error);
    return c.json(
      { success: false, error: { message: "Failed to evaluate alerts", code: "EVALUATE_ERROR" } },
      500
    );
  }
});

/**
 * DELETE /api/alerts/:id
 * Delete an alert (admin operation).
 */
alertsRoutes.delete("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, error: { message: "Invalid alert ID", code: "INVALID_ID" } }, 400);
    }

    const deleted = await db.delete(alerts).where(eq(alerts.id, id)).returning();

    if (deleted.length === 0) {
      return c.json({ success: false, error: { message: "Alert not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({ success: true, data: { deleted: true, id } });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return c.json(
      { success: false, error: { message: "Failed to delete alert", code: "DELETE_ERROR" } },
      500
    );
  }
});

// ============================================================================
// Alert Statistics
// ============================================================================

/**
 * GET /api/alerts/stats
 * Get alert statistics for the dashboard overview.
 */
alertsRoutes.get("/stats", async (c) => {
  try {
    const allAlerts = await db.query.alerts.findMany();

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const activeAlerts = allAlerts.filter(a => !a.resolved);
    const criticalActive = activeAlerts.filter(a => a.priority === "CRITICAL");

    const last24h = allAlerts.filter(a => a.createdAt >= oneDayAgo);
    const last7d = allAlerts.filter(a => a.createdAt >= oneWeekAgo);

    // Get country breakdown
    const countryCounts = activeAlerts.reduce((acc, alert) => {
      acc[alert.countryId] = (acc[alert.countryId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const topCountries = await Promise.all(
      Object.entries(countryCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(async ([countryId, count]) => {
          const country = await db.query.countries.findFirst({
            where: eq(countries.id, Number(countryId)),
          });
          return { country, count };
        })
    );

    return c.json({
      success: true,
      data: {
        overview: {
          totalActive: activeAlerts.length,
          criticalActive: criticalActive.length,
          resolvedTotal: allAlerts.filter(a => a.resolved).length,
        },
        recent: {
          last24h: last24h.length,
          last7d: last7d.length,
        },
        topCountries,
      },
    });
  } catch (error) {
    console.error("Error fetching alert stats:", error);
    return c.json(
      { success: false, error: { message: "Failed to fetch stats", code: "STATS_ERROR" } },
      500
    );
  }
});