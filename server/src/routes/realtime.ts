import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, desc } from "drizzle-orm";
import { db, alerts, countries } from "../db";
import { evaluateAllCountries } from "../services/alertEngine";

export const realtimeRoutes = new Hono();

// ============================================================================
// SSE Connection Manager
// ============================================================================

interface SSEClient {
  id: string;
  countryId?: number;
  connectedAt: Date;
}

const clients = new Map<string, SSEClient>();

// Broadcast to all connected clients
function broadcast(message: SSEMessage) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const [id, client] of clients) {
    try {
      // Note: In production, use a proper pub/sub system
      // This is a simplified in-memory approach
      console.log(`[SSE] Broadcasting to client ${id}: ${message.type}`);
    } catch (error) {
      console.error(`[SSE] Failed to send to client ${id}:`, error);
      clients.delete(id);
    }
  }
}

// Alert broadcast (sent to all clients)
function broadcastAlert(alert: any) {
  broadcast({
    type: "NEW_ALERT",
    data: alert,
    timestamp: new Date().toISOString(),
  });
}

// Trajectory change broadcast
function broadcastTrajectoryChange(countryId: number, previousStatus: string, newStatus: string) {
  broadcast({
    type: "TRAJECTORY_CHANGE",
    data: {
      countryId,
      previousStatus,
      newStatus,
    },
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// SSE Message Types
// ============================================================================

interface SSEMessage {
  type: "NEW_ALERT" | "TRAJECTORY_CHANGE" | "HEARTBEAT" | "EVALUATION_COMPLETE" | "COUNTRY_UPDATE";
  data?: any;
  timestamp: string;
}

// ============================================================================
// SSE Endpoints
// ============================================================================

/**
 * GET /api/realtime/alerts
 * Server-Sent Events stream for real-time alert notifications.
 * Clients subscribe to receive push notifications when new alerts are created.
 * 
 * Query params:
 *   - countryId (optional): Filter alerts for specific country
 */
realtimeRoutes.get("/alerts", async (c) => {
  const countryId = c.req.query("countryId");
  const clientId = crypto.randomUUID();

  console.log(`[SSE] Client ${clientId} connected${countryId ? ` for country ${countryId}` : ""}`);

  // Register client
  clients.set(clientId, {
    id: clientId,
    countryId: countryId ? parseInt(countryId) : undefined,
    connectedAt: new Date(),
  });

  return streamSSE(c, async (stream) => {
    // Send initial connection confirmation
    await stream.write(`data: ${JSON.stringify({ type: "CONNECTED", clientId, timestamp: new Date().toISOString() })}\n\n`);

    // Send heartbeat every 30 seconds to keep connection alive
    let heartbeatCount = 0;
    const heartbeatInterval = setInterval(async () => {
      heartbeatCount++;
      try {
        await stream.write(`data: ${JSON.stringify({ type: "HEARTBEAT", count: heartbeatCount, timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    // Check for new alerts every 10 seconds
    const alertCheckInterval = setInterval(async () => {
      try {
        // Get recent alerts (last 2 minutes)
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        
        const recentAlerts = await db.query.alerts.findMany({
          where: eq(alerts.resolved, false),
          orderBy: [desc(alerts.createdAt)],
          limit: 50,
        });

        // Get country info for each alert
        const alertsWithCountry = await Promise.all(
          recentAlerts
            .filter(a => a.countryId)
            .slice(0, 10)
            .map(async (alert) => {
              const country = await db.query.countries.findFirst({
                where: eq(countries.id, alert.countryId),
              });
              return {
                ...alert,
                country,
              };
            })
        );

        // Send alert summary
        await stream.write(
          `data: ${JSON.stringify({ 
            type: "ALERT_SUMMARY", 
            data: {
              total: recentAlerts.length,
              critical: recentAlerts.filter(a => a.priority === "CRITICAL").length,
              warning: recentAlerts.filter(a => a.priority === "WARNING").length,
              recent: alertsWithCountry.slice(0, 5),
            },
            timestamp: new Date().toISOString()
          })}\n\n`
        );
      } catch (error) {
        console.error("[SSE] Alert check failed:", error);
      }
    }, 10000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      console.log(`[SSE] Client ${clientId} disconnected`);
      clearInterval(heartbeatInterval);
      clearInterval(alertCheckInterval);
      clients.delete(clientId);
    });
  });
});

/**
 * GET /api/realtime/trajectory/:countryId
 * SSE stream for trajectory changes on a specific country.
 */
realtimeRoutes.get("/trajectory/:countryId", async (c) => {
  const countryId = parseInt(c.req.param("countryId"));
  const clientId = crypto.randomUUID();

  console.log(`[SSE] Client ${clientId} subscribed to country ${countryId}`);

  return streamSSE(c, async (stream) => {
    // Send initial status
    const country = await db.query.countries.findFirst({
      where: eq(countries.id, countryId),
    });

    const latestClassification = await db.query.trajectoryClassifications.findFirst({
      where: eq(db.query.trajectoryClassifications.target.countryId, countryId),
      orderBy: [desc(db.query.trajectoryClassifications.target.year)],
    });

    await stream.write(`data: ${JSON.stringify({
      type: "CONNECTED",
      clientId,
      country: country?.name,
      currentStatus: latestClassification?.status ?? "UNKNOWN",
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await stream.write(`data: ${JSON.stringify({ type: "HEARTBEAT", timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    stream.onAbort(() => {
      console.log(`[SSE] Client ${clientId} disconnected from country ${countryId}`);
      clearInterval(heartbeatInterval);
    });
  });
});

/**
 * GET /api/realtime/dashboard
 * SSE stream for dashboard-wide updates.
 * Subscribers receive notifications for:
 *   - New alerts
 *   - Trajectory changes
 *   - Evaluation completions
 */
realtimeRoutes.get("/dashboard", async (c) => {
  const clientId = crypto.randomUUID();

  console.log(`[SSE] Dashboard client ${clientId} connected`);

  return streamSSE(c, async (stream) => {
    // Send connection confirmation
    await stream.write(`data: ${JSON.stringify({
      type: "CONNECTED",
      clientId,
      subscribedTo: ["alerts", "trajectories", "evaluations"],
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        // Get current summary
        const allAlerts = await db.query.alerts.findMany();
        const activeAlerts = allAlerts.filter(a => !a.resolved);

        await stream.write(`data: ${JSON.stringify({
          type: "DASHBOARD_SUMMARY",
          data: {
            activeAlerts: activeAlerts.length,
            criticalAlerts: activeAlerts.filter(a => a.priority === "CRITICAL").length,
            connectedClients: clients.size,
          },
          timestamp: new Date().toISOString()
        })}\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 60000); // Every minute

    stream.onAbort(() => {
      console.log(`[SSE] Dashboard client ${clientId} disconnected`);
      clearInterval(heartbeatInterval);
    });
  });
});

// ============================================================================
// Webhook Trigger Endpoints (for internal use)
// ============================================================================

/**
 * POST /api/realtime/trigger-evaluation
 * Manually trigger a trajectory evaluation and broadcast results.
 * Useful for testing or manual refreshes.
 */
realtimeRoutes.post("/trigger-evaluation", async (c) => {
  try {
    console.log("[SSE] Manual evaluation triggered");
    
    const result = await evaluateAllCountries();

    // Broadcast evaluation complete
    broadcast({
      type: "EVALUATION_COMPLETE",
      data: {
        evaluated: result.evaluated,
        newAlerts: result.newAlerts,
        results: result.results,
      },
      timestamp: new Date().toISOString(),
    });

    // Broadcast individual trajectory changes
    for (const r of result.results) {
      if (r.previousStatus && r.previousStatus !== r.newStatus) {
        broadcastTrajectoryChange(r.countryId, r.previousStatus, r.newStatus);
      }
    }

    return c.json({
      success: true,
      data: {
        evaluated: result.evaluated,
        newAlerts: result.newAlerts,
        clearedAlerts: result.clearedAlerts,
      },
    });
  } catch (error) {
    console.error("[SSE] Evaluation failed:", error);
    return c.json(
      { success: false, error: { message: "Evaluation failed" } },
      500
    );
  }
});

/**
 * POST /api/realtime/broadcast-alert
 * Manually broadcast an alert to all connected clients.
 */
realtimeRoutes.post("/broadcast-alert", async (c) => {
  try {
    const body = await c.req.json();
    const { alertId } = body;

    if (!alertId) {
      return c.json({ success: false, error: { message: "alertId required" } }, 400);
    }

    const alert = await db.query.alerts.findFirst({
      where: eq(alerts.id, alertId),
    });

    if (!alert) {
      return c.json({ success: false, error: { message: "Alert not found" } }, 404);
    }

    const country = await db.query.countries.findFirst({
      where: eq(countries.id, alert.countryId),
    });

    broadcastAlert({
      ...alert,
      country,
    });

    return c.json({ success: true, data: { broadcast: true } });
  } catch (error) {
    console.error("[SSE] Broadcast failed:", error);
    return c.json(
      { success: false, error: { message: "Broadcast failed" } },
      500
    );
  }
});

// ============================================================================
// Connection Status Endpoint
// ============================================================================

/**
 * GET /api/realtime/status
 * Returns current SSE connection status and statistics.
 */
realtimeRoutes.get("/status", async (c) => {
  const allAlerts = await db.query.alerts.findMany();
  const activeAlerts = allAlerts.filter(a => !a.resolved);

  return c.json({
    success: true,
    data: {
      connectedClients: clients.size,
      clientDetails: Array.from(clients.values()).map(c => ({
        id: c.id,
        countryId: c.countryId,
        connectedAt: c.connectedAt.toISOString(),
        connectedSeconds: Math.floor((Date.now() - c.connectedAt.getTime()) / 1000),
      })),
      alertSummary: {
        totalActive: activeAlerts.length,
        critical: activeAlerts.filter(a => a.priority === "CRITICAL").length,
        warning: activeAlerts.filter(a => a.priority === "WARNING").length,
        info: activeAlerts.filter(a => a.priority === "INFO").length,
      },
      lastEvaluation: new Date().toISOString(),
    },
  });
});

// ============================================================================
// Export Client Manager (for use by alert engine)
// ============================================================================

export { broadcast, broadcastAlert, broadcastTrajectoryChange };