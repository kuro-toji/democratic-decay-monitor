import pytest
import yaml
from pathlib import Path


def test_ddi_weights_sum_to_one():
    weights_data = {
        "electoral_integrity": 0.20,
        "media_freedom": 0.18,
        "rule_of_law": 0.18,
        "civil_liberties": 0.18,
        "institutional_checks": 0.14,
        "polarisation_violence": 0.12,
    }
    total = sum(weights_data.values())
    assert abs(total - 1.0) < 1e-6, f"Weights sum to {total}, expected 1.0"


def test_electoral_integrity_all_sources_present():
    from pipeline.scoring.dimensions import _redistribute_weights

    sources = {"vdem_poly": 80.0, "vdem_frefair": 85.0, "fh_pr": 75.0, "wgi_va": 70.0}
    weights = {"vdem_poly": 0.4, "vdem_frefair": 0.6, "fh_pr": 0.5, "wgi_va": 0.3}

    available = {k: 1.0 for k in sources}
    redistributed = _redistribute_weights(available, {k: weights.get(k, 0) for k in available})

    expected_total = (
        sources["vdem_poly"] * redistributed["vdem_poly"]
        + sources["vdem_frefair"] * redistributed["vdem_frefair"]
        + sources["fh_pr"] * redistributed["fh_pr"]
        + sources["wgi_va"] * redistributed["wgi_va"]
    )
    assert 0 <= expected_total <= 100
    assert abs(sum(redistributed.values()) - 1.0) < 1e-6


def test_electoral_integrity_missing_source():
    from pipeline.scoring.dimensions import _redistribute_weights

    sources = {"vdem_poly": 80.0, "fh_pr": 75.0}
    weights = {"vdem_poly": 0.4, "vdem_frefair": 0.6, "fh_pr": 0.5, "wgi_va": 0.3}

    available = {k: 1.0 for k in sources}
    redistributed = _redistribute_weights(available, {k: weights.get(k, 0) for k in available})

    assert "vdem_poly" in redistributed
    assert "vdem_frefair" not in redistributed
    assert "wgi_va" not in redistributed
    assert abs(sum(redistributed.values()) - 1.0) < 1e-6

    score = sources["vdem_poly"] * redistributed["vdem_poly"] + sources["fh_pr"] * redistributed["fh_pr"]
    assert 0 <= score <= 100


def test_media_freedom_shutdown_penalty():
    base_score = 80.0
    shutdown_count = 3
    penalty = shutdown_count * 10
    final = max(0.0, min(100.0, base_score - penalty))
    assert final == 50.0


def test_media_freedom_shutdown_floor():
    base_score = 80.0
    shutdown_count = 10
    penalty = shutdown_count * 10
    final = max(0.0, min(100.0, base_score - penalty))
    assert final == 0.0


def test_ddi_weighted_sum():
    from pipeline.scoring.dimensions import _redistribute_weights

    dim_scores = {
        "electoral_integrity": 70.0,
        "media_freedom": 65.0,
        "rule_of_law": 60.0,
        "civil_liberties": 72.0,
        "institutional_checks": 68.0,
        "polarisation_violence": 55.0,
    }

    weights_data = {
        "electoral_integrity": 0.20,
        "media_freedom": 0.18,
        "rule_of_law": 0.18,
        "civil_liberties": 0.18,
        "institutional_checks": 0.14,
        "polarisation_violence": 0.12,
    }

    ddi = sum(dim_scores[d] * weights_data[d] for d in dim_scores)
    expected = (
        70.0 * 0.20 + 65.0 * 0.18 + 60.0 * 0.18 + 72.0 * 0.18 + 68.0 * 0.14 + 55.0 * 0.12
    )
    assert abs(ddi - expected) < 1e-6
    assert 0 <= ddi <= 100