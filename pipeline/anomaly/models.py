from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DdiScore(BaseModel):
    iso3: str
    ddi_score: float
    dimension_scores: dict[str, float]
    alert_level: str
    computed_at: datetime
    weights_version: str
    year: int


class CountrySnapshot(BaseModel):
    iso3: str
    source: str
    dimension: str
    score: float
    raw_value: Optional[float] = None
    year: int
    created_at: datetime


class Alert(BaseModel):
    iso3: str
    dimension: str
    alert_level: str
    z_score: float
    current_score: float
    historical_mean: float
    triggered_at: datetime
    description: str
    weights_version: str
    metadata: Optional[dict] = None