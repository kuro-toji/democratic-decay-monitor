import argparse
import asyncio
import logging
import statistics
from datetime import datetime

from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db
from pipeline.anomaly.models import Alert

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DIMENSIONS = [
    "electoral_integrity",
    "media_freedom",
    "rule_of_law",
    "civil_liberties",
    "institutional_checks",
    "polarisation_violence",
]

WINDOW_SIZE = 5


class AnomalyDetector:
    def __init__(self, db):
        self.db = db

    async def _get_history(self, iso3: str, dimension: str, year: int) -> list[tuple[int, float]]:
        docs = self.db.ddi_scores.find(
            {"iso3": iso3, "year": {"$lt": year}},
            {"year": 1, "dimension_scores": 1},
        ).sort("year", -1).limit(WINDOW_SIZE * 2)

        results = []
        for doc in docs:
            dim_scores = doc.get("dimension_scores", {})
            score = dim_scores.get(dimension)
            if score is not None:
                results.append((doc["year"], score))

        results.sort(key=lambda x: x[0])
        return results

    async def detect_dimension(self, iso3: str, dimension: str, year: int, weights_version: str) -> Alert | None:
        history = await self._get_history(iso3, dimension, year)

        if len(history) < 3:
            return None

        scores = [s for _, s in history]

        if len(scores) >= 2:
            mean = statistics.mean(scores)
            if len(scores) >= 2:
                stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0
        else:
            mean = scores[0] if scores else 0.0
            stdev = 0.0

        current_doc = self.db.ddi_scores.find_one({"iso3": iso3, "year": year})
        if not current_doc:
            return None

        current_score = current_doc.get("dimension_scores", {}).get(dimension)
        if current_score is None:
            return None

        if stdev == 0.0:
            prev_score = scores[-1]
            drop = prev_score - current_score
            if drop > 10:
                alert_level = "red"
                z_score = 2.0
            elif drop > 5:
                alert_level = "watch"
                z_score = 1.5
            else:
                return None
        else:
            z_score = (current_score - mean) / stdev
            score_dropped = current_score < scores[-1]

            if score_dropped:
                if abs(z_score) >= 2.0:
                    alert_level = "red"
                elif abs(z_score) >= 1.5:
                    alert_level = "watch"
                else:
                    return None
            else:
                if z_score > 1.5:
                    logger.info(f"{iso3}/{dimension}: z={z_score:.2f} score improved (not alerting)")
                return None

        triggered_at = datetime.utcnow()

        if alert_level == "red":
            desc = f"{dimension.replace('_', ' ').title()} for {iso3} dropped to {current_score:.2f} (z={z_score:.2f}, hist mean={mean:.2f}) — RED alert"
        else:
            desc = f"{dimension.replace('_', ' ').title()} for {iso3} shifted to {current_score:.2f} (z={z_score:.2f}, hist mean={mean:.2f}) — WATCH"

        return Alert(
            iso3=iso3,
            dimension=dimension,
            alert_level=alert_level,
            z_score=round(z_score, 4),
            current_score=round(current_score, 4),
            historical_mean=round(mean, 4),
            triggered_at=triggered_at,
            description=desc,
            weights_version=weights_version,
        )

    async def detect_country(self, iso3: str, year: int, weights_version: str) -> list[Alert]:
        alerts = []
        for dimension in DIMENSIONS:
            alert = await self.detect_dimension(iso3, dimension, year, weights_version)
            if alert:
                alerts.append(alert)
        return alerts

    async def detect_all(self, year: int, iso3: str | None, all_countries: bool) -> dict:
        watch_count = 0
        red_count = 0
        alerted_countries = set()

        if all_countries:
            countries = await self.db.countries.find({}, {"iso3": 1}).to_list(300)
            iso3_list = [c["iso3"] for c in countries]
        elif iso3:
            iso3_list = [iso3]
        else:
            logger.error("Specify --all-countries or --iso3")
            return {"watch": 0, "red": 0}

        weights_doc = self.db.ddi_scores.find_one(sort=[("computed_at", -1)])
        weights_version = weights_doc.get("weights_version", "unknown") if weights_doc else "unknown"

        for iso3 in tqdm(iso3_list, desc="Detecting anomalies"):
            alerts = await self.detect_country(iso3, year, weights_version)

            for alert in alerts:
                await self.db.alerts.update_one(
                    {
                        "iso3": alert.iso3,
                        "dimension": alert.dimension,
                        "triggered_at": alert.triggered_at,
                    },
                    {"$set": alert.model_dump()},
                    upsert=True,
                )

                if alert.alert_level == "watch":
                    watch_count += 1
                    alerted_countries.add(iso3)
                elif alert.alert_level == "red":
                    red_count += 1
                    alerted_countries.add(iso3)

        logger.info(f"Anomaly detection complete: {len(alerted_countries)} countries on watch, {red_count} red alerts")
        return {"watch": watch_count, "red": red_count, "total_countries": len(alerted_countries)}


async def main():
    parser = argparse.ArgumentParser(description="Detect democratic decay anomalies")
    parser.add_argument("--year", type=int, default=2024, help="Year to detect")
    parser.add_argument("--all-countries", action="store_true", help="Run on all countries")
    parser.add_argument("--iso3", help="Run on single country")
    args = parser.parse_args()

    if not args.all_countries and not args.iso3:
        parser.error("Specify --all-countries or --iso3")

    db = get_db()
    detector = AnomalyDetector(db)
    result = await detector.detect_all(args.year, args.iso3, args.all_countries)
    print(f"Result: {result['watch']} watch alerts, {result['red']} red alerts across {result['total_countries']} countries")


if __name__ == "__main__":
    asyncio.run(main())