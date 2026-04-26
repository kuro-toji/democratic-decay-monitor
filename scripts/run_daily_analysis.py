#!/usr/bin/env python3
"""
Daily analysis runner for Democratic Decay Monitor.
Generates trajectory classification and analysis for all countries.
Can be run daily via cron or GitHub Actions.
"""
import json
import os
import sys
from datetime import datetime

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def load_data():
    """Load indicator data."""
    with open('src/data/indicators.json') as f:
        return json.load(f)

def get_baselines():
    """Return baseline thresholds."""
    return [
        {"indicator": "judicial_independence", "one_std_threshold": 0.46},
        {"indicator": "press_freedom", "one_std_threshold": 0.48},
        {"indicator": "electoral_integrity", "one_std_threshold": 0.55},
        {"indicator": "civil_society_space", "one_std_threshold": 0.60},
        {"indicator": "executive_constraints", "one_std_threshold": 0.46},
    ]

def classify_trajectory(readings):
    """Classify country trajectory."""
    if len(readings) < 8:
        return "STABLE", []
    
    recent = readings[-3:]
    prior = readings[-8:-3]
    
    if len(prior) < 2:
        return "STABLE", []
    
    declining = []
    for key in ["judicial_independence", "press_freedom", "electoral_integrity", "civil_society_space", "executive_constraints"]:
        prior_avg = sum(r[key] for r in prior) / len(prior)
        recent_avg = sum(r[key] for r in recent) / len(recent)
        if prior_avg > 0:
            decline = (prior_avg - recent_avg) / prior_avg
            if decline > 0.15:
                declining.append(key)
    
    if len(declining) >= 3:
        return "DEGRADING", declining
    elif len(declining) >= 1:
        return "STRESS", declining
    return "STABLE", []

def analyze_country(code, name, readings, baselines):
    """Analyze a single country."""
    trajectory, declining = classify_trajectory(readings)
    latest = readings[-1]
    
    # Calculate alert level
    alert_level = 0
    critical = []
    for bl in baselines:
        key = bl["indicator"]
        if latest[key] < bl["one_std_threshold"]:
            alert_level += 1
            critical.append(key)
    
    # Calculate composite score
    composite = (
        latest["judicial_independence"] * 20 +
        latest["press_freedom"] * 20 +
        latest["electoral_integrity"] * 20 +
        latest["civil_society_space"] * 20 +
        latest["executive_constraints"] * 20
    )
    
    return {
        "code": code,
        "name": name,
        "trajectory": trajectory,
        "declining_indicators": declining,
        "alert_level": alert_level,
        "critical_indicators": critical,
        "composite_score": round(composite, 1),
        "latest_reading": latest,
        "year": latest.get("year", 2024),
    }

def run_daily_analysis():
    """Run analysis for all countries."""
    print(f"[{datetime.now().isoformat()}] Starting daily analysis...")
    
    data = load_data()
    baselines = get_baselines()
    
    results = []
    for country in data["countries"]:
        result = analyze_country(
            country["country_code"],
            country["country"],
            country["readings"],
            baselines
        )
        results.append(result)
    
    # Sort by trajectory (DEGRADING first)
    results.sort(key=lambda x: (0 if x["trajectory"] == "DEGRADING" else 1 if x["trajectory"] == "STRESS" else 2, x["name"]))
    
    # Summary
    summary = {
        "generated_at": datetime.now().isoformat(),
        "total_countries": len(results),
        "degrading": sum(1 for r in results if r["trajectory"] == "DEGRADING"),
        "stress": sum(1 for r in results if r["trajectory"] == "STRESS"),
        "stable": sum(1 for r in results if r["trajectory"] == "STABLE"),
    }
    
    output = {
        "summary": summary,
        "countries": results,
    }
    
    # Save
    with open('src/data/analysis_results.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"✅ Analysis complete!")
    print(f"   DEGRADING: {summary['degrading']}")
    print(f"   STRESS: {summary['stress']}")  
    print(f"   STABLE: {summary['stable']}")
    print(f"   Total: {summary['total_countries']}")
    
    return output

if __name__ == "__main__":
    run_daily_analysis()