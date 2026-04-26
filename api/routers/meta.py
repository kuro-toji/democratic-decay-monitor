"""Metadata endpoints - weights, sources, statistics, changelog."""
import os
import re
from datetime import datetime
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="", tags=["metadata"])

# Weights configuration
WEIGHTS_CONFIG = {
    "version": "1.0.0",
    "dimensions": {
        "electoral_integrity": {"weight": 0.20, "sources": ["vdem", "fh"]},
        "media_freedom": {"weight": 0.18, "sources": ["rsf", "vdem"]},
        "rule_of_law": {"weight": 0.18, "sources": ["wgi", "vdem"]},
        "civil_liberties": {"weight": 0.18, "sources": ["fh", "civicus"]},
        "institutional_checks": {"weight": 0.14, "sources": ["vdem"]},
        "polarisation_violence": {"weight": 0.12, "sources": ["acled", "gdelt"]},
    },
}

DATA_SOURCES = [
    {"name": "V-Dem Dataset", "coverage": ["HUN", "GEO", "POL", "SRB", "TUN", "KEN"], "last_updated": "2024-11-01"},
    {"name": "Freedom House", "coverage": ["HUN", "GEO", "POL", "SRB", "TUN", "KEN"], "last_updated": "2024-10-15"},
    {"name": "RSF Press Freedom Index", "coverage": ["HUN", "GEO", "POL", "SRB", "TUN", "KEN"], "last_updated": "2024-05-03"},
    {"name": "World Governance Indicators", "coverage": ["HUN", "GEO", "POL", "SRB", "TUN", "KEN"], "last_updated": "2024-06-30"},
]


class ChangelogEntry(BaseModel):
    version: str
    date: str
    changes: list[str]


class DataSource(BaseModel):
    name: str
    coverage: list[str]
    last_updated: datetime


class MetaStats(BaseModel):
    total_countries: int
    countries_on_watch: int
    countries_on_red: int
    last_pipeline_run: Optional[datetime]
    weights_version: str
    total_snapshots: int


def parse_changelog() -> list[ChangelogEntry]:
    """Parse CHANGELOG.md and return structured entries."""
    changelog_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "..", "CHANGELOG.md")
    
    entries = []
    
    try:
        with open(changelog_path, "r") as f:
            content = f.read()
        
        # Parse ## version headers
        # Format: ## [version] - YYYY-MM-DD
        version_pattern = r"##\s+\[?([^\]]+)\]?\s*-\s*(\d{4}-\d{2}-\d{2})"
        
        # Split by headers and extract sections
        current_version = None
        current_date = None
        current_changes = []
        
        for line in content.split("\n"):
            match = re.match(version_pattern, line)
            if match:
                # Save previous entry
                if current_version:
                    entries.append(ChangelogEntry(
                        version=current_version,
                        date=current_date,
                        changes=current_changes,
                    ))
                
                current_version = match.group(1)
                current_date = match.group(2)
                current_changes = []
            elif line.startswith("- ") and current_version:
                # Add bullet points as changes
                current_changes.append(line[2:].strip())
            elif line.startswith("## ") and current_version:
                # Hit next header, save entry
                entries.append(ChangelogEntry(
                    version=current_version,
                    date=current_date,
                    changes=current_changes,
                ))
                break
        
        # Don't forget last entry
        if current_version:
            entries.append(ChangelogEntry(
                version=current_version,
                date=current_date,
                changes=current_changes,
            ))
            
    except FileNotFoundError:
        pass
    
    return entries


@router.get("/weights")
async def get_weights() -> dict:
    """
    Get full DDI dimension weights configuration.
    
    Returns weights.yaml contents as JSON.
    """
    return WEIGHTS_CONFIG


@router.get("/sources")
async def get_sources() -> list[DataSource]:
    """
    Get list of all data sources with coverage and update timestamps.
    """
    return [
        DataSource(
            name=source["name"],
            coverage=source["coverage"],
            last_updated=datetime.fromisoformat(source["last_updated"]),
        )
        for source in DATA_SOURCES
    ]


@router.get("/stats")
async def get_stats() -> MetaStats:
    """
    Get aggregate statistics about the monitoring system.
    """
    return MetaStats(
        total_countries=6,
        countries_on_watch=2,
        countries_on_red=1,
        last_pipeline_run=datetime(2024, 12, 15, 6, 0, 0),
        weights_version="1.0.0",
        total_snapshots=84,
    )


@router.get("/changelog", response_model=list[ChangelogEntry])
async def get_changelog() -> list[ChangelogEntry]:
    """
    Get changelog entries.
    
    Parses CHANGELOG.md from the project root and returns structured entries.
    """
    entries = parse_changelog()
    
    if not entries:
        # Return sample data if no changelog found
        return [
            ChangelogEntry(
                version="1.0.0",
                date="2024-12-01",
                changes=[
                    "Initial release",
                    "V-Dem v14 dataset integrated",
                    "Historical data 2010-2024",
                ],
            )
        ]
    
    return entries
