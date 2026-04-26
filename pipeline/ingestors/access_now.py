import argparse
import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OONI_API = "https://api.ooni.io/api/v1/measurements"
ACCESS_NOW_KEEPITON_REPO = "https://raw.githubusercontent.com/accessnow/keepiton/main/data/shutdowns.csv"

ISO2_TO_ISO3 = {
    "AF": "AFG", "AL": "ALB", "DZ": "DZA", "AO": "AGO", "AR": "ARG", "AM": "ARM",
    "AZ": "AZE", "BD": "BGD", "BY": "BLR", "BJ": "BEN", "BT": "BTN", "BO": "BOL",
    "BA": "BIH", "BW": "BWA", "BR": "BRA", "BF": "BFA", "BI": "BDI", "KH": "KHM",
    "CM": "CMR", "CF": "CAF", "TD": "TCD", "CL": "CHL", "CN": "CHN", "CO": "COL",
    "KM": "COM", "CG": "COG", "CD": "COD", "CR": "CRI", "CI": "CIV", "HR": "HRV",
    "CU": "CUB", "CY": "CYP", "CZ": "CZE", "DK": "DNK", "DJ": "DJI", "DO": "DOM",
    "EC": "ECU", "EG": "EGY", "SV": "SLV", "GQ": "GNQ", "ER": "ERI", "EE": "EST",
    "ET": "ETH", "FJ": "FJI", "FI": "FIN", "FR": "FRA", "GA": "GAB", "GM": "GMB",
    "GE": "GEO", "DE": "DEU", "GH": "GHA", "GR": "GRC", "GT": "GTM", "GN": "GIN",
    "GW": "GNB", "GY": "GUY", "HT": "HTI", "HN": "HND", "HU": "HUN", "IS": "ISL",
    "IN": "IND", "ID": "IDN", "IR": "IRN", "IQ": "IRQ", "IE": "IRL", "IL": "ISR",
    "IT": "ITA", "JM": "JAM", "JP": "JPN", "JO": "JOR", "KZ": "KAZ", "KE": "KEN",
    "KP": "PRK", "KR": "KOR", "KW": "KWT", "KG": "KGZ", "LA": "LAO", "LV": "LVA",
    "LB": "LBN", "LS": "LSO", "LR": "LBR", "LY": "LBY", "LT": "LTU", "LU": "LUX",
    "MG": "MDG", "MW": "MWI", "MY": "MYS", "MV": "MDV", "ML": "MLI", "MT": "MLT",
    "MH": "MHL", "MR": "MRT", "MU": "MUS", "MX": "MEX", "FM": "FSM", "MD": "MDA",
    "MN": "MNG", "ME": "MNE", "MA": "MAR", "MZ": "MOZ", "MM": "MMR", "NA": "NAM",
    "NR": "NRU", "NP": "NPL", "NL": "NLD", "NZ": "NZL", "NI": "NIC", "NE": "NER",
    "NG": "NGA", "MK": "MKD", "NO": "NOR", "OM": "OMN", "PK": "PAK", "PW": "PLW",
    "PA": "PAN", "PG": "PNG", "PY": "PRY", "PE": "PER", "PH": "PHL", "PL": "POL",
    "PT": "PRT", "QA": "QAT", "RO": "ROU", "RU": "RUS", "RW": "RWA", "SA": "SAU",
    "SN": "SEN", "RS": "SRB", "SC": "SYC", "SL": "SLE", "SG": "SGP", "SK": "SVK",
    "SI": "SVN", "SB": "SLB", "SO": "SOM", "ZA": "ZAF", "SS": "SSD", "ES": "ESP",
    "LK": "LKA", "SD": "SDN", "SR": "SUR", "SE": "SWE", "CH": "CHE", "SY": "SYR",
    "TW": "TWN", "TJ": "TJK", "TZ": "TZA", "TH": "THA", "TL": "TLS", "TG": "TGO",
    "TO": "TON", "TT": "TTO", "TN": "TUN", "TR": "TUR", "TM": "TKM", "TV": "TUV",
    "UG": "UGA", "UA": "UKR", "AE": "ARE", "GB": "GBR", "US": "USA", "UY": "URY",
    "UZ": "UZB", "VU": "VUT", "VE": "VEN", "VN": "VNM", "YE": "YEM", "ZM": "ZMB",
    "ZW": "ZWE", "XKX": "XKX", "PS": "PSE",
}


def compute_shutdown_penalty(count: int) -> float:
    return min(count * 15.0, 100.0)


async def fetch_access_now_data() -> list[dict]:
    logger.info("Fetching Access Now #KeepItOn data from GitHub")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(ACCESS_NOW_KEEPITON_REPO, timeout=30.0)
            resp.raise_for_status()
            lines = resp.text.strip().split("\n")
            records = []
            for line in lines[1:]:
                parts = line.split(",")
                if len(parts) < 4:
                    continue
                iso2 = parts[0].strip().strip('"')
                try:
                    year = int(parts[1].strip().strip('"'))
                    count = int(parts[2].strip().strip('"'))
                    duration_hrs = float(parts[3].strip().strip('"')) if len(parts) > 3 and parts[3] else 0.0
                except ValueError:
                    continue
                records.append({
                    "iso2": iso2,
                    "year": year,
                    "count": count,
                    "duration_hrs": duration_hrs,
                })
            return records
        except Exception as e:
            logger.warning(f"Access Now GitHub fetch failed: {e}")
            return []


async def fetch_ooni_data(year: int) -> list[dict]:
    logger.info(f"Fetching OONI measurements for {year}")
    async with httpx.AsyncClient() as client:
        try:
            cutoff = datetime(year, 12, 31).isoformat()
            url = f"{OONI_API}?limit=2000&order_by=test_start_time&until={cutoff}"
            resp = await client.get(url, timeout=60.0)
            resp.raise_for_status()
            data = resp.json()

            country_counts: dict[str, int] = {}
            for item in data.get("results", []):
                iso2 = item.get("probe_cc", "")
                if not iso2:
                    continue
                if iso2 not in country_counts:
                    country_counts[iso2] = 0
                country_counts[iso2] += 1

            return [
                {"iso2": iso2, "count": count, "year": year, "duration_hrs": 0.0}
                for iso2, count in country_counts.items()
            ]
        except Exception as e:
            logger.warning(f"OONI API fetch failed: {e}")
            return []


async def ingest_access_now(year: int):
    records = await fetch_access_now_data()
    if not records:
        records = await fetch_ooni_data(year)

    if not records:
        logger.error("No Access Now/OONI data available")
        return

    aggregated: dict[str, dict] = {}
    for record in records:
        iso2 = record["iso2"]
        iso3 = ISO2_TO_ISO3.get(iso2)
        if not iso3:
            continue
        if iso3 not in aggregated:
            aggregated[iso3] = {"count": 0, "duration_hrs": 0.0}
        aggregated[iso3]["count"] += record["count"]
        aggregated[iso3]["duration_hrs"] += record.get("duration_hrs", 0.0)

    logger.info(f"Aggregated shutdown data for {len(aggregated)} countries")

    db = get_db()
    created_at = datetime.utcnow()

    for iso3, agg in tqdm(aggregated.items(), desc="Upserting Access Now"):
        penalty = compute_shutdown_penalty(agg["count"])
        await db.snapshots.update_one(
            {
                "iso3": iso3,
                "source": "access_now",
                "dimension": "media_freedom",
                "year": year,
            },
            {"$set": {
                "iso3": iso3,
                "source": "access_now",
                "dimension": "media_freedom",
                "score": penalty,
                "raw_value": float(agg["count"]),
                "year": year,
                "created_at": created_at,
                "metadata": {
                    "shutdown_count": agg["count"],
                    "duration_hrs": agg["duration_hrs"],
                    "penalty": penalty,
                },
            }},
            upsert=True,
        )

    logger.info(f"Access Now ingestion complete. {len(aggregated)} country records upserted.")


def main():
    parser = argparse.ArgumentParser(description="Ingest Access Now / OONI shutdown data")
    parser.add_argument("--year", type=int, default=2024, help="Year of data")
    args = parser.parse_args()

    asyncio.run(ingest_access_now(args.year))


if __name__ == "__main__":
    main()