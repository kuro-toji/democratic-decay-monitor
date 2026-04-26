import argparse
import logging
import sys
from datetime import datetime

import pandas as pd
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

sys.path.insert(0, "/home/kuro/democra/democratic-decay-monitor")
from pipeline.db.mongo import get_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RSF_URL = "https://rsf.org/en/index"

COUNTRY_TO_ISO3 = {
    "Afghanistan": "AFG", "Albania": "ALB", "Algeria": "DZA", "Angola": "AGO",
    "Argentina": "ARG", "Armenia": "ARM", "Australia": "AUS", "Austria": "AUT",
    "Azerbaijan": "AZE", "Bahamas": "BHS", "Bahrain": "BHR", "Bangladesh": "BGD",
    "Belarus": "BLR", "Belgium": "BEL", "Belize": "BLZ", "Benin": "BEN",
    "Bhutan": "BTN", "Bolivia": "BOL", "Bosnia and Herzegovina": "BIH",
    "Botswana": "BWA", "Brazil": "BRA", "Brunei": "BRN", "Bulgaria": "BGR",
    "Burkina Faso": "BFA", "Burundi": "BDI", "Cambodia": "KHM", "Cameroon": "CMR",
    "Canada": "CAN", "Central African Republic": "CAF", "Chad": "TCD",
    "Chile": "CHL", "China": "CHN", "Colombia": "COL", "Comoros": "COM",
    "Congo (Brazzaville)": "COG", "Congo (Kinshasa)": "COD", "Costa Rica": "CRI",
    "Croatia": "HRV", "Cuba": "CUB", "Cyprus": "CYP", "Czech Republic": "CZE",
    "Denmark": "DNK", "Djibouti": "DJI", "Dominica": "DMA", "Dominican Republic": "DOM",
    "Ecuador": "ECU", "Egypt": "EGY", "El Salvador": "SLV", "Equatorial Guinea": "GNQ",
    "Eritrea": "ERI", "Estonia": "EST", "Eswatini": "SWZ", "Ethiopia": "ETH",
    "Fiji": "FJI", "Finland": "FIN", "France": "FRA", "Gabon": "GAB",
    "Gambia": "GMB", "Georgia": "GEO", "Germany": "DEU", "Ghana": "GHA",
    "Greece": "GRC", "Grenada": "GRD", "Guatemala": "GTM", "Guinea": "GIN",
    "Guinea-Bissau": "GNB", "Guyana": "GUY", "Haiti": "HTI", "Honduras": "HND",
    "Hungary": "HUN", "Iceland": "ISL", "India": "IND", "Indonesia": "IDN",
    "Iran": "IRN", "Iraq": "IRQ", "Ireland": "IRL", "Israel": "ISR",
    "Italy": "ITA", "Jamaica": "JAM", "Japan": "JPN", "Jordan": "JOR",
    "Kazakhstan": "KAZ", "Kenya": "KEN", "Korea, North": "PRK", "Korea, South": "KOR",
    "Kosovo": "XKX", "Kuwait": "KWT", "Kyrgyzstan": "KGZ", "Laos": "LAO",
    "Latvia": "LVA", "Lebanon": "LBN", "Lesotho": "LSO", "Liberia": "LBR",
    "Libya": "LBY", "Liechtenstein": "LIE", "Lithuania": "LTU", "Luxembourg": "LUX",
    "Madagascar": "MDG", "Malawi": "MWI", "Malaysia": "MYS", "Maldives": "MDV",
    "Mali": "MLI", "Malta": "MLT", "Mauritania": "MRT", "Mauritius": "MUS",
    "Mexico": "MEX", "Moldova": "MDA", "Mongolia": "MNG", "Montenegro": "MNE",
    "Morocco": "MAR", "Mozambique": "MOZ", "Myanmar": "MMR", "Namibia": "NAM",
    "Nepal": "NPL", "Netherlands": "NLD", "New Zealand": "NZL", "Nicaragua": "NIC",
    "Niger": "NER", "Nigeria": "NGA", "North Macedonia": "MKD", "Norway": "NOR",
    "Oman": "OMN", "Pakistan": "PAK", "Palestine": "PSE", "Panama": "PAN",
    "Papua New Guinea": "PNG", "Paraguay": "PRY", "Peru": "PER", "Philippines": "PHL",
    "Poland": "POL", "Portugal": "PRT", "Qatar": "QAT", "Romania": "ROU",
    "Russia": "RUS", "Rwanda": "RWA", "Saudi Arabia": "SAU", "Senegal": "SEN",
    "Serbia": "SRB", "Sierra Leone": "SLE", "Singapore": "SGP", "Slovakia": "SVK",
    "Slovenia": "SVN", "Somalia": "SOM", "South Africa": "ZAF", "South Sudan": "SSD",
    "Spain": "ESP", "Sri Lanka": "LKA", "Sudan": "SDN", "Suriname": "SUR",
    "Sweden": "SWE", "Switzerland": "CHE", "Syria": "SYR", "Taiwan": "TWN",
    "Tajikistan": "TJK", "Tanzania": "TZA", "Thailand": "THA", "Togo": "TGO",
    "Tunisia": "TUN", "Turkey": "TUR", "Turkmenistan": "TKM", "Uganda": "UGA",
    "Ukraine": "UKR", "United Arab Emirates": "ARE", "United Kingdom": "GBR",
    "United States": "USA", "Uruguay": "URY", "Uzbekistan": "UZB", "Venezuela": "VEN",
    "Vietnam": "VNM", "Yemen": "YEM", "Zambia": "ZMB", "Zimbabwe": "ZWE",
}


async def scrape_rsf(year: int) -> list[dict]:
    logger.info(f"Scraping RSF Press Freedom Index for {year}")
    records = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DDMbot/1.0; +https://ddm.example.com)",
            "Accept": "text/html,application/xhtml+xml",
        }
        resp = requests.get(RSF_URL, headers=headers, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        table = soup.find("table", class_="ranking-table")
        if not table:
            logger.warning("RSF ranking table not found on page")
            return []

        for row in table.find_all("tr")[1:]:
            cols = row.find_all("td")
            if len(cols) < 4:
                continue
            try:
                rank_str = cols[0].get_text(strip=True)
                country_name = cols[1].get_text(strip=True)
                score_str = cols[2].get_text(strip=True)

                rank = int(rank_str.replace("#", "").strip())
                score = float(score_str.replace(",", ".").strip())
                iso3 = COUNTRY_TO_ISO3.get(country_name)
                if not iso3:
                    logger.warning(f"Unknown RSF country: {country_name}")
                    continue

                records.append({
                    "iso3": iso3,
                    "score": score,
                    "raw_rank": rank,
                    "year": year,
                })
            except (ValueError, IndexError):
                continue

    except Exception as e:
        logger.error(f"RSF scraping failed: {e}")
    return records


async def ingest_rsf(file_path: str | None, scrape: bool, year: int):
    records = []

    if scrape:
        records = await scrape_rsf(year)

    if not records and file_path:
        logger.info(f"Loading RSF data from fallback file: {file_path}")
        df = pd.read_csv(file_path)
        for _, row in df.iterrows():
            iso3 = row.get("iso3")
            if pd.isna(iso3):
                continue
            records.append({
                "iso3": str(iso3).strip(),
                "score": float(row["score"]),
                "raw_rank": int(row.get("rank", 0)),
                "year": int(row.get("year", year)),
            })

    if not records:
        logger.error("No RSF data available")
        return

    logger.info(f"Processing {len(records)} RSF records")

    db = get_db()
    created_at = datetime.utcnow()

    for record in tqdm(records, desc="Upserting RSF"):
        await db.snapshots.update_one(
            {
                "iso3": record["iso3"],
                "source": "rsf",
                "dimension": "media_freedom",
                "year": record["year"],
            },
            {"$set": {
                "iso3": record["iso3"],
                "source": "rsf",
                "dimension": "media_freedom",
                "score": record["score"],
                "raw_value": record["score"],
                "year": record["year"],
                "created_at": created_at,
                "metadata": {"rank": record["raw_rank"]},
            }},
            upsert=True,
        )

    logger.info(f"RSF ingestion complete. {len(records)} records upserted.")


def main():
    parser = argparse.ArgumentParser(description="Ingest RSF Press Freedom Index")
    parser.add_argument("--year", type=int, default=2024, help="Year of data")
    parser.add_argument("--file", help="Path to fallback CSV")
    parser.add_argument("--scrape", action="store_true", help="Scrape RSF website")
    args = parser.parse_args()

    import asyncio
    asyncio.run(ingest_rsf(args.file, args.scrape, args.year))


if __name__ == "__main__":
    main()