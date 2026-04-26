import asyncio
import json
import random
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="", tags=["alerts"])

ALERT_TEMPLATES = [
    {
        "iso3": "HUN",
        "alert_type": "CRITICAL_DECLINE",
        "severity": "HIGH",
        "dimension": "media_freedom",
        "description": "Sharp decline in media pluralism scores detected",
        "threshold": 0.15,
        "actual": 0.23,
    },
    {
        "iso3": "POL",
        "alert_type": "WARNING",
        "severity": "MEDIUM",
        "dimension": "rule_of_law",
        "description": "Judicial independence metrics below critical threshold",
        "threshold": 0.2,
        "actual": 0.18,
    },
    {
        "iso3": "GEO",
        "alert_type": "RAPID_DECLINE",
        "severity": "HIGH",
        "dimension": "civil_liberties",
        "description": "Accelerating decline in civil society space",
        "threshold": 0.15,
        "actual": 0.31,
    },
    {
        "iso3": "SRB",
        "alert_type": "WARNING",
        "severity": "MEDIUM",
        "dimension": "electoral_integrity",
        "description": "Election administration concerns flagged",
        "threshold": 0.15,
        "actual": 0.12,
    },
    {
        "iso3": "BRA",
        "alert_type": "WARNING",
        "severity": "MEDIUM",
        "dimension": "institutional_checks",
        "description": "Congressional oversight weakening detected",
        "threshold": 0.15,
        "actual": 0.09,
    },
]


@router.get("/")
async def list_alerts(
    severity: Optional[str] = Query(None, description="Filter by severity: HIGH, MEDIUM, LOW"),
    iso3: Optional[str] = Query(None, description="Filter by country"),
    limit: int = Query(50, ge=1, le=100),
):
    """List recent alerts with optional filtering."""
    alerts = []
    now = datetime.utcnow()
    
    for i, template in enumerate(ALERT_TEMPLATES):
        if severity and template["severity"] != severity.upper():
            continue
        if iso3 and template["iso3"] != iso3.upper():
            continue
        
        # Generate unique alert with timestamp
        days_ago = i * 2 + hash(template["iso3"]) % 5
        triggered_at = now - timedelta(days=days_ago)
        
        alerts.append({
            "id": f"alert_{template['iso3']}_{days_ago}",
            **template,
            "triggered_at": triggered_at.isoformat(),
            "acknowledged": days_ago > 7,
        })
    
    return alerts[:limit]


@router.get("/summary")
async def alert_summary():
    """Get alert statistics summary."""
    return {
        "total_alerts": len(ALERT_TEMPLATES),
        "by_severity": {
            "HIGH": len([a for a in ALERT_TEMPLATES if a["severity"] == "HIGH"]),
            "MEDIUM": len([a for a in ALERT_TEMPLATES if a["severity"] == "MEDIUM"]),
            "LOW": len([a for a in ALERT_TEMPLATES if a["severity"] == "LOW"]),
        },
        "by_country": {
            "HUN": 1,
            "POL": 1,
            "GEO": 1,
            "SRB": 1,
            "BRA": 1,
        },
        "unacknowledged": 3,
        "last_updated": datetime.utcnow().isoformat(),
    }


@router.get("/stream")
async def alert_stream():
    """SSE stream of real-time alerts (simulated)."""
    
    async def event_generator():
        countries = ["HUN", "POL", "GEO", "SRB", "BRA", "IND", "USA", "GBR"]
        alert_types = ["CRITICAL_DECLINE", "WARNING", "RAPID_DECLINE", "DIMENSION_ALERT"]
        dimensions = ["media_freedom", "electoral_integrity", "rule_of_law", "civil_liberties"]
        severities = ["HIGH", "MEDIUM", "LOW"]
        
        while True:
            # Generate a random alert
            alert = {
                "id": f"alert_{random.randint(1000, 9999)}",
                "iso3": random.choice(countries),
                "alert_type": random.choice(alert_types),
                "severity": random.choice(severities),
                "dimension": random.choice(dimensions),
                "description": "Real-time monitoring alert",
                "triggered_at": datetime.utcnow().isoformat(),
                "acknowledged": False,
            }
            
            yield f"data: {json.dumps(alert)}\n\n"
            
            # Wait 15-30 seconds between alerts
            await asyncio.sleep(random.randint(15, 30))
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
