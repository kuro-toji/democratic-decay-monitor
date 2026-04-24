import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useState } from "react";
import { indicatorsData, baselinesData } from "../data";
import type { IndicatorKey, CountryData } from "../data";
import "../index.css";

const COUNTRIES = indicatorsData.countries;
const BASELINES = baselinesData.baselines;

const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  judicial_independence: "Jud. Indep.",
  press_freedom: "Press Free.",
  electoral_integrity: "Elect. Integ.",
  civil_society_space: "Civil Soc.",
  executive_constraints: "Exec. Constr.",
};

const INDICATOR_KEYS: IndicatorKey[] = [
  "judicial_independence",
  "press_freedom",
  "electoral_integrity",
  "civil_society_space",
  "executive_constraints",
];

function getAlertLevel(country: CountryData): number {
  const latest = country.readings[country.readings.length - 1];
  let below = 0;
  for (const key of INDICATOR_KEYS) {
    const baseline = BASELINES.find((b) => b.indicator === key);
    if (baseline && latest[key] < baseline.one_std_threshold) {
      below++;
    }
  }
  return below;
}

function getRadarColor(alertLevel: number): string {
  if (alertLevel === 0) return "#22c55e";
  if (alertLevel <= 2) return "#f59e0b";
  return "#ef4444";
}

function getAlertYear(country: CountryData): number | null {
  for (const reading of country.readings) {
    let triggered = 0;
    for (const key of INDICATOR_KEYS) {
      const baseline = BASELINES.find((b) => b.indicator === key);
      if (baseline && reading[key] < baseline.one_std_threshold) {
        triggered++;
      }
    }
    if (triggered >= 3) {
      return reading.year;
    }
  }
  return null;
}

function buildRadarData(country: CountryData) {
  const latest = country.readings[country.readings.length - 1];
  return INDICATOR_KEYS.map((key) => {
    const baseline = BASELINES.find((b) => b.indicator === key)!;
    return {
      indicator: INDICATOR_LABELS[key],
      value: Number((latest[key] * 100).toFixed(1)),
      baseline: Number((baseline.one_std_threshold * 100).toFixed(1)),
    };
  });
}

function buildTimelineData(country: CountryData) {
  return country.readings.map((r) => ({
    year: r.year,
    "Judicial Independence": Number((r.judicial_independence * 100).toFixed(1)),
    "Press Freedom": Number((r.press_freedom * 100).toFixed(1)),
    "Electoral Integrity": Number((r.electoral_integrity * 100).toFixed(1)),
    "Civil Society Space": Number((r.civil_society_space * 100).toFixed(1)),
    "Executive Constraints": Number((r.executive_constraints * 100).toFixed(1)),
  }));
}

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6"];

export default function Dashboard() {
  const [selected, setSelected] = useState<string>(COUNTRIES[0].country);

  const selectedCountry = COUNTRIES.find((c) => c.country === selected)!;
  const alertLevel = getAlertLevel(selectedCountry);
  const radarColor = getRadarColor(alertLevel);
  const alertYear = getAlertYear(selectedCountry);
  const radarData = buildRadarData(selectedCountry);
  const timelineData = buildTimelineData(selectedCountry);

  return (
    <div className="dashboard">
      <header className="topbar">
        <span className="app-label">DEMOCRATIC DECAY MONITOR</span>
        <span className="status-dot" />
        <span className="status-text">SYSTEM ONLINE</span>
      </header>

      <div className="main-grid">
        <aside className="left-panel">
          <div className="panel-header">SELECT COUNTRY</div>
          <div className="country-list">
            {COUNTRIES.map((c) => (
              <button
                key={c.country}
                className={`country-card ${selected === c.country ? "selected" : ""}`}
                onClick={() => setSelected(c.country)}
              >
                <span className="country-code">{c.country_code}</span>
                <span className="country-name">{c.country}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="center-panel">
          <div className="panel-header">INDICATOR TIMELINE — {selected.toUpperCase()}</div>
          <div className="chart-container timeline-chart">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={timelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                <XAxis dataKey="year" stroke="#9ca3af" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis domain={[0, 100]} stroke="#9ca3af" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#1a1d23", border: "1px solid #2e303a", borderRadius: 0, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 }}
                  labelStyle={{ color: "#f3f4f6" }}
                />
                {alertYear && (
                  <ReferenceLine
                    x={alertYear}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: "ALERT TRIGGERED", fill: "#ef4444", fontSize: 10, position: "top" }}
                  />
                )}
                {INDICATOR_KEYS.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={INDICATOR_LABELS[key]}
                    stroke={CHART_COLORS[i]}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-header">CURRENT STANDING vs. BASELINE</div>
          <div className="radar-container">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#2e303a" />
                <PolarAngleAxis dataKey="indicator" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 9 }} />
                <Radar
                  name="Country"
                  dataKey="value"
                  stroke={radarColor}
                  fill={radarColor}
                  fillOpacity={0.3}
                />
                <Radar
                  name="Baseline"
                  dataKey="baseline"
                  stroke="#6b7280"
                  fill="none"
                  strokeDasharray="4 4"
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="alert-badge" style={{ borderColor: radarColor, color: radarColor }}>
            ALERT LEVEL: {alertLevel >= 3 ? "HIGH" : alertLevel === 0 ? "NOMINAL" : "ELEVATED"}
          </div>
        </aside>

        <aside className="right-panel aip-panel">
          <div className="panel-header">AIP ANALYSIS</div>
          <div className="placeholder-card">
            <span className="placeholder-label">AUTO-REGRESSION IN PROGRESS</span>
            <span className="placeholder-sub">Analog case matching pending data ingestion</span>
          </div>
        </aside>
      </div>
    </div>
  );
}