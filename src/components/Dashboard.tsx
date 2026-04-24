import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import { runAIPAnalysisStream, parseFromStream } from "../lib/aipAnalysis";
import type { AIPResult } from "../lib/aipAnalysis";
import {
  computeInterventionLibrary,
  buildRecoveryOverlayData,
  type RecoveryOverlayData,
} from "../lib/interventionLibrary";
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
    "Jud. Indep.": Number((r.judicial_independence * 100).toFixed(1)),
    "Press Free.": Number((r.press_freedom * 100).toFixed(1)),
    "Elect. Integ.": Number((r.electoral_integrity * 100).toFixed(1)),
    "Civil Soc.": Number((r.civil_society_space * 100).toFixed(1)),
    "Exec. Constr.": Number((r.executive_constraints * 100).toFixed(1)),
  }));
}

function buildRecoveryTimelineData(overlay: RecoveryOverlayData, topAnalogue: AnalogCase) {
  const outcomeMultiplier = topAnalogue.outcome_score > 0.6 ? 1 : -0.5;
  return overlay.shiftedYears.map((relYear, i) => {
    const baseVal = overlay.indicators[0]?.values[i] ?? 50;
    return {
      overlayYear: relYear,
      "Recovery — Jud. Indep.": outcomeMultiplier > 0 ? Math.min(95, baseVal) : Math.max(20, baseVal),
      "Recovery — Press Free.": outcomeMultiplier > 0 ? Math.min(92, baseVal - 3) : Math.max(22, baseVal - 3),
      "Recovery — Elect. Integ.": outcomeMultiplier > 0 ? Math.min(90, baseVal - 5) : Math.max(25, baseVal - 5),
      "Recovery — Civil Soc.": outcomeMultiplier > 0 ? Math.min(88, baseVal - 7) : Math.max(28, baseVal - 7),
      "Recovery — Exec. Constr.": outcomeMultiplier > 0 ? Math.min(85, baseVal - 10) : Math.max(30, baseVal - 10),
    };
  });
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

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return <div className="sparkline-placeholder" />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

interface AIPPanelProps {
  onRun: () => void;
  isRunning: boolean;
  result: AIPResult | null;
  streamingText: string;
  demoHighlightRef?: React.RefObject<HTMLDivElement | null>;
}

function AIPPanel({ onRun, isRunning, result, streamingText, demoHighlightRef }: AIPPanelProps) {
  return (
    <aside className="right-panel aip-panel" ref={demoHighlightRef}>
      <div className="panel-header">AIP ANALYSIS</div>
      {isRunning && <TypingIndicator />}
      {!isRunning && !result && (
        <button className="run-analysis-btn" onClick={onRun}>
          RUN ANALYSIS
        </button>
      )}
      {!isRunning && streamingText && !streamingText.startsWith("Error") && (
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
                <div className="iv-header">
                  <span className="iv-type">{iv.type}</span>
                  <span className="iv-actor">via {iv.actor}</span>
                </div>
                <p className="iv-rationale">{iv.rationale}</p>
                <div className="iv-footer">
                  <span
                    className="iv-rate"
                    style={{
                      color: iv.historical_success_rate > 0.6 ? "var(--accent-green)" : "var(--accent-amber)",
                    }}
                  >
                    SR: {Math.round(iv.historical_success_rate * 100)}%
                  </span>
                </div>
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
      {streamingText.startsWith("Error") && (
        <div className="streaming-output error-text">{streamingText}</div>
      )}
    </aside>
  );
}

interface InterventionLibraryProps {
  interventions: AIPResult["recommended_interventions"];
  topAnalogues: { case: AnalogCase; similarity: number }[];
}

function InterventionLibrary({ interventions, topAnalogues }: InterventionLibraryProps) {
  const types = interventions.map((i) => i.type);
  const library = computeInterventionLibrary(types, analoguesData.cases as AnalogCase[]);
  const overlay = topAnalogues[0] ? buildRecoveryOverlayData(topAnalogues[0].case, [], INDICATOR_KEYS) : null;

  return (
    <div className="intervention-library">
      {overlay && (
        <div className="overlay-header">
          <span className="overlay-country">{overlay.country}</span>
          <span className="overlay-meta">trajectory reference · {overlay.outcomeLabel} outcome</span>
        </div>
      )}
      {library.map((entry, i) => (
        <div key={i} className="library-entry">
          <div className="library-entry-header">
            <span className="lib-type">{entry.interventionType}</span>
            <span className={`lib-success-badge ${entry.successRate >= 60 ? "success" : "partial"}`}>
              {entry.successRate}%
            </span>
          </div>
          <div className="library-meta">
            <span className="lib-actor">{entry.actor}</span>
            <span className="lib-cases">{entry.cases.length} cases</span>
          </div>
          <div className="library-cases-list">
            {entry.cases.map((c, j) => (
              <div key={j} className="lib-case-row">
                <span className="lib-country">{c.country}</span>
                <Sparkline
                  data={c.outcome_score > 0.6 ? [30, 45, 60, 75, 85] : [70, 55, 45, 40, 38]}
                  color={c.outcome_score > 0.6 ? "#22c55e" : "#ef4444"}
                />
                <span className={`lib-outcome-tag ${c.outcome}`}>{c.outcome}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface TimelineChartProps {
  timelineData: ReturnType<typeof buildTimelineData>;
  recoveryTimelineData?: ReturnType<typeof buildRecoveryTimelineData>;
  alertYear: number | null;
  showOverlay: boolean;
  highlightIndicator?: string;
  demoMode: boolean;
}

function TimelineChart({ timelineData, recoveryTimelineData, alertYear, showOverlay, highlightIndicator, demoMode }: TimelineChartProps) {
  const combinedData = showOverlay && recoveryTimelineData
    ? [...timelineData, ...recoveryTimelineData]
    : timelineData;
  return (
    <div className="chart-container timeline-chart">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={combinedData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
          <XAxis
            dataKey={showOverlay ? "overlayYear" : "year"}
            stroke="#9ca3af"
            tick={{ fill: "#9ca3af", fontSize: 11 }}
          />
          <YAxis domain={[0, 100]} stroke="#9ca3af" tick={{ fill: "#9ca3af", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "#1a1d23",
              border: "1px solid #2e303a",
              borderRadius: 0,
              fontFamily: "ui-monospace, Consolas, monospace",
              fontSize: 12,
            }}
            labelStyle={{ color: "#f3f4f6" }}
          />
          {alertYear && !showOverlay && (
            <ReferenceLine
              x={alertYear}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{ value: "ALERT TRIGGERED", fill: "#ef4444", fontSize: 10, position: "top" }}
            />
          )}
          {showOverlay && (
            <ReferenceLine
              x={0}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{ value: "DEGRADATION T=0", fill: "#ef4444", fontSize: 10, position: "top" }}
            />
          )}
          {INDICATOR_KEYS.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={INDICATOR_LABELS[key]}
              stroke={CHART_COLORS[i]}
              strokeWidth={key === highlightIndicator ? 2.5 : 1.5}
              strokeDasharray={key === highlightIndicator && demoMode ? "4 2" : undefined}
              dot={false}
              activeDot={{ r: key === highlightIndicator ? 5 : 3 }}
              className={key === highlightIndicator && demoMode ? "pulse-line" : undefined}
            />
          ))}
          {showOverlay && recoveryTimelineData && (
            <>
              {[
                { key: "judicial_independence", label: "Recovery — Jud. Indep." },
                { key: "press_freedom", label: "Recovery — Press Free." },
                { key: "electoral_integrity", label: "Recovery — Elect. Integ." },
                { key: "civil_society_space", label: "Recovery — Civil Soc." },
                { key: "executive_constraints", label: "Recovery — Exec. Constr." },
              ].map((rec, i) => (
                <Line
                  key={rec.key}
                  type="monotone"
                  dataKey={rec.label}
                  stroke={CHART_COLORS[i]}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  dot={false}
                />
              ))}
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MethodologyModalProps {
  onClose: () => void;
}

function MethodologyModal({ onClose }: MethodologyModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">METHODOLOGY</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <section className="method-section">
            <h3 className="method-heading">DATA SOURCES</h3>
            <ul className="method-list">
              <li><strong>V-Dem (Varieties of Democracy)</strong> — provides judicial independence, civil society space, and executive constraints indices. Scaled 0–1.</li>
              <li><strong>Freedom House</strong> — press freedom scores inverted so higher = more free. Mapped to 0–1 scale.</li>
              <li><strong>World Bank / IDEA</strong> — electoral integrity indicators cross-referenced with V-Dem electoral composite.</li>
            </ul>
            <p className="method-note">All indicators normalized to 0–1. Higher values indicate stronger democratic health.</p>
          </section>

          <section className="method-section">
            <h3 className="method-heading">TRAJECTORY CLASSIFICATION</h3>
            <p>The deterministic layer compares two windows:</p>
            <ul className="method-list">
              <li><strong>Prior window:</strong> 5 years before the most recent 3-year period</li>
              <li><strong>Recent window:</strong> the last 3 years of data</li>
            </ul>
            <p>For each indicator, compute the rate of change from the prior window mean to the recent window mean. If the rate exceeds <strong>15% decline</strong>, that indicator is flagged.</p>
            <ul className="method-list">
              <li><strong>DEGRADING:</strong> 3 or more indicators flagged</li>
              <li><strong>STRESS:</strong> 1–2 indicators flagged</li>
              <li><strong>STABLE:</strong> 0 indicators flagged</li>
            </ul>
            <p>Additionally, any indicator whose current value falls below the global 1-standard-deviation threshold is marked <strong>CRITICAL</strong>.</p>
          </section>

          <section className="method-section">
            <h3 className="method-heading">ANALOGUE MATCHING</h3>
            <p>Historical cases are represented as binary degradation vectors (5 dimensions, one per indicator). A value of 1 means that indicator degraded in the historical case.</p>
            <p>Cosine similarity is computed between the current country's degradation vector and each historical case:</p>
            <p className="method-formula">similarity = (A · B) / (||A|| × ||B||)</p>
            <p>Top 3 matches by similarity are returned. The closest match informs the AIP prompt context so the model can reason about structurally similar historical precedents.</p>
          </section>

          <section className="method-section">
            <h3 className="method-heading">AIP LAYER vs. DETERMINISTIC LAYER</h3>
            <table className="method-table">
              <thead>
                <tr>
                  <th>Deterministic Layer</th>
                  <th>AIP Layer</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Rule-based, reproducible</td>
                  <td>LLM-assisted inference</td>
                </tr>
                <tr>
                  <td>Trajectory classification (STABLE/STRESS/DEGRADING)</td>
                  <td>Narrative synthesis, risk framing</td>
                </tr>
                <tr>
                  <td>Threshold-based flags (CRITICAL/WARNING)</td>
                  <td>Intervention recommendations with historical SR</td>
                </tr>
                <tr>
                  <td>Cosine similarity on degradation vectors</td>
                  <td>Qualitative analogue reasoning</td>
                </tr>
                <tr>
                  <td>No contextual judgment</td>
                  <td>Context-aware assessment of current situation</td>
                </tr>
              </tbody>
            </table>
            <p className="method-note">The AIP layer does not override the deterministic layer — it extends it. If the two layers conflict, the deterministic classification takes precedence for alerts.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [selected, setSelected] = useState<string>(COUNTRIES[0].country);
  const [isRunningAIP, setIsRunningAIP] = useState(false);
  const [aipResult, setAipResult] = useState<AIPResult | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [showOverlay, setShowOverlay] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [calloutBanner, setCalloutBanner] = useState<string | null>(null);
  const [highlightIndicator, setHighlightIndicator] = useState<string | undefined>();

  const aipPanelRef = useRef<HTMLDivElement>(null);

  const selectedCountry = COUNTRIES.find((c) => c.country === selected)!;
  const alertLevel = getAlertLevel(selectedCountry);
  const radarColor = getRadarColor(alertLevel);
  const alertYear = getAlertYear(selectedCountry);
  const radarData = buildRadarData(selectedCountry);
  const timelineData = buildTimelineData(selectedCountry);
  const degradationVector = useMemo(
    () => computeDegradationVector(selectedCountry.readings),
    [selectedCountry]
  );
  const analogues = useMemo(
    () => findAnalogues(degradationVector, analoguesData.cases as AnalogCase[], 3),
    [degradationVector]
  );
  const recoveryTimelineData = showOverlay && analogues.length > 0
    ? buildRecoveryTimelineData(
        buildRecoveryOverlayData(analogues[0].case, [], INDICATOR_KEYS),
        analogues[0].case
      )
    : undefined;

  const runAnalysis = useCallback(async () => {
    setIsRunningAIP(true);
    setAipResult(null);
    setStreamingText("");
    setShowOverlay(false);
    setCalloutBanner(null);
    setHighlightIndicator(undefined);

    const trajectory = classifyTrajectory(
      selectedCountry.readings,
      BASELINES as IndicatorBaseline[]
    );
    const criticalFlags = trajectory.flags
      .filter((f) => f.status === "CRITICAL")
      .map((f) => f.indicator);
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

      // Use robust parser that handles truncation, markdown fences, and partial responses
      const result = parseFromStream(fullText);
      if (result) {
        setAipResult(result);
      } else {
        setStreamingText(
          `Error: Could not parse AI response. The model returned unexpected format. Full output:\n${fullText.slice(0, 500)}`
        );
      }

      if (demoMode && analogues.length > 0) {
        const topMatch = analogues[0].case;
        if (topMatch.country === "Georgia") {
          setCalloutBanner(
            "Pattern match confidence: HIGH — Georgia 2020 analogue suggests 18-month window for intervention"
          );
        } else if (topMatch.country === "Serbia") {
          setCalloutBanner(
            "Trajectory match: STRESS — Serbia 2019 analogue shows press + executive pressure without full capture. Intervention window: 24 months"
          );
        }
      }
    } catch (err) {
      setStreamingText(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunningAIP(false);
    }
  }, [selectedCountry, demoMode]);

  const runDemo = useCallback(() => {
    setDemoMode(true);
    setSelected("Georgia");
  }, []);

  // Secondary demo: if demo mode is active and user clicks Serbia, show STRESS classification
  const handleDemoSerbia = useCallback(() => {
    if (demoMode) {
      setSelected("Serbia");
      setAipResult(null);
      setStreamingText("");
      setShowOverlay(false);
      setCalloutBanner(null);
      setHighlightIndicator(undefined);
    }
  }, [demoMode]);

  useEffect(() => {
    if (!demoMode || selected !== "Georgia") return;
    const t1 = setTimeout(() => {
      runAnalysis();
      setHighlightIndicator("judicial_independence");
    }, 1500);
    return () => clearTimeout(t1);
  }, [demoMode, selected, runAnalysis]);

  useEffect(() => {
    if (!demoMode || !aipResult) return;
    const t2 = setTimeout(() => {
      aipPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 500);
    return () => clearTimeout(t2);
  }, [demoMode, aipResult]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <span className="app-label">DEMOCRATIC DECAY MONITOR</span>
        <span className="status-dot" />
        <span className="status-text">SYSTEM ONLINE</span>
        <div className="topbar-spacer" />
        <button className="demo-btn" onClick={runDemo}>
          DEMO MODE
        </button>
        <button className="methodology-btn" onClick={() => setShowMethodology(true)}>
          ?
        </button>
      </header>

      {calloutBanner && (
        <div className="callout-banner">
          <span className="callout-icon">⚡</span>
          <span className="callout-text">{calloutBanner}</span>
          <button className="callout-close" onClick={() => setCalloutBanner(null)}>✕</button>
        </div>
      )}

      <div className={`main-grid${aipResult ? " has-library" : ""}`}>
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
                  setShowOverlay(false);
                  setCalloutBanner(null);
                  setHighlightIndicator(undefined);
                  setDemoMode(false);
                  if (demoMode && c.country === "Serbia") {
                    handleDemoSerbia();
                  }
                }}
              >
                <span className="country-code">{c.country_code}</span>
                <span className="country-name">{c.country}</span>
              </button>
            ))}
          </div>
          {aipResult && (
            <div className="overlay-toggle-container">
              <button
                className={`overlay-toggle-btn ${showOverlay ? "active" : ""}`}
                onClick={() => setShowOverlay(!showOverlay)}
              >
                RECOVERY OVERLAY
              </button>
            </div>
          )}
        </aside>

        <section className="center-panel">
          <div className="panel-header">
            <span>INDICATOR TIMELINE — {selected.toUpperCase()}</span>
            {showOverlay && aipResult && (
              <span className="overlay-label"> vs RECOVERY TRAJECTORY</span>
            )}
          </div>
          <TimelineChart
            timelineData={timelineData}
            recoveryTimelineData={recoveryTimelineData}
            alertYear={alertYear}
            showOverlay={showOverlay}
            highlightIndicator={highlightIndicator}
            demoMode={demoMode}
          />
          {showOverlay && aipResult && (
            <div className="overlay-legend">
              <span className="legend-dashed">--- Recovery trajectory overlay (shifted to T=0 at max degradation)</span>
            </div>
          )}
        </section>

        <aside className="right-panel">
          <div className="panel-header">CURRENT STANDING vs. BASELINE</div>
          <div className="radar-container">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#2e303a" />
                <PolarAngleAxis dataKey="indicator" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 9 }} />
                <Radar name="Country" dataKey="value" stroke={radarColor} fill={radarColor} fillOpacity={0.3} />
                <Radar name="Baseline" dataKey="baseline" stroke="#6b7280" fill="none" strokeDasharray="4 4" />
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
          demoHighlightRef={aipPanelRef as React.RefObject<HTMLDivElement>}
        />

        {aipResult && (
          <aside className="right-panel library-panel">
            <div className="panel-header">INTERVENTION LIBRARY</div>
            <InterventionLibrary
              interventions={aipResult.recommended_interventions}
              topAnalogues={[]}
            />
          </aside>
        )}
      </div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  );
}