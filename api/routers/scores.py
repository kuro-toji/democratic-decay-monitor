from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query

from api.db.client import get_pool

router = APIRouter(prefix="", tags=["scores"])


@router.get("/latest")
async def latest_scores():
    """Get latest DDI scores for all countries."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.iso3, d.ddi_score, d.alert_level, d.year, d.computed_at
            FROM ddi_scores d
            WHERE d.year = (SELECT MAX(year) FROM ddi_scores WHERE iso3 = d.iso3)
            ORDER BY d.ddi_score DESC
        """)
        
        return [
            {
                "iso3": row['iso3'],
                "ddi_score": float(row['ddi_score']),
                "alert_level": row['alert_level'],
                "year": row['year'],
                "computed_at": row['computed_at'].isoformat() if row['computed_at'] else datetime.utcnow().isoformat(),
            }
            for row in rows
        ]


@router.get("/ranking")
async def ranking(limit: int = Query(25, ge=1, le=100)):
    """Get country rankings by DDI score."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            WITH latest_scores AS (
                SELECT iso3, ddi_score, year,
                    LAG(ddi_score) OVER (PARTITION BY iso3 ORDER BY year) as prev_score
                FROM ddi_scores
            )
            SELECT d.iso3, d.ddi_score, d.year, ls.prev_score,
                COALESCE(d.ddi_score - ls.prev_score, 0) as change_yoy
            FROM ddi_scores d
            LEFT JOIN latest_scores ls ON d.iso3 = ls.iso3 AND d.year = ls.year + 1
            WHERE d.year = (SELECT MAX(year) FROM ddi_scores WHERE iso3 = d.iso3)
            ORDER BY d.ddi_score DESC
            LIMIT $1
        """, limit)
        
        result = []
        for i, row in enumerate(rows):
            result.append({
                "iso3": row['iso3'],
                "ddi_score": float(row['ddi_score']),
                "rank": i + 1,
                "change_yoy": round(float(row['change_yoy']) if row['change_yoy'] else 0, 4),
            })
        return result


@router.get("/{iso3}")
async def get_score(iso3: str):
    """Get DDI score for a specific country."""
    iso3 = iso3.upper()
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        score = await conn.fetchrow("""
            SELECT d.*, c.name, c.flag, c.region
            FROM ddi_scores d
            JOIN countries c ON d.iso3 = c.iso3
            WHERE d.iso3 = $1 
            ORDER BY d.year DESC LIMIT 1
        """, iso3)
        
        if not score:
            return {"error": f"No data for {iso3}"}
        
        dimensions = await conn.fetch("""
            SELECT dimension, score
            FROM dimension_scores
            WHERE iso3 = $1 AND year = $2
        """, iso3, score['year'])
        
        return {
            "iso3": score['iso3'],
            "name": score['name'],
            "ddi_score": float(score['ddi_score']),
            "alert_level": score['alert_level'],
            "year": score['year'],
            "dimension_scores": {
                d['dimension']: float(d['score']) for d in dimensions
            },
            "computed_at": score['computed_at'].isoformat() if score['computed_at'] else datetime.utcnow().isoformat(),
        }
