from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.db.client import get_pool

router = APIRouter(prefix="", tags=["history"])


@router.get("/worst-declines")
async def worst_declines(limit: int = Query(10, ge=1, le=50)):
    """Get countries with worst DDI declines."""
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            WITH latest AS (
                SELECT iso3, ddi_score FROM ddi_scores d1
                WHERE year = (SELECT MAX(year) FROM ddi_scores WHERE iso3 = d1.iso3)
            ),
            previous AS (
                SELECT iso3, ddi_score FROM ddi_scores d1
                WHERE year = (SELECT MAX(year) - 3 FROM ddi_scores WHERE iso3 = d1.iso3)
            )
            SELECT l.iso3, l.ddi_score as ddi_score, p.ddi_score as ddi_score_previous,
                l.ddi_score - p.ddi_score as change
            FROM latest l
            JOIN previous p ON l.iso3 = p.iso3
            WHERE p.ddi_score > 0.3
            ORDER BY change ASC
            LIMIT $1
        """, limit)
        
        return [
            {
                "iso3": row['iso3'],
                "ddi_score": round(float(row['ddi_score']), 4),
                "ddi_score_previous": round(float(row['ddi_score_previous']), 4),
                "change": round(float(row['change']), 4),
                "years": 3,
            }
            for row in rows
        ]


@router.get("/{iso3}/trend")
async def get_trend(iso3: str):
    """Get trend analysis for a country."""
    iso3 = iso3.upper()
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT year, ddi_score
            FROM ddi_scores
            WHERE iso3 = $1
            ORDER BY year DESC
            LIMIT 10
        """, iso3)
        
        if len(rows) < 2:
            raise HTTPException(status_code=404, detail=f"Not enough data for {iso3}")
        
        scores = [float(row['ddi_score']) for row in reversed(rows)]
        years = [row['year'] for row in reversed(rows)]
        
        n = len(scores)
        sum_x = sum(range(n))
        sum_y = sum(scores)
        sum_xy = sum(i * s for i, s in enumerate(scores))
        sum_x2 = sum(i * i for i in range(n))
        
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x) if n * sum_x2 != sum_x * sum_x else 0
        prediction = scores[-1] + slope
        
        return {
            "iso3": iso3,
            "trend": "declining" if slope < -0.01 else "stable" if abs(slope) <= 0.01 else "improving",
            "slope": round(slope * 10, 4),
            "change_5y": round(scores[-1] - scores[min(5, len(scores)-1)], 4),
            "prediction_1y": round(max(0.1, min(1.0, prediction)), 4),
            "confidence": "high" if len(rows) >= 10 else "medium",
            "data_points": len(rows),
            "year_range": f"{years[0]}-{years[-1]}",
        }


@router.get("/{iso3}")
async def get_history(
    iso3: str,
    start_year: Optional[int] = Query(None, ge=2010, le=2024),
    end_year: Optional[int] = Query(None, ge=2010, le=2024),
):
    """Get historical DDI scores for a country."""
    iso3 = iso3.upper()
    pool = await get_pool()
    
    async with pool.acquire() as conn:
        country = await conn.fetchval("SELECT iso3 FROM countries WHERE iso3 = $1", iso3)
        if not country:
            raise HTTPException(status_code=404, detail=f"Country {iso3} not found")
        
        start = start_year or 2010
        end = end_year or 2024
        
        rows = await conn.fetch("""
            SELECT year, iso3, ddi_score
            FROM ddi_scores
            WHERE iso3 = $1 AND year >= $2 AND year <= $3
            ORDER BY year
        """, iso3, start, end)
        
        dim_rows = await conn.fetch("""
            SELECT year, dimension, score
            FROM dimension_scores
            WHERE iso3 = $1 AND year >= $2 AND year <= $3
            ORDER BY year, dimension
        """, iso3, start, end)
        
        dims_by_year = {}
        for row in dim_rows:
            if row['year'] not in dims_by_year:
                dims_by_year[row['year']] = {}
            dims_by_year[row['year']][row['dimension']] = float(row['score'])
        
        return [
            {
                "year": row['year'],
                "iso3": row['iso3'],
                "ddi_score": float(row['ddi_score']),
                "dimension_scores": dims_by_year.get(row['year'], {}),
            }
            for row in rows
        ]
