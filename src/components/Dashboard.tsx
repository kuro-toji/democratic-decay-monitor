import { useState, useCallback } from "react";
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
import {
  indicatorsData,
  baselinesData,
  analoguesData,
} from "../data";
import type { IndicatorKey, CountryData, IndicatorBaseline, AnalogCase } from "../data";
import { classifyTrajectory, computeDegradationVector, findAnalogues } from "../lib/trajectoryEngine";
import { runAIPAnalysisStream } from "../lib/aipAnalysis";
import type { AIPResult } from "../lib/aipAnalysis";
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

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6"];

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

function buildCurrentIndicators(country: CountryData): Record<string, number> {
  const latest = country.readings[country.readings.length - 1];
  return {
    judicial_independence: latest.judicial_independence,
    press_freedom: latest.press_freedom,
    electoral_integrity: latest.electoral_integrity,
    civil_society_space: latest.civil_society_space,
    executive_constraints: latest.executive_constraints,
  };
}

function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

interface AIPPanelProps {
  onRun: () => void;
  isRunning: boolean;
  result: AIPResult | null;
  streamingText: string;
}

function AIPPanel({ onRun, isRunning, result, streamingText }: AIPPanelProps) {
  return (
    <aside className="right-panel aip-panel">
      <div className="panel-header">AIP ANALYSIS</div>
      {isRunning && <TypingIndicator />}
      {!isRunning && !result && (
        <button className="run-analysis-btn" onClick={onRun}>
          RUN ANALYSIS
        </button>
      )}
      {!isRunning && streamingText && (
        <div className="streaming-output">{streamingText}</div>
      )}
      {!isRunning && result && (
        <div className="aip-result">
          <div className="aip-section">
            <span className="aip-label">TRAJECTORY</span>
            <p className="aip-text">{result.trajectory_narrative}</p>
          </div>
          <div className="aip-section">
            <span className="aip-label">PRIMARY RISK</span>
            <p className="aip-text risk-factor">{result.primary_risk_factor}</p>
          </div>
          <div className="aip-section">
            <span className="aip-label">ANALOGUE REASONING</span>
            <p className="aip-text">{result.analogue_reasoning}</p>
          </div>
          <div className="aip-section">
            <span className="aip-label">RECOMMENDED INTERVENTIONS</span>
            {result.recommended_interventions.map((iv, i) => (
              <div key={i} className="intervention-item">
                <span className="iv-type">{iv.type}</span>
                <span className="iv-actor">via {iv.actor}</span>
                <span className="iv-rate">SR: {iv.historical_success_rate}</span>
                <p className="iv-rationale">{iv.rationale}</p>
              </div>
            ))}
          </div>
          <div className="aip-footer">
            <span className="confidence-badge" data-level={result.confidence.toLowerCase()}>
              {result.confidence}
            </span>
            <p className="analyst-action">{result.analyst_action}</p>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function Dashboard() {
  const [selected, setSelected] = useState<string>(COUNTRIES[0].country);
  const [isRunningAIP, setIsRunningAIP] = useState(false);
  const [aipResult, setAipResult] = useState<AIPResult | null>(null);
  const [streamingText, setStreamingText] = useState("");

  const selectedCountry = COUNTRIES.find((c) => c.country === selected)!;
  const alertLevel = getAlertLevel(selectedCountry);
  const radarColor = getRadarColor(alertLevel);
  const alertYear = getAlertYear(selectedCountry);
  const radarData = buildRadarData(selectedCountry);
  const timelineData = buildTimelineData(selectedCountry);

  const runAnalysis = useCallback(async () => {
    setIsRunningAIP(true);
    setAipResult(null);
    setStreamingText("");

    const vector = computeDegradationVector(selectedCountry.readings);
    const trajectory = classifyTrajectory(
      selectedCountry.readings,
      BASELINES as IndicatorBaseline[]
    );
    const criticalFlags = trajectory.flags
      .filter((f) => f.status === "CRITICAL")
      .map((f) => f.indicator);
    const analogues = findAnalogues(
      vector,
      analoguesData.cases as AnalogCase[],
      3
    );
    const currentIndicators = buildCurrentIndicators(selectedCountry);

    let fullText = "";

    try {
      await runAIPAnalysisStream(
        {
          country: selectedCountry.country,
          currentIndicators,
          trajectoryClass: trajectory.status,
          criticalFlags,
          topAnalogues: analogues,
        },
        (chunk) => {
          fullText += chunk;
          setStreamingText(fullText);
        }
      );

      const cleaned = fullText.trim().replace(/```json\s*/g, "").replace(/```\s*/g, "");
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      const jsonStr = firstBrace !== -1 && lastBrace !== -1 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
      const parsed = JSON.parse(jsonStr);
      setAipResult({
        trajectory_narrative: parsed.trajectory_narrative ?? "",
        primary_risk_factor: parsed.primary_risk_factor ?? "",
        analogue_reasoning: parsed.analogue_reasoning ?? "",
        recommended_interventions: (parsed.recommended_interventions ?? []).map(
          (i: Record<string, unknown>) => ({
            type: i.type ?? "",
            actor: i.actor ?? "",
            rationale: i.rationale ?? "",
            historical_success_rate: Number(i.historical_success_rate ?? 0),
          })
        ),
        confidence: (parsed.confidence ?? "MEDIUM") as AIPResult["confidence"],
        analyst_action: parsed.analyst_action ?? "",
      });
    } catch (err) {
      setStreamingText(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunningAIP(false);
    }
  }, [selectedCountry]);

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
                onClick={() => {
                  setSelected(c.country);
                  setAipResult(null);
                  setStreamingText("");
                }}
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

        <AIPPanel
          onRun={runAnalysis}
          isRunning={isRunningAIP}
          result={aipResult}
          streamingText={streamingText}
        />
      </div>
    </div>
  );
}