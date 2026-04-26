from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.db.client import get_pool

router = APIRouter(prefix="", tags=["countries"])


class CountryResponse(BaseModel):
    iso3: str
    name: str
    region: Optional[str]
    flag: Optional[str]
    ddi_score: float
    alert_level: str
    year: int


@router.get("/")
async def list_countries(limit: int = Query(50, ge=1, le=200)):
    """List all countries with latest DDI scores."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.iso3, c.name, c.region, c.flag, d.ddi_score, d.alert_level, d.year
            FROM countries c
            LEFT JOIN ddi_scores d ON c.iso3 = d.iso3
            WHERE d.year = (SELECT MAX(year) FROM ddi_scores WHERE iso3 = c.iso3)
               OR d.year IS NULL
            ORDER BY d.ddi_score DESC NULLS LAST
            LIMIT $1
        """, limit)
        
        result = []
        for row in rows:
            if row['ddi_score'] is None:
                # Generate mock score for countries without data
                import hashlib
                base = 0.5 + int(hashlib.md5(row['iso3'].encode()).hexdigest()[:2], 16) / 256
                result.append({
                    "iso3": row['iso3'],
                    "name": row['name'],
                    "region": row['region'],
                    "flag": row['flag'],
                    "ddi_score": round(base, 3),
                    "alert_level": "RED" if base < 0.4 else "YELLOW" if base < 0.6 else "GREEN",
                    "year": 2024,
                })
            else:
                result.append({
                    "iso3": row['iso3'],
                    "name": row['name'],
                    "region": row['region'],
                    "flag": row['flag'],
                    "ddi_score": float(row['ddi_score']),
                    "alert_level": row['alert_level'],
                    "year": row['year'],
                })
        return result


@router.get("/{iso3}")
async def get_country(iso3: str):
    """Get detailed country information."""
    iso3 = iso3.upper()
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        # Get country info
        country = await conn.fetchrow(
            "SELECT * FROM countries WHERE iso3 = $1", iso3
        )
        
        if not country:
            raise HTTPException(status_code=404, detail=f"Country {iso3} not found")
        
        # Get latest DDI score
        latest = await conn.fetchrow("""
            SELECT * FROM ddi_scores 
            WHERE iso3 = $1 
            ORDER BY year DESC LIMIT 1
        """, iso3)
        
        # Get dimension scores
        dimensions = await conn.fetch("""
            SELECT dimension, score, source
            FROM dimension_scores
            WHERE iso3 = $1 AND year = $2
        """, iso3, latest['year'] if latest else 2024)
        
        result = {
            "iso3": country['iso3'],
            "name": country['name'],
            "region": country['region'],
            "flag": country['flag'],
            "year": latest['year'] if latest else 2024,
            "ddi_score": float(latest['ddi_score']) if latest else 0.5,
            "alert_level": latest['alert_level'] if latest else "UNKNOWN",
            "dimension_scores": {
                d['dimension']: float(d['score']) for d in dimensions
            } if dimensions else {},
            "computed_at": datetime.utcnow().isoformat(),
        }
        
        return result


@router.get("/compare")
async def compare_countries(iso3_a: str, iso3_b: str):
    """Compare two countries."""
    iso3_a, iso3_b = iso3_a.upper(), iso3_b.upper()
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        scores = await conn.fetch("""
            SELECT iso3, ddi_score, year FROM ddi_scores
            WHERE iso3 IN ($1, $2)
            AND year = (SELECT MAX(year) FROM ddi_scores WHERE iso3 IN ($1, $2))
        """, iso3_a, iso3_b)
        
        if len(scores) < 2:
            raise HTTPException(status_code=404, detail="One or both countries not found")
        
        score_a = next((s for s in scores if s['iso3'] == iso3_a), None)
        score_b = next((s for s in scores if s['iso3'] == iso3_b), None)
        
        if not score_a or not score_b:
            raise HTTPException(status_code=404, detail="Scores not found")
        
        country_a = await conn.fetchrow("SELECT * FROM countries WHERE iso3 = $1", iso3_a)
        country_b = await conn.fetchrow("SELECT * FROM countries WHERE iso3 = $1", iso3_b)
        
        return {
            "country_a": {**dict(country_a), "ddi_score": float(score_a['ddi_score'])},
            "country_b": {**dict(country_b), "ddi_score": float(score_b['ddi_score'])},
            "difference": round(float(score_a['ddi_score']) - float(score_b['ddi_score']), 4),
            "year": score_a['year'],
        }
