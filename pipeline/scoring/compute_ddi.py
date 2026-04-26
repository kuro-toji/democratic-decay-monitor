import argparse
import asyncio
import logging
from datetime import datetime
from pathlib import Path

import yaml
from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db
from pipeline.scoring.dimensions import (
    compute_electoral_integrity,
    compute_media_freedom,
    compute_rule_of_law,
    compute_civil_liberties,
    compute_institutional_checks,
    compute_polarisation_violence,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_weights() -> dict:
    weights_path = Path(__file__).parent.parent.parent / "weights.yaml"
    with open(weights_path) as f:
        return yaml.safe_load(f)


async def compute_ddi_for_country(iso3: str, year: int, weights_version: str) -> dict:
    dim_scores = {
        "electoral_integrity": await compute_electoral_integrity(iso3, year),
        "media_freedom": await compute_media_freedom(iso3, year),
        "rule_of_law": await compute_rule_of_law(iso3, year),
        "civil_liberties": await compute_civil_liberties(iso3, year),
        "institutional_checks": await compute_institutional_checks(iso3, year),
        "polarisation_violence": await compute_polarisation_violence(iso3, year),
    }

    weights = load_weights()
    dimension_weights = weights["dimensions"]

    ddi_score = sum(
        dim_scores[dim] * dimension_weights[dim]["weight"]
        for dim in dim_scores
    )

    alert_level = "none"
    if ddi_score < 30:
        alert_level = "red"
    elif ddi_score < 50:
        alert_level = "watch"

    return {
        "iso3": iso3,
        "ddi_score": round(ddi_score, 4),
        "dimension_scores": {k: round(v, 4) for k, v in dim_scores.items()},
        "alert_level": alert_level,
        "computed_at": datetime.utcnow(),
        "weights_version": weights_version,
        "year": year,
    }


async def ingest_ddi(iso3: str | None, year: int, all_countries: bool, changed_only: bool):
    db = get_db()
    weights = load_weights()
    weights_version = weights.get("version", "unknown")

    if all_countries:
        countries = await db.countries.find({}, {"iso3": 1}).to_list(300)
        iso3_list = [c["iso3"] for c in countries]
    elif iso3:
        iso3_list = [iso3]
    else:
        logger.error("Specify either --all-countries or --iso3")
        return

    logger.info(f"Computing DDI for {len(iso3_list)} countries, year {year}")

    for iso3 in tqdm(iso3_list, desc="Computing DDI"):
        result = await compute_ddi_for_country(iso3, year, weights_version)

        await db.ddi_scores.update_one(
            {
                "iso3": iso3,
                "year": year,
            },
            {"$set": result},
            upsert=True,
        )

    logger.info(f"DDI computation complete for {len(iso3_list)} countries.")


def main():
    parser = argparse.ArgumentParser(description="Compute DDI scores")
    parser.add_argument("--all-countries", action="store_true", help="Compute for all countries")
    parser.add_argument("--iso3", help="Compute for single country ISO3")
    parser.add_argument("--year", type=int, default=2024, help="Year to compute")
    parser.add_argument("--changed-only", action="store_true", help="Compute only for countries with new snapshots")
    args = parser.parse_args()

    if not args.all_countries and not args.iso3 and not args.changed_only:
        parser.error("Specify --all-countries or --iso3 or --changed-only")

    asyncio.run(ingest_ddi(args.iso3, args.year, args.all_countries, args.changed_only))


if __name__ == "__main__":
    main()