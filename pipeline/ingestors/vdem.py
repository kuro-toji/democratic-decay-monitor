import argparse
import logging
import sys
from datetime import datetime

import pandas as pd
from tqdm import tqdm

sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db
from pipeline.config import Settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VDEM_TO_ISO3 = {
    "AFG": "AFG",
    "ALB": "ALB",
    "AND": "AND",
    "ANG": "AGO",
    "ARG": "ARG",
    "ARM": "ARM",
    "AUS": "AUS",
    "AUT": "AUT",
    "AZE": "AZE",
    "BHR": "BHR",
    "BAN": "BGD",
    "BLR": "BLR",
    "BEL": "BEL",
    "BEN": "BEN",
    "BHU": "BTN",
    "BOL": "BOL",
    "BIH": "BIH",
    "BOT": "BWA",
    "BRA": "BRA",
    "BRU": "BRN",
    "BUL": "BGR",
    "BFA": "BFA",
    "BDI": "BDI",
    "CPV": "CPV",
    "CAM": "KHM",
    "CMR": "CMR",
    "CAN": "CAN",
    "CAF": "CAF",
    "CHA": "TCD",
    "CHI": "CHL",
    "CHN": "CHN",
    "COL": "COL",
    "COM": "COM",
    "COG": "COG",
    "COD": "COD",
    "CRI": "CRI",
    "CRO": "HRV",
    "CUB": "CUB",
    "CYP": "CYP",
    "CZE": "CZE",
    "DNK": "DNK",
    "DJI": "DJI",
    "DOM": "DOM",
    "ECU": "ECU",
    "EGY": "EGY",
    "ESA": "SLV",
    "GNQ": "GNQ",
    "ERI": "ERI",
    "EST": "EST",
    "SWZ": "SWZ",
    "ETH": "ETH",
    "FIJ": "FJI",
    "FIN": "FIN",
    "FRA": "FRA",
    "GAB": "GAB",
    "GAM": "GMB",
    "GEO": "GEO",
    "GER": "DEU",
    "GHA": "GHA",
    "GRE": "GRC",
    "GRN": "GRD",
    "GUA": "GTM",
    "GUI": "GIN",
    "GNB": "GNB",
    "GUY": "GUY",
    "HAI": "HTI",
    "HON": "HND",
    "HUN": "HUN",
    "ISL": "ISL",
    "IND": "IND",
    "IDN": "IDN",
    "IRN": "IRN",
    "IRQ": "IRQ",
    "IRL": "IRL",
    "ISR": "ISR",
    "ITA": "ITA",
    "JAM": "JAM",
    "JPN": "JPN",
    "JOR": "JOR",
    "KAZ": "KAZ",
    "KEN": "KEN",
    "KSV": "XKX",
    "KWT": "KWT",
    "KGZ": "KGZ",
    "LAO": "LAO",
    "LAT": "LVA",
    "LIB": "LBN",
    "LES": "LSO",
    "LBR": "LBR",
    "LBY": "LBY",
    "LIE": "LIE",
    "LTU": "LTU",
    "LUX": "LUX",
    "MDG": "MDG",
    "MWI": "MWI",
    "MAS": "MYS",
    "MLV": "MDV",
    "MLI": "MLI",
    "MLT": "MLT",
    "MHL": "MHL",
    "MTN": "MRT",
    "MUS": "MUS",
    "MEX": "MEX",
    "FSM": "FSM",
    "MDA": "MDA",
    "MCO": "MCO",
    "MGL": "MNG",
    "MNE": "MNE",
    "MAR": "MAR",
    "MOZ": "MOZ",
    "MMR": "MMR",
    "NAM": "NAM",
    "NRU": "NRU",
    "NEP": "NPL",
    "NED": "NLD",
    "NZL": "NZL",
    "NIC": "NIC",
    "NER": "NER",
    "NGA": "NGA",
    "MKD": "MKD",
    "NOR": "NOR",
    "OMN": "OMN",
    "PAK": "PAK",
    "PLW": "PLW",
    "PAN": "PAN",
    "PNG": "PNG",
    "PAR": "PRY",
    "PER": "PER",
    "PHL": "PHL",
    "POL": "POL",
    "POR": "PRT",
    "QAT": "QAT",
    "ROU": "ROU",
    "RUS": "RUS",
    "RWA": "RWA",
    "SAU": "SAU",
    "SEN": "SEN",
    "SRB": "SRB",
    "SYC": "SYC",
    "SLE": "SLE",
    "SGP": "SGP",
    "SVK": "SVK",
    "SVN": "SVN",
    "SLB": "SLB",
    "SOM": "SOM",
    "ZAF": "ZAF",
    "SSD": "SSD",
    "ESP": "ESP",
    "LKA": "LKA",
    "SDN": "SDN",
    "SUR": "SUR",
    "SWE": "SWE",
    "SUI": "CHE",
    "SYR": "SYR",
    "PSE": "PSE",
    "TWN": "TWN",
    "TJK": "TJK",
    "TAN": "TZA",
    "THA": "THA",
    "TLS": "TLS",
    "TOG": "TGO",
    "TON": "TON",
    "TTO": "TTO",
    "TUN": "TUN",
    "TUR": "TUR",
    "TKM": "TKM",
    "TUV": "TUV",
    "UGA": "UGA",
    "UKR": "UKR",
    "ARE": "ARE",
    "GBR": "GBR",
    "USA": "USA",
    "URU": "URY",
    "UZB": "UZB",
    "VAN": "VUT",
    "VEN": "VEN",
    "VIE": "VNM",
    "YEM": "YEM",
    "ZAM": "ZMB",
    "ZIM": "ZWE",
}

DIMENSION_MAP = {
    "electoral_integrity": ["v2x_polyarchy", "v2xel_frefair"],
    "rule_of_law": ["v2x_jucon"],
    "media_freedom": ["v2mecenefi", "v2meharjrn"],
    "civil_liberties": ["v2csreprss"],
    "institutional_checks": ["v2x_liberal"],
}


def normalize_01(val):
    if pd.isna(val):
        return None
    return round(float(val) * 100, 4)


def normalize_04_inverted(val):
    if pd.isna(val):
        return None
    return round((1 - float(val) / 4) * 100, 4)


def parse_year_range(years_str: str):
    if "-" in years_str:
        start, end = years_str.split("-")
        return range(int(start), int(end) + 1)
    return [int(years_str)]


async def ingest_vdem(file_path: str, years: str):
    logger.info(f"Loading V-Dem CSV from {file_path}")
    df = pd.read_csv(file_path, low_memory=False)

    year_range = list(parse_year_range(years))
    df = df[df["year"].isin(year_range)]

    logger.info(f"Loaded {len(df)} rows for years {years}")

    db = get_db()
    total = len(df)
    processed = 0

    for _, row in tqdm(df.iterrows(), total=total, desc="Ingesting V-Dem"):
        iso3 = VDEM_TO_ISO3.get(row["country_text_id"])
        if not iso3:
            continue

        year = int(row["year"])
        created_at = datetime.utcnow()

        records = []

        for dimension, cols in DIMENSION_MAP.items():
            for col in cols:
                raw = row.get(col)
                if col in ("v2mecenefi", "v2meharjrn"):
                    score = normalize_04_inverted(raw)
                else:
                    score = normalize_01(raw)

                if score is None:
                    continue

                records.append({
                    "iso3": iso3,
                    "source": "vdem",
                    "dimension": dimension,
                    "score": score,
                    "raw_value": float(raw) if not pd.isna(raw) else None,
                    "year": year,
                    "created_at": created_at,
                })

        if not records:
            continue

        for record in records:
            await db.snapshots.update_one(
                {
                    "iso3": record["iso3"],
                    "source": record["source"],
                    "dimension": record["dimension"],
                    "year": record["year"],
                },
                {"$set": record},
                upsert=True,
            )

        processed += 1
        if processed % 1000 == 0:
            logger.info(f"Processed {processed}/{total} rows")

    logger.info(f"Ingestion complete. {processed} countries processed.")


def main():
    parser = argparse.ArgumentParser(description="Ingest V-Dem v16 dataset")
    parser.add_argument("--file", required=True, help="Path to V-Dem CSV file")
    parser.add_argument("--years", default="2000-2024", help="Year range, e.g. 2000-2024")
    args = parser.parse_args()

    import asyncio
    asyncio.run(ingest_vdem(args.file, args.years))


if __name__ == "__main__":
    main()