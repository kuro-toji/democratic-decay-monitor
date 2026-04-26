import logging
from typing import Optional

from pipeline.db.mongo import get_db

logger = logging.getLogger(__name__)


def _get_snapshot(db, iso3: str, year: int, source: str, dimension: str) -> Optional[float]:
    doc = db.snapshots.find_one({
        "iso3": iso3,
        "year": year,
        "source": source,
        "dimension": dimension,
    })
    if doc:
        return doc.get("score")
    return None


def _redistribute_weights(available: dict[str, float], weights: dict[str, float]) -> dict[str, float]:
    total_weight = sum(weights.get(k, 0) for k in available.keys())
    if total_weight == 0:
        return {k: 0.0 for k in available}
    factor = 1.0 / total_weight
    return {k: weights.get(k, 0) * factor for k in available}


async def compute_electoral_integrity(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    vdem_poly = _get_snapshot(db, iso3, year, "vdem", "electoral_integrity")
    vdem_frefair = _get_snapshot(db, iso3, year, "vdem", "electoral_integrity")
    fh_pr = _get_snapshot(db, iso3, year, "fh", "electoral_integrity")
    wgi_va = _get_snapshot(db, iso3, year, "wgi", "electoral_integrity")

    if vdem_poly is not None:
        sources["vdem_poly"] = vdem_poly
    if vdem_frefair is not None:
        sources["vdem_frefair"] = vdem_frefair
    if fh_pr is not None:
        sources["fh_pr"] = fh_pr
    if wgi_va is not None:
        sources["wgi_va"] = wgi_va

    logger.info(f"electoral_integrity[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    weights = {
        "vdem_poly": 0.4,
        "vdem_frefair": 0.6,
        "fh_pr": 0.5,
        "wgi_va": 0.3,
    }

    available_keys = list(sources.keys())
    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    score = sum(sources[k] * redistributed[k] for k in available_keys)
    return round(score, 4)


async def compute_media_freedom(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    rsf_score = _get_snapshot(db, iso3, year, "rsf", "media_freedom")
    vdem_mec = _get_snapshot(db, iso3, year, "vdem", "media_freedom")
    vdem_har = _get_snapshot(db, iso3, year, "vdem", "media_freedom")

    if rsf_score is not None:
        sources["rsf"] = rsf_score
    if vdem_mec is not None:
        sources["vdem_mec"] = vdem_mec
    if vdem_har is not None:
        sources["vdem_har"] = vdem_har

    logger.info(f"media_freedom[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    weights = {
        "rsf": 0.5,
        "vdem_mec": 0.25,
        "vdem_har": 0.25,
    }

    available_keys = list(sources.keys())
    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    base_score = sum(sources[k] * redistributed[k] for k in available_keys)

    shutdown_doc = db.snapshots.find_one({
        "iso3": iso3,
        "source": "access_now",
        "dimension": "media_freedom",
        "year": year,
    })
    shutdown_count = 0
    if shutdown_doc:
        shutdown_count = shutdown_doc.get("metadata", {}).get("shutdown_count", 0)

    penalty = shutdown_count * 10
    final = max(0.0, min(100.0, base_score - penalty))
    return round(final, 4)


async def compute_rule_of_law(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    wgi_rl = _get_snapshot(db, iso3, year, "wgi", "rule_of_law")
    vdem_jucon = _get_snapshot(db, iso3, year, "vdem", "rule_of_law")

    if wgi_rl is not None:
        sources["wgi_rl"] = wgi_rl
    if vdem_jucon is not None:
        sources["vdem_jucon"] = vdem_jucon

    logger.info(f"rule_of_law[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    weights = {"wgi_rl": 0.5, "vdem_jucon": 0.5}
    available_keys = list(sources.keys())
    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    score = sum(sources[k] * redistributed[k] for k in available_keys)
    return round(score, 4)


async def compute_civil_liberties(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    fh_cl = _get_snapshot(db, iso3, year, "fh", "civil_liberties")
    vdem_cs = _get_snapshot(db, iso3, year, "vdem", "civil_liberties")
    wgi_va = _get_snapshot(db, iso3, year, "wgi", "civil_liberties")

    if fh_cl is not None:
        sources["fh_cl"] = fh_cl
    if vdem_cs is not None:
        sources["vdem_cs"] = vdem_cs
    if wgi_va is not None:
        sources["wgi_va"] = wgi_va

    logger.info(f"civil_liberties[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    weights = {"fh_cl": 0.4, "vdem_cs": 0.4, "wgi_va": 0.2}
    available_keys = list(sources.keys())
    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    score = sum(sources[k] * redistributed[k] for k in available_keys)
    return round(score, 4)


async def compute_institutional_checks(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    vdem_lib = _get_snapshot(db, iso3, year, "vdem", "institutional_checks")
    wgi_ge = _get_snapshot(db, iso3, year, "wgi", "institutional_checks")
    wgi_cc = _get_snapshot(db, iso3, year, "wgi", "institutional_checks")

    if vdem_lib is not None:
        sources["vdem_lib"] = vdem_lib
    if wgi_ge is not None:
        sources["wgi_ge"] = wgi_ge
    if wgi_cc is not None:
        sources["wgi_cc"] = wgi_cc

    logger.info(f"institutional_checks[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    wgi_wgi_avg = None
    if "wgi_ge" in sources and "wgi_cc" in sources:
        wgi_wgi_avg = (sources["wgi_ge"] + sources["wgi_cc"]) / 2

    weights = {"vdem_lib": 0.5, "wgi_wgi_avg": 0.5}
    available_keys = list(sources.keys())
    if wgi_wgi_avg is not None:
        available_keys.append("wgi_wgi_avg")

    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    score = sum(sources.get(k, wgi_wgi_avg) * redistributed[k] for k in available_keys)
    return round(score, 4)


async def compute_polarisation_violence(iso3: str, year: int) -> float:
    db = get_db()
    sources = {}

    gdelt_score = _get_snapshot(db, iso3, year, "gdelt", "polarisation_violence")
    wgi_ps = _get_snapshot(db, iso3, year, "wgi", "polarisation_violence")

    if gdelt_score is not None:
        sources["gdelt"] = gdelt_score
    if wgi_ps is not None:
        sources["wgi_ps"] = wgi_ps

    logger.info(f"polarisation_violence[{iso3}/{year}] sources available: {list(sources.keys())}")

    if not sources:
        return 0.0

    weights = {"gdelt": 0.6, "wgi_ps": 0.4}
    available_keys = list(sources.keys())
    redistributed = _redistribute_weights({k: 1.0 for k in available_keys}, {k: weights.get(k, 0) for k in available_keys})

    score = sum(sources[k] * redistributed[k] for k in available_keys)
    return round(score, 4)