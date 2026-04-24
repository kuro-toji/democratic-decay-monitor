import { useState, useEffect, useCallback } from "react";

// ============================================================================
// API Configuration
// ============================================================================

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ============================================================================
// Types
// ============================================================================

export interface Country {
  id: number;
  name: string;
  code: string;
  region: string;
  subregion: string;
  euMember: boolean;
  coeMember: boolean;
  trajectoryStatus?: string;
  latestReading?: IndicatorReading;
}

export interface IndicatorReading {
  id: number;
  year: number;
  judicialIndependence: number;
  pressFreedom: number;
  electoralIntegrity: number;
  civilSocietySpace: number;
  executiveConstraints: number;
  compositeScore: number;
}

export interface Alert {
  id: number;
  countryId: number;
  country?: Country;
  alertType: string;
  priority: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  message: string;
  affectedIndicators?: string[];
  createdAt: string;
  resolved: boolean;
}

export interface TrajectoryResult {
  countryId: number;
  countryName: string;
  countryCode: string;
  status: "STABLE" | "STRESS" | "DEGRADING";
  flags: Array<{
    indicator: string;
    status: "CRITICAL" | "WARNING" | "OK";
    current_value: number;
    threshold: number;
  }>;
  analogues: Array<{
    case: {
      country: string;
      startYear: number;
      endYear: number;
      indicatorsDegraded: string[];
      outcome: string;
      outcomeScore: number;
    };
    similarity: number;
  }>;
}

export interface AIPAnalysisResult {
  trajectory_narrative: string;
  primary_risk_factor: string;
  analogue_reasoning: string;
  recommended_interventions: Array<{
    type: string;
    actor: string;
    rationale: string;
    historical_success_rate: number;
  }>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  analyst_action: string;
}

// ============================================================================
// API Client
// ============================================================================

class APIClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (!json.success) {
      throw new Error(json.error?.message ?? "Unknown API error");
    }
    return json.data;
  }

  // Health endpoints
  async healthCheck() {
    return this.request("/api/health");
  }

  // Countries
  async getCountries(params?: { page?: number; limit?: number; region?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.region) query.set("region", params.region);
    return this.request<{ data: Country[]; pagination: any }>(`/api/countries?${query}`);
  }

  async getCountry(id: number) {
    return this.request<Country & { readings: IndicatorReading[]; classifications: any[]; analogues: any[] }>(`/api/countries/${id}`);
  }

  async getCountryTrajectory(id: number) {
    return this.request<TrajectoryResult>(`/api/countries/${id}/trajectory`);
  }

  async batchTrajectoryAnalysis() {
    return this.request<{ results: TrajectoryResult[]; summary: any }>("/api/countries/batch-trajectory", { method: "POST" });
  }

  // Alerts
  async getAlerts(params?: { countryId?: number; type?: string; priority?: string; resolved?: boolean }) {
    const query = new URLSearchParams();
    if (params?.countryId) query.set("countryId", params.countryId.toString());
    if (params?.type) query.set("type", params.type);
    if (params?.priority) query.set("priority", params.priority);
    if (params?.resolved !== undefined) query.set("resolved", params.resolved.toString());
    return this.request<{ data: Alert[]; pagination: any }>(`/api/alerts?${query}`);
  }

  async getActiveAlerts() {
    return this.request<{ alerts: Alert[]; summary: { total: number; critical: number; warning: number; info: number } }>("/api/alerts/active");
  }

  async resolveAlert(id: number, notes?: string) {
    return this.request<Alert>(`/api/alerts/${id}/resolve`, {
      method: "PUT",
      body: JSON.stringify({ resolutionNotes: notes }),
    });
  }

  async evaluateAlerts() {
    return this.request<{ evaluated: number; newAlerts: number; clearedAlerts: number }>("/api/alerts/evaluate", { method: "POST" });
  }

  async getAlertStats() {
    return this.request<{ overview: any; recent: any; topCountries: any[] }>("/api/alerts/stats");
  }

  // AIP Analysis
  async runAIPAnalysis(countryId: number) {
    return this.request<AIPAnalysisResult>("/api/aip/analyze", {
      method: "POST",
      body: JSON.stringify({ countryId }),
    });
  }

  async getAIPHistory(countryId: number) {
    return this.request<any[]>("/api/aip/history/" + countryId);
  }
}

export const api = new APIClient(API_BASE);

// ============================================================================
// React Hooks
// ============================================================================

export function useCountries(region?: string) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCountries({ region, limit: 200 })
      .then((data) => setCountries(data.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [region]);

  return { countries, loading, error };
}

export function useActiveAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState({ total: 0, critical: 0, warning: 0, info: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getActiveAlerts()
      .then((data) => {
        setAlerts(data.alerts);
        setSummary(data.summary);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { alerts, summary, loading, error, refresh };
}

export function useCountryTrajectory(countryId: number | null) {
  const [trajectory, setTrajectory] = useState<TrajectoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!countryId) {
      setTrajectory(null);
      return;
    }

    setLoading(true);
    api.getCountryTrajectory(countryId)
      .then(setTrajectory)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [countryId]);

  return { trajectory, loading, error };
}

export function useAlertStats() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAlertStats()
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { stats, loading, error };
}