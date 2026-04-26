from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CountryBase(BaseModel):
    iso3: str
    iso2: str
    name: str
    region: str
    sub_region: str
    flag_emoji: str


class DimensionScores(BaseModel):
    electoral_integrity: Optional[float] = None
    media_freedom: Optional[float] = None
    rule_of_law: Optional[float] = None
    civil_liberties: Optional[float] = None
    institutional_checks: Optional[float] = None
    polarisation_violence: Optional[float] = None


class DdiScore(BaseModel):
    iso3: str
    ddi_score: float
    dimension_scores: DimensionScores
    alert_level: str = Field(pattern="^(none|watch|red)$")
    computed_at: datetime
    weights_version: str


class Alert(BaseModel):
    iso3: str
    dimension: str
    alert_level: str
    z_score: float
    triggered_at: datetime
    description: str


class CountryDetail(CountryBase):
    latest_ddi: Optional[DdiScore] = None


class HistoryPoint(BaseModel):
    year: int
    ddi_score: float
    dimension_scores: DimensionScores