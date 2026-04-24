import { useState } from "react";
import type { CountryData, IndicatorKey } from "../data";
import { baselinesData } from "../data";

// ============================================================================
// Types
// ============================================================================

interface CountryCardProps {
  country: CountryData;
  onClick: () => void;
  isSelected: boolean;
}

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    DEGRADING: { label: "DEGRADING", className: "status-badge degrading" },
    STRESS: { label: "STRESS", className: "status-badge stress" },
    STABLE: { label: "STABLE", className: "status-badge stable" },
    RECOVERY: { label: "RECOVERY", className: "status-badge recovery" },
    UNKNOWN: { label: "UNKNOWN", className: "status-badge unknown" },
  };

  const { label, className } = config[status] ?? config.UNKNOWN;

  return <div className={className}>{label}</div>;
}

// ============================================================================
// Region Filter Bar
// ============================================================================

function RegionFilter({ regions, selected, onChange }: { regions: string[]; selected: string; onChange: (r: string) => void }) {
  return (
    <div className="region-filter">
      <button
        className={`filter-btn ${selected === "ALL" ? "active" : ""}`}
        onClick={() => onChange("ALL")}
      >
        All Regions
      </button>
      {regions.map((region) => (
        <button
          key={region}
          className={`filter-btn ${selected === region ? "active" : ""}`}
          onClick={() => onChange(region)}
        >
          {region}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Mini Sparkline
// ============================================================================

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return null;

  const width = 60;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ============================================================================
// Compute Status
// ============================================================================

function computeCountryStatus(country: CountryData): string {
  const latest = country.readings[country.readings.length - 1];
  const indicatorKeys: IndicatorKey[] = [
    "judicial_independence",
    "press_freedom",
    "electoral_integrity",
    "civil_society_space",
    "executive_constraints",
  ];

  // Check critical count
  let criticalCount = 0;
  for (const key of indicatorKeys) {
    const baseline = baselinesData.baselines.find((b: any) => b.indicator === key);
    if (baseline && latest[key] < baseline.one_std_threshold) {
      criticalCount++;
    }
  }

  // Compute trajectory
  const n = country.readings.length;
  if (n >= 4) {
    const recentCount = Math.min(3, Math.floor(n / 3));
    const recentStart = n - recentCount;
    const priorStart = Math.max(0, recentStart - 5);
    const priorCount = recentStart - priorStart;
    
    if (priorCount >= 2) {
      const recentSlice = country.readings.slice(recentStart, n);
      const priorSlice = country.readings.slice(priorStart, recentStart);
      
      let declining = 0;
      for (const key of indicatorKeys) {
        const priorAvg = priorSlice.reduce((sum, r) => sum + r[key], 0) / priorSlice.length;
        const recentAvg = recentSlice.reduce((sum, r) => sum + r[key], 0) / recentSlice.length;
        const prior = priorAvg;
        if (prior > 0) {
          const declinePct = (prior - recentAvg) / prior;
          if (declinePct > 0.15) declining++;
        }
      }
      
      if (declining >= 3) return "DEGRADING";
      if (declining >= 1) return "STRESS";
    }
  }

  // Fallback to composite score
  const compositeScore = (
    latest.judicial_independence +
    latest.press_freedom +
    latest.electoral_integrity +
    latest.civil_society_space +
    latest.executive_constraints
  ) * 20;

  if (compositeScore < 45) return "DEGRADING";
  if (compositeScore < 60) return "STRESS";
  return "STABLE";
}

// ============================================================================
// Country Card Component
// ============================================================================

function CountryCard({ country, onClick, isSelected }: CountryCardProps) {
  const status = computeCountryStatus(country);
  const latest = country.readings[country.readings.length - 1];
  
  const compositeScore = (
    latest.judicial_independence +
    latest.press_freedom +
    latest.electoral_integrity +
    latest.civil_society_space +
    latest.executive_constraints
  ) * 20;

  const trendDirection = status === "DEGRADING" ? "down" : "stable";
  const trendColors = { down: "#ef4444", stable: "#22c55e" };

  return (
    <button
      className={`country-card-grid ${isSelected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="card-header">
        <span className="country-code">{country.country_code}</span>
        <StatusBadge status={status} />
      </div>
      
      <div className="card-body">
        <h3 className="country-name">{country.country}</h3>
      </div>

      <div className="card-footer">
        <div className="composite-score">
          <span className="score-value">{Math.round(compositeScore)}</span>
          <span className="score-label">composite</span>
        </div>
        <Sparkline 
          values={[85, 82, 78, 75, 72]}
          color={trendColors[trendDirection]} 
        />
      </div>
    </button>
  );
}

// ============================================================================
// Country Grid Component
// ============================================================================

interface CountryGridProps {
  onCountrySelect: (country: CountryData) => void;
  selectedCountryId?: number;
}

export default function CountryGrid({ onCountrySelect, selectedCountryId }: CountryGridProps) {
  const [regionFilter, setRegionFilter] = useState<string>("ALL");

  // Get all countries from the local data
  const countriesData = (baselinesData as any).countries ?? [];

  // Region mapping
  const regionMap: Record<string, string> = {
    HUN: "Europe", GEO: "Asia", POL: "Europe", TUN: "Africa", KEN: "Africa", SRB: "Europe",
  };

  // Get unique regions
  const regionSet = new Set<string>();
  for (const c of countriesData) {
    regionSet.add(regionMap[c.country_code] ?? "Other");
  }
  const regions = Array.from(regionSet).sort();

  // Filter countries
  const filteredCountries = regionFilter === "ALL"
    ? countriesData
    : countriesData.filter((c: CountryData) => (regionMap[c.country_code] ?? "Other") === regionFilter);

  return (
    <div className="country-grid">
      <div className="grid-controls">
        <RegionFilter
          regions={regions}
          selected={regionFilter}
          onChange={setRegionFilter}
        />
      </div>

      <div className="grid-summary">
        <span className="summary-count">{filteredCountries.length} countries</span>
      </div>

      <div className="country-cards-grid">
        {filteredCountries.map((country: CountryData, index: number) => (
          <CountryCard
            key={country.country_code}
            country={country}
            onClick={() => onCountrySelect(country)}
            isSelected={selectedCountryId === index + 1}
          />
        ))}
      </div>
    </div>
  );
}