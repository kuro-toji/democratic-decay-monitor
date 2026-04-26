import argparse
import asyncio
import logging
from datetime import datetime

import httpx
from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

WB_BASE = "https://api.worldbank.org/v2/country/{iso2}/indicator/{indicator}?format=json&mrv=25&per_page=500"

INDICATORS = {
    "RL.EST": "rule_of_law",
    "VA.EST": "electoral_integrity",
    "GE.EST": "institutional_checks",
    "CC.EST": "institutional_checks",
    "PS.EST": "polarisation_violence",
    "RQ.EST": "institutional_checks",
}

DIMENSION_MAP = {
    "RL.EST": ["rule_of_law"],
    "VA.EST": ["electoral_integrity", "civil_liberties"],
    "GE.EST": ["institutional_checks"],
    "CC.EST": ["institutional_checks"],
    "PS.EST": ["polarisation_violence"],
    "RQ.EST": ["institutional_checks"],
}

SEMAPHORE_LIMIT = 10
MAX_RETRIES = 3
BACKOFF_BASE = 2


def normalize_wgi(raw: float) -> float:
    return round((raw + 2.5) / 5.0 * 100, 4)


async def fetch_indicator(
    client: httpx.AsyncClient,
    iso2: str,
    indicator: str,
    semaphore: asyncio.Semaphore,
) -> list[dict]:
    async with semaphore:
        url = WB_BASE.format(iso2=iso2, indicator=indicator)
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url, timeout=30.0)
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, list) and len(data) > 1:
                    return data[1] or []
                return []
            except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(BACKOFF_BASE ** attempt)
                else:
                    logger.warning(f"Failed {iso2}/{indicator} after {MAX_RETRIES} attempts: {e}")
                    return []
        return []


async def ingest_wgi(years: str):
    db = get_db()

    countries = await db.countries.find({}, {"iso3": 1, "iso2": 1}).to_list(300)
    logger.info(f"Loaded {len(countries)} countries from MongoDB")

    year_start, year_end = map(int, years.split("-"))

    semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)

    async with httpx.AsyncClient() as client:
        tasks = []
        for country in countries:
            iso3 = country["iso3"]
            iso2 = country.get("iso2", "").lower()
            if not iso2:
                logger.warning(f"No iso2 for {iso3}, skipping")
                continue
            for indicator in INDICATORS:
                tasks.append((iso3, iso2, indicator, fetch_indicator(client, iso2, indicator, semaphore)))

        results = []
        for task in tqdm(asyncio.as_completed([t[3] for t in tasks]), total=len(tasks), desc="Fetching WGI"):
            iso3, iso2, indicator, _ = None, None, None, None
            for i, t in enumerate(tasks):
                if t[3] == task:
                    iso3, iso2, indicator = t[0], t[1], t[2]
                    break
            results.append((iso3, iso2, indicator, await task))

    created_at = datetime.utcnow()
    upsert_count = 0

    for iso3, iso2, indicator, records in results:
        for record in records:
            try:
                year = int(record.get("date", 0))
                if year < year_start or year > year_end:
                    continue

                value = record.get("value")
                if value is None or record.get("countryiso3code") != iso3:
                    continue

                score = normalize_wgi(float(value))

                for dimension in DIMENSION_MAP[indicator]:
                    await db.snapshots.update_one(
                        {
                            "iso3": iso3,
                            "source": "wgi",
                            "dimension": dimension,
                            "year": year,
                        },
                        {"$set": {
                            "iso3": iso3,
                            "source": "wgi",
                            "dimension": dimension,
                            "score": score,
                            "raw_value": float(value),
                            "year": year,
                            "created_at": created_at,
                        }},
                        upsert=True,
                    )
                    upsert_count += 1
            except (ValueError, KeyError) as e:
                logger.warning(f"Error processing record for {iso3}/{indicator}: {e}")
                continue

    logger.info(f"WGI ingestion complete. {upsert_count} upserts.")


def main():
    parser = argparse.ArgumentParser(description="Ingest World Bank WGI data")
    parser.add_argument("--years", default="2000-2023", help="Year range, e.g. 2000-2023")
    args = parser.parse_args()

    asyncio.run(ingest_wgi(args.years))


if __name__ == "__main__":
    main()