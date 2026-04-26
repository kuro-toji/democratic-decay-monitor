import argparse
import logging
import os
import tempfile
from datetime import datetime

import httpx
import pandas as pd
import pycountry
from tqdm import tqdm

import sys
sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FIW_URL = "https://freedomhouse.org/sites/default/files/2025-02/All_data_FIW_2013-2024.xlsx"

FH_NAME_TO_ISO3 = {
    "Afghanistan": "AFG",
    "Albania": "ALB",
    "Algeria": "DZA",
    "Andorra": "AND",
    "Angola": "AGO",
    "Antigua and Barbuda": "ATG",
    "Argentina": "ARG",
    "Armenia": "ARM",
    "Australia": "AUS",
    "Austria": "AUT",
    "Azerbaijan": "AZE",
    "Bahamas": "BHS",
    "Bahrain": "BHR",
    "Bangladesh": "BGD",
    "Barbados": "BRB",
    "Belarus": "BLR",
    "Belgium": "BEL",
    "Belize": "BLZ",
    "Benin": "BEN",
    "Bhutan": "BTN",
    "Bolivia": "BOL",
    "Bosnia and Herzegovina": "BIH",
    "Botswana": "BWA",
    "Brazil": "BRA",
    "Brunei": "BRN",
    "Bulgaria": "BGR",
    "Burkina Faso": "BFA",
    "Burundi": "BDI",
    "Cabo Verde": "CPV",
    "Cambodia": "KHM",
    "Cameroon": "CMR",
    "Canada": "CAN",
    "Central African Republic": "CAF",
    "Chad": "TCD",
    "Chile": "CHL",
    "China": "CHN",
    "Colombia": "COL",
    "Comoros": "COM",
    "Congo (Brazzaville)": "COG",
    "Congo (Kinshasa)": "COD",
    "Costa Rica": "CRI",
    "Croatia": "HRV",
    "Cuba": "CUB",
    "Cyprus": "CYP",
    "Czech Republic": "CZE",
    "Denmark": "DNK",
    "Djibouti": "DJI",
    "Dominica": "DMA",
    "Dominican Republic": "DOM",
    "Ecuador": "ECU",
    "Egypt": "EGY",
    "El Salvador": "SLV",
    "Equatorial Guinea": "GNQ",
    "Eritrea": "ERI",
    "Estonia": "EST",
    "Eswatini": "SWZ",
    "Ethiopia": "ETH",
    "Fiji": "FJI",
    "Finland": "FIN",
    "France": "FRA",
    "Gabon": "GAB",
    "Gambia": "GMB",
    "Georgia": "GEO",
    "Germany": "DEU",
    "Ghana": "GHA",
    "Greece": "GRC",
    "Grenada": "GRD",
    "Guatemala": "GTM",
    "Guinea": "GIN",
    "Guinea-Bissau": "GNB",
    "Guyana": "GUY",
    "Haiti": "HTI",
    "Honduras": "HND",
    "Hungary": "HUN",
    "Iceland": "ISL",
    "India": "IND",
    "Indonesia": "IDN",
    "Iran": "IRN",
    "Iraq": "IRQ",
    "Ireland": "IRL",
    "Israel": "ISR",
    "Italy": "ITA",
    "Jamaica": "JAM",
    "Japan": "JPN",
    "Jordan": "JOR",
    "Kazakhstan": "KAZ",
    "Kenya": "KEN",
    "Korea, South": "KOR",
    "Kuwait": "KWT",
    "Kyrgyzstan": "KGZ",
    "Laos": "LAO",
    "Latvia": "LVA",
    "Lebanon": "LBN",
    "Lesotho": "LSO",
    "Liberia": "LBR",
    "Libya": "LBY",
    "Liechtenstein": "LIE",
    "Lithuania": "LTU",
    "Luxembourg": "LUX",
    "Madagascar": "MDG",
    "Malawi": "MWI",
    "Malaysia": "MYS",
    "Maldives": "MDV",
    "Mali": "MLI",
    "Malta": "MLT",
    "Marshall Islands": "MHL",
    "Mauritania": "MRT",
    "Mauritius": "MUS",
    "Mexico": "MEX",
    "Micronesia": "FSM",
    "Moldova": "MDA",
    "Monaco": "MCO",
    "Mongolia": "MNG",
    "Montenegro": "MNE",
    "Morocco": "MAR",
    "Mozambique": "MOZ",
    "Myanmar": "MMR",
    "Namibia": "NAM",
    "Nauru": "NRU",
    "Nepal": "NPL",
    "Netherlands": "NLD",
    "New Zealand": "NZL",
    "Nicaragua": "NIC",
    "Niger": "NER",
    "Nigeria": "NGA",
    "North Macedonia": "MKD",
    "Norway": "NOR",
    "Oman": "OMN",
    "Pakistan": "PAK",
    "Palau": "PLW",
    "Panama": "PAN",
    "Papua New Guinea": "PNG",
    "Paraguay": "PRY",
    "Peru": "PER",
    "Philippines": "PHL",
    "Poland": "POL",
    "Portugal": "PRT",
    "Qatar": "QAT",
    "Romania": "ROU",
    "Russia": "RUS",
    "Rwanda": "RWA",
    "Saint Kitts and Nevis": "KNA",
    "Saint Lucia": "LCA",
    "Saint Vincent and the Grenadines": "VCT",
    "Samoa": "WSM",
    "San Marino": "SMR",
    "Sao Tome and Principe": "STP",
    "Saudi Arabia": "SAU",
    "Senegal": "SEN",
    "Serbia": "SRB",
    "Seychelles": "SYC",
    "Sierra Leone": "SLE",
    "Singapore": "SGP",
    "Slovakia": "SVK",
    "Slovenia": "SVN",
    "Solomon Islands": "SLB",
    "Somalia": "SOM",
    "South Africa": "ZAF",
    "South Sudan": "SSD",
    "Spain": "ESP",
    "Sri Lanka": "LKA",
    "Sudan": "SDN",
    "Suriname": "SUR",
    "Sweden": "SWE",
    "Switzerland": "CHE",
    "Syria": "SYR",
    "Taiwan": "TWN",
    "Tajikistan": "TJK",
    "Tanzania": "TZA",
    "Thailand": "THA",
    "Timor-Leste": "TLS",
    "Togo": "TGO",
    "Tonga": "TON",
    "Trinidad and Tobago": "TTO",
    "Tunisia": "TUN",
    "Turkey": "TUR",
    "Turkmenistan": "TKM",
    "Tuvalu": "TUV",
    "Uganda": "UGA",
    "Ukraine": "UKR",
    "United Arab Emirates": "ARE",
    "United Kingdom": "GBR",
    "United States": "USA",
    "Uruguay": "URY",
    "Uzbekistan": "UZB",
    "Vanuatu": "VUT",
    "Venezuela": "VEN",
    "Vietnam": "VNM",
    "Yemen": "YEM",
    "Zambia": "ZMB",
    "Zimbabwe": "ZWE",
    "Crimea": None,
    "Kosovo": "XKX",
    "Tibet": None,
    "Hong Kong": "HKG",
    "Northern Cyprus": None,
    "South Ossetia": None,
    "Abkhazia": None,
    "Gaza Strip": None,
    "West Bank": None,
    "Nagorno-Karabakh": None,
    "Eastern Donbas": None,
    "Puerto Rico": "PRI",
    "Transnistria": None,
}

STATUS_ENCODING = {"F": 100, "PF": 50, "NF": 0}


def normalize_pr_cl(raw: float) -> float:
    return round((7 - raw) / 6 * 100, 4)


def normalize_total(raw: float) -> float:
    return round(raw / 14 * 100, 4)


def normalize_status(raw: str) -> float:
    return STATUS_ENCODING.get(raw, 0)


async def ingest_fh(file_path: str):
    logger.info(f"Loading Freedom House Excel from {file_path}")
    df = pd.read_excel(file_path, sheet_name="FIW06-24", engine="openpyxl")

    logger.info(f"Loaded {len(df)} rows, columns: {list(df.columns)}")

    db = get_db()
    total = len(df)
    processed = 0

    for idx, row in tqdm(df.iterrows(), total=total, desc="Ingesting Freedom House"):
        country_name = str(row.get("Country", "")).strip()
        if not country_name or country_name == "nan":
            continue

        iso3 = FH_NAME_TO_ISO3.get(country_name)
        if iso3 is None:
            try:
                iso3 = pycountry.countries.lookup(country_name).alpha_3
            except Exception:
                logger.warning(f"Unknown country: {country_name}")
                continue

        year = int(row.get("Year", 0))
        pr_raw = row.get("PR")
        cl_raw = row.get("CL")
        status_raw = row.get("Status")
        total_raw = row.get("Total")

        created_at = datetime.utcnow()

        records = []

        if pd.notna(pr_raw):
            pr_score = normalize_pr_cl(float(pr_raw))
            records.append({
                "iso3": iso3,
                "source": "fh",
                "dimension": "electoral_integrity",
                "score": pr_score,
                "raw_value": float(pr_raw),
                "year": year,
                "created_at": created_at,
            })
            records.append({
                "iso3": iso3,
                "source": "fh",
                "dimension": "institutional_checks",
                "score": pr_score,
                "raw_value": float(pr_raw),
                "year": year,
                "created_at": created_at,
            })

        if pd.notna(cl_raw):
            cl_score = normalize_pr_cl(float(cl_raw))
            records.append({
                "iso3": iso3,
                "source": "fh",
                "dimension": "civil_liberties",
                "score": cl_score,
                "raw_value": float(cl_raw),
                "year": year,
                "created_at": created_at,
            })

        if pd.notna(total_raw):
            total_score = normalize_total(float(total_raw))
            records.append({
                "iso3": iso3,
                "source": "fh",
                "dimension": "composite_fh",
                "score": total_score,
                "raw_value": float(total_raw),
                "year": year,
                "created_at": created_at,
            })

        if pd.notna(status_raw):
            status_encoded = normalize_status(str(status_raw).strip())
            records.append({
                "iso3": iso3,
                "source": "fh",
                "dimension": "status_encoded",
                "score": status_encoded,
                "raw_value": status_encoded,
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

    logger.info(f"Ingestion complete. {processed} country-years processed.")


async def download_file() -> str:
    logger.info(f"Downloading Freedom House Excel from {FIW_URL}")
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        with httpx.stream("GET", FIW_URL, timeout=120) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_bytes(chunk_size=8192):
                tmp.write(chunk)
        return tmp.name


def main():
    parser = argparse.ArgumentParser(description="Ingest Freedom House FIW dataset")
    parser.add_argument("--download", action="store_true", help="Auto-download from Freedom House")
    parser.add_argument("--file", help="Path to local Excel file")
    args = parser.parse_args()

    file_path = args.file
    if args.download and not file_path:
        file_path = asyncio.run(download_file())
        logger.info(f"Downloaded to {file_path}")

    if not file_path:
        parser.error("Either --download or --file is required")

    asyncio.run(ingest_fh(file_path))


if __name__ == "__main__":
    main()