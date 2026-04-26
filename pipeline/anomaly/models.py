from datetime import datetime

from pydantic import BaseModel


class DdiScore(BaseModel):
    iso3: str
    year: int
    ddi_score: float
    dimension_scores: dict[str, float]
    alert_level: str
    computed_at: datetime
    weights_version: str


class CountrySnapshot(BaseModel):
    iso3: str
    source: str
    dimension: str
    score: float
    raw_value: float | None = None
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