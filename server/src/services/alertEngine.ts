import { db, alerts, countries, indicatorReadings, trajectoryClassifications } from "../db";
import { eq, desc } from "drizzle-orm";
import { classifyTrajectory, computeDegradationVector, INDICATOR_KEYS, type TrajectoryStatus } from "../routes/trajectoryEngine";

// ============================================================================
// Types
// ============================================================================

export type AlertType = "TRAJECTORY_CHANGE" | "INDICATOR_CRITICAL" | "RAPID_DECLINE" | "ANALOGUE_MATCH";
export type AlertPriority = "CRITICAL" | "WARNING" | "INFO";

export interface CreateAlertParams {
  countryId: number;
  alertType: AlertType;
  priority?: AlertPriority;
  title: string;
  message: string;
  affectedIndicators?: string[];
  previousValue?: string;
  newValue?: string;
}

interface EvaluationResult {
  countryId: number;
  countryName: string;
  previousStatus: TrajectoryStatus | null;
  newStatus: TrajectoryStatus;
  newAlerts: number;
  clearedAlerts: number;
}

// ============================================================================
// Default Baselines
// ============================================================================

// These would typically come from a baselines table in the database
const DEFAULT_BASELINES = INDICATOR_KEYS.map(key => ({
  indicator: key,
  global_mean: 0.65,
  one_std_threshold: 0.50,
}));

// ============================================================================
// Alert Creation
// ============================================================================

/**
 * Creates a new alert in the database.
 * Ensures no duplicate alerts for the same country + type + day.
 */
export async function createAlert(params: CreateAlertParams): Promise<typeof alerts.$inferSelect> {
  const { priority = "WARNING" } = params;

  // Check for recent duplicate (within last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.query.alerts.findFirst({
    where: eq(alerts.countryId, params.countryId),
  });

  // Simple deduplication: if same country + type exists in last 24h, skip
  const recentAlerts = await db.query.alerts.findMany();
  const duplicate = recentAlerts.find(
    a => a.countryId === params.countryId &&
         a.alertType === params.alertType &&
         a.createdAt >= oneDayAgo
  );

  if (duplicate) {
    console.log(`Skipping duplicate alert: ${params.alertType} for country ${params.countryId}`);
    return duplicate;
  }

  const [alert] = await db.insert(alerts).values({
    countryId: params.countryId,
    alertType: params.alertType,
    priority,
    title: params.title,
    message: params.message,
    affectedIndicators: params.affectedIndicators ? JSON.stringify(params.affectedIndicators) : null,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue ?? null,
  }).returning();

  console.log(`🔔 Alert created: [${priority}] ${params.title} (${params.alertType})`);
  return alert;
}

// ============================================================================
// Alert Evaluation
// ============================================================================

/**
 * Evaluates all countries and generates alerts based on trajectory changes.
 * This is the core of the alerting engine.
 */
export async function evaluateAllCountries(): Promise<{
  evaluated: number;
  newAlerts: number;
  clearedAlerts: number;
  results: EvaluationResult[];
}> {
  const allCountries = await db.query.countries.findMany();
  const results: EvaluationResult[] = [];
  let totalNewAlerts = 0;
  let totalClearedAlerts = 0;

  for (const country of allCountries) {
    const result = await evaluateCountry(country.id, country.name);
    results.push(result);
    totalNewAlerts += result.newAlerts;
    totalClearedAlerts += result.clearedAlerts;
  }

  return {
    evaluated: allCountries.length,
    newAlerts: totalNewAlerts,
    clearedAlerts: totalClearedAlerts,
    results,
  };
}

/**
 * Evaluates a single country for alert conditions.
 * Checks for: trajectory changes, critical indicators, rapid declines.
 */
export async function evaluateCountry(countryId: number, countryName: string): Promise<EvaluationResult> {
  const readings = await db.query.indicatorReadings.findMany({
    where: eq(indicatorReadings.countryId, countryId),
    orderBy: [desc(indicatorReadings.year)],
  });

  if (readings.length < 4) {
    return {
      countryId,
      countryName,
      previousStatus: null,
      newStatus: "STABLE" as TrajectoryStatus,
      newAlerts: 0,
      clearedAlerts: 0,
    };
  }

  // Convert to trajectory engine format
  const convertedReadings = readings.map(r => ({
    year: r.year,
    judicial_independence: r.judicialIndependence ?? 0,
    press_freedom: r.pressFreedom ?? 0,
    electoral_integrity: r.electoralIntegrity ?? 0,
    civil_society_space: r.civilSocietySpace ?? 0,
    executive_constraints: r.executiveConstraints ?? 0,
  }));

  // Get previous classification
  const prevClassification = await db.query.trajectoryClassifications.findFirst({
    where: eq(trajectoryClassifications.countryId, countryId),
    orderBy: [desc(trajectoryClassifications.year)],
  });

  const previousStatus = prevClassification?.status as TrajectoryStatus | null;
  const classification = classifyTrajectory(convertedReadings, DEFAULT_BASELINES);
  const newStatus = classification.status;
  let newAlerts = 0;
  let clearedAlerts = 0;

  // Update classification record
  await db.insert(trajectoryClassifications).values({
    countryId,
    year: convertedReadings[convertedReadings.length - 1].year,
    status: newStatus,
    criticalIndicators: JSON.stringify(classification.flags.filter(f => f.status === "CRITICAL").map(f => f.indicator)),
    warningIndicators: JSON.stringify(classification.flags.filter(f => f.status === "WARNING").map(f => f.indicator)),
    decliningCount: classification.flags.filter(f => f.status !== "OK").length,
    degradationRates: JSON.stringify(classification.flags.reduce((acc, f) => ({ ...acc, [f.indicator]: f.current_value }), {})),
  });

  // Check for TRAJECTORY_CHANGE
  if (previousStatus && previousStatus !== newStatus) {
    const priority = newStatus === "DEGRADING" ? "CRITICAL" : newStatus === "STRESS" ? "WARNING" : "INFO";
    
    await createAlert({
      countryId,
      alertType: "TRAJECTORY_CHANGE",
      priority,
      title: `${countryName}: Trajectory changed from ${previousStatus} to ${newStatus}`,
      message: `The democratic trajectory for ${countryName} has changed from ${previousStatus} to ${newStatus}. ${
        newStatus === "DEGRADING" 
          ? "Immediate attention required. Multiple indicators show sustained decline."
          : newStatus === "STRESS"
          ? "Early warning signs detected. Monitor closely."
          : "Situation has stabilized."
      }`,
      previousValue: previousStatus,
      newValue: newStatus,
    });
    newAlerts++;
  }

  // Check for INDICATOR_CRITICAL (new critical indicators)
  const criticalFlags = classification.flags.filter(f => f.status === "CRITICAL");
  for (const flag of criticalFlags) {
    // Check if this is a new critical state (not previously critical)
    const wasCritical = prevClassification?.criticalIndicators?.includes(flag.indicator);
    if (!wasCritical) {
      await createAlert({
        countryId,
        alertType: "INDICATOR_CRITICAL",
        priority: "CRITICAL",
        title: `${countryName}: ${flag.indicator.replace("_", " ")} at critical level`,
        message: `The ${flag.indicator.replace("_", " ")} indicator has fallen below the critical threshold (${
          (flag.current_value * 100).toFixed(1)}% vs ${(flag.threshold * 100).toFixed(1)}% threshold). This indicates structural democratic erosion.`,
        affectedIndicators: [flag.indicator],
        newValue: flag.current_value.toString(),
      });
      newAlerts++;
    }
  }

  // Check for RAPID_DECLINE (>20% drop in single year)
  if (readings.length >= 2) {
    const latest = readings[0];
    const previous = readings[1];
    
    for (const key of INDICATOR_KEYS) {
      const latestVal = latest[key] ?? 0;
      const prevVal = previous[key] ?? 0;
      
      if (prevVal > 0) {
        const declineRate = (prevVal - latestVal) / prevVal;
        if (declineRate > 0.20) {
          await createAlert({
            countryId,
            alertType: "RAPID_DECLINE",
            priority: "WARNING",
            title: `${countryName}: Rapid decline in ${key.replace("_", " ")}`,
            message: `${key.replace("_", " ")} dropped ${(declineRate * 100).toFixed(1)}% in the last year (${(prevVal * 100).toFixed(1)}% → ${(latestVal * 100).toFixed(1)}%). This exceeds the 20% rapid decline threshold.`,
            affectedIndicators: [key],
            previousValue: prevVal.toString(),
            newValue: latestVal.toString(),
          });
          newAlerts++;
        }
      }
    }
  }

  // Auto-resolve alerts if situation improves
  if (previousStatus === "DEGRADING" && newStatus === "STABLE") {
    const activeAlerts = await db.query.alerts.findMany({
      where: eq(alerts.countryId, countryId),
    });
    
    for (const alert of activeAlerts) {
      if (!alert.resolved && alert.alertType === "TRAJECTORY_CHANGE") {
        await db.update(alerts)
          .set({
            resolved: true,
            resolvedAt: new Date(),
            resolutionNotes: `Auto-resolved: Trajectory improved to ${newStatus}`,
          })
          .where(eq(alerts.id, alert.id));
        clearedAlerts++;
      }
    }
  }

  return {
    countryId,
    countryName,
    previousStatus,
    newStatus,
    newAlerts,
    clearedAlerts,
  };
}

// ============================================================================
// Alert Notifications (Placeholder)
// ============================================================================

/**
 * Sends notifications for new alerts.
 * Currently logs to console; integrate with email/webhook providers.
 */
export async function sendAlertNotification(alert: typeof alerts.$inferSelect): Promise<void> {
  const country = await db.query.countries.findFirst({
    where: eq(countries.id, alert.countryId),
  });

  const notification = {
    type: "ALERT",
    priority: alert.priority,
    title: alert.title,
    message: alert.message,
    country: country?.name ?? "Unknown",
    timestamp: alert.createdAt.toISOString(),
    url: `/alerts/${alert.id}`,
  };

  // Log notification (would integrate with email/webhook in production)
  console.log("📧 Notification:", JSON.stringify(notification, null, 2));

  // TODO: Implement email notifications via SendGrid/Resend
  // TODO: Implement webhook notifications to Slack/Discord
  
  // Example webhook:
  // await fetch(process.env.WEBHOOK_URL!, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(notification),
  // });
}