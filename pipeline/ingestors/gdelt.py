import argparse
import asyncio
import logging
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from urllib.parse import urlparse

import httpx
from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GDELT_MASTER_LIST = "http://data.gdeltproject.org/gdeltv2/masterfilelist.txt"
GDELT_BASE = "http://data.gdeltproject.org/gdeltv2"

FIPS_TO_ISO3 = {
    "AF": "AFG", "AL": "ALB", "DZ": "DZA", "AS": "ASM", "AD": "AND", "AO": "AGO",
    "AI": "AIA", "AQ": "ATA", "AG": "ATG", "AR": "ARG", "AM": "ARM", "AW": "ABW",
    "AU": "AUS", "AT": "AUT", "AZ": "AZE", "BS": "BHS", "BH": "BHR", "BD": "BGD",
    "BB": "BRB", "BY": "BLR", "BE": "BEL", "BZ": "BLZ", "BJ": "BEN", "BM": "BMU",
    "BT": "BTN", "BO": "BOL", "BA": "BIH", "BW": "BWA", "BR": "BRA", "BN": "BRN",
    "BG": "BGR", "BF": "BFA", "BI": "BDI", "KH": "KHM", "CM": "CMR", "CA": "CAN",
    "CV": "CPV", "CF": "CAF", "TD": "TCD", "CL": "CHL", "CN": "CHN", "CO": "COL",
    "KM": "COM", "CG": "COG", "CD": "COD", "CR": "CRI", "CI": "CIV", "HR": "HRV",
    "CU": "CUB", "CY": "CYP", "CZ": "CZE", "DK": "DNK", "DJ": "DJI", "DM": "DMA",
    "DO": "DOM", "EC": "ECU", "EG": "EGY", "SV": "SLV", "GQ": "GNQ", "ER": "ERI",
    "EE": "EST", "ET": "ETH", "FJ": "FJI", "FI": "FIN", "FR": "FRA", "GA": "GAB",
    "GM": "GMB", "GE": "GEO", "DE": "DEU", "GH": "GHA", "GR": "GRC", "GL": "GRL",
    "GD": "GRD", "GT": "GTM", "GN": "GIN", "GW": "GNB", "GY": "GUY", "HT": "HTI",
    "HN": "HND", "HU": "HUN", "IS": "ISL", "IN": "IND", "ID": "IDN", "IR": "IRN",
    "IQ": "IRQ", "IE": "IRL", "IL": "ISR", "IT": "ITA", "JM": "JAM", "JP": "JPN",
    "JO": "JOR", "KZ": "KAZ", "KE": "KEN", "KI": "KIR", "KP": "PRK", "KR": "KOR",
    "KW": "KWT", "KG": "KGZ", "LA": "LAO", "LV": "LVA", "LB": "LBN", "LS": "LSO",
    "LR": "LBR", "LY": "LBY", "LI": "LIE", "LT": "LTU", "LU": "LUX", "MK": "MKD",
    "MG": "MDG", "MW": "MWI", "MY": "MYS", "MV": "MDV", "ML": "MLI", "MT": "MLT",
    "MH": "MHL", "MR": "MRT", "MU": "MUS", "MX": "MEX", "FM": "FSM", "MD": "MDA",
    "MC": "MCO", "MN": "MNG", "ME": "MNE", "MA": "MAR", "MZ": "MOZ", "MM": "MMR",
    "NA": "NAM", "NR": "NRU", "NP": "NPL", "NL": "NLD", "NZ": "NZL", "NI": "NIC",
    "NE": "NER", "NG": "NGA", "NO": "NOR", "OM": "OMN", "PK": "PAK", "PW": "PLW",
    "PA": "PAN", "PG": "PNG", "PY": "PRY", "PE": "PER", "PH": "PHL", "PL": "POL",
    "PT": "PRT", "QA": "QAT", "RO": "ROU", "RU": "RUS", "RW": "RWA", "KN": "KNA",
    "LC": "LCA", "VC": "VCT", "WS": "WSM", "SM": "SMR", "ST": "STP", "SA": "SAU",
    "SN": "SEN", "RS": "SRB", "SC": "SYC", "SL": "SLE", "SG": "SGP", "SK": "SVK",
    "SI": "SVN", "SB": "SLB", "SO": "SOM", "ZA": "ZAF", "SS": "SSD", "ES": "ESP",
    "LK": "LKA", "SD": "SDN", "SR": "SUR", "SE": "SWE", "CH": "CHE", "SY": "SYR",
    "TW": "TWN", "TJ": "TJK", "TZ": "TZA", "TH": "THA", "TL": "TLS", "TG": "TGO",
    "TO": "TON", "TT": "TTO", "TN": "TUN", "TR": "TUR", "TM": "TKM", "TV": "TUV",
    "UG": "UGA", "UA": "UKR", "AE": "ARE", "GB": "GBR", "US": "USA", "UY": "URY",
    "UZ": "UZB", "VU": "VUT", "VE": "VEN", "VN": "VNM", "YE": "YEM", "ZM": "ZMB",
    "ZW": "ZWE", "AQ": "ATA", "BV": "BVT", "IO": "IOT", "CX": "CXR", "CC": "CCK",
    "CK": "COK", "IDO": "IDN", "GL": "GRL", "HM": "HMD", "VA": "VAT", "KI": "KIR",
    "MO": "MAC", "MN": "MNG", "NC": "NCL", "NF": "NFK", "PN": "PCN", "SB": "SLB",
    "TK": "TKL", "WF": "WLF", "WS": "WSM", "XKX": "XKX", "PS": "PSE", "HK": "HKG",
}

VIOLENCE_CODES = {"17", "18", "19"}
PROTEST_CODES = {"14", "15"}

SEMAPHORE_LIMIT = 5


def normalize_gdelt(mean_goldstein: float) -> float:
    raw = (mean_goldstein + 10) / 20 * 100
    return round(max(0.0, min(100.0, raw)), 4)


async def get_file_list_for_date(target_date: datetime) -> list[str]:
    date_str = target_date.strftime("%Y%m%d")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(GDELT_MASTER_LIST, timeout=30.0)
            resp.raise_for_status()
            lines = resp.text.strip().split("\n")
            file_urls = []
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 3:
                    url = parts[2]
                    if date_str in url and url.endswith(".zip"):
                        file_urls.append(url)
            return file_urls
        except Exception as e:
            logger.error(f"Failed to fetch master file list: {e}")
            return []


async def fetch_and_parse_zip(
    client: httpx.AsyncClient,
    url: str,
    semaphore: asyncio.Semaphore,
    aggregations: dict,
    lock: asyncio.Lock,
) -> None:
    async with semaphore:
        try:
            resp = await client.get(url, timeout=60.0)
            resp.raise_for_status()
            z = zipfile.ZipFile(BytesIO(resp.content))
            for filename in z.namelist():
                if not filename.endswith(".csv"):
                    continue
                with z.open(filename) as f:
                    for line in f:
                        try:
                            parts = line.decode("utf-8", errors="ignore").strip().split("\t")
                            if len(parts) < 8:
                                continue
                            fips = parts[5].strip()
                            event_code = parts[4].strip()
                            goldstein_str = parts[6].strip()
                            mentions_str = parts[8].strip()
                            sqldate_str = parts[9].strip()

                            if not fips or fips == "" or fips == " -9":
                                continue

                            iso3 = FIPS_TO_ISO3.get(fips)
                            if not iso3:
                                continue

                            try:
                                goldstein = float(goldstein_str) if goldstein_str else 0.0
                                mentions = int(mentions_str) if mentions_str else 1
                            except ValueError:
                                continue

                            is_violence = event_code.startswith(("17", "18", "19"))
                            is_protest = event_code.startswith(("14", "15"))

                            if not (is_violence or is_protest):
                                continue

                            async with lock:
                                if iso3 not in aggregations:
                                    aggregations[iso3] = {
                                        "goldstein_sum": 0.0,
                                        "mentions_sum": 0,
                                        "violence_count": 0,
                                        "protest_count": 0,
                                        "event_count": 0,
                                    }
                                agg = aggregations[iso3]
                                agg["goldstein_sum"] += goldstein * mentions
                                agg["mentions_sum"] += mentions
                                agg["event_count"] += 1
                                if is_violence:
                                    agg["violence_count"] += 1
                                if is_protest:
                                    agg["protest_count"] += 1
                        except Exception:
                            continue
        except Exception as e:
            logger.warning(f"Failed to process {url}: {e}")


async def ingest_gdelt(date_str: str):
    if date_str:
        target_date = datetime.strptime(date_str, "%Y-%m-%d")
    else:
        target_date = datetime.utcnow() - timedelta(days=1)

    logger.info(f"Fetching GDELT data for {target_date.strftime('%Y-%m-%d')}")

    file_urls = await get_file_list_for_date(target_date)
    logger.info(f"Found {len(file_urls)} files for date {target_date.strftime('%Y%m%d')}")

    if not file_urls:
        logger.warning("No GDELT files found for date. GDELT may not have published yet.")
        return

    aggregations: dict = {}
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)

    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_and_parse_zip(client, url, semaphore, aggregations, lock)
            for url in file_urls
        ]
        await asyncio.gather(*tasks)

    logger.info(f"Aggregated data for {len(aggregations)} countries")

    db = get_db()
    created_at = datetime.utcnow()
    year = target_date.year
    upsert_count = 0

    for iso3, agg in tqdm(aggregations.items(), desc="Upserting GDELT"):
        if agg["mentions_sum"] == 0:
            mean_goldstein = 0.0
        else:
            mean_goldstein = agg["goldstein_sum"] / agg["mentions_sum"]

        score = normalize_gdelt(mean_goldstein)

        record = {
            "iso3": iso3,
            "source": "gdelt",
            "dimension": "polarisation_violence",
            "score": score,
            "raw_value": mean_goldstein,
            "year": year,
            "created_at": created_at,
            "metadata": {
                "mentions_sum": agg["mentions_sum"],
                "violence_count": agg["violence_count"],
                "protest_count": agg["protest_count"],
                "total_events": agg["event_count"],
                "date": target_date.strftime("%Y-%m-%d"),
            },
        }

        await db.snapshots.update_one(
            {
                "iso3": iso3,
                "source": "gdelt",
                "dimension": "polarisation_violence",
                "year": year,
            },
            {"$set": record},
            upsert=True,
        )
        upsert_count += 1

    logger.info(f"GDELT ingestion complete. {upsert_count} country upserts.")


def main():
    parser = argparse.ArgumentParser(description="Ingest GDELT 2.0 daily events")
    parser.add_argument("--date", help="Date in YYYY-MM-DD format (default: yesterday)")
    args = parser.parse_args()

    asyncio.run(ingest_gdelt(args.date))


if __name__ == "__main__":
    main()