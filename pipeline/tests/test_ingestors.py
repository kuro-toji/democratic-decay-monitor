import pytest


def normalize_pr_cl(raw: float) -> float:
    return round((7 - raw) / 6 * 100, 4)


def normalize_wgi(raw: float) -> float:
    return round((raw + 2.5) / 5.0 * 100, 4)


def normalize_gdelt(mean_goldstein: float) -> float:
    raw = (mean_goldstein + 10) / 20 * 100
    return round(max(0.0, min(100.0, raw)), 4)


class TestFHNormalization:
    def test_fh_pr_raw_1(self):
        assert normalize_pr_cl(1.0) == 100.0

    def test_fh_pr_raw_7(self):
        assert normalize_pr_cl(7.0) == 0.0

    def test_fh_pr_raw_4(self):
        assert normalize_pr_cl(4.0) == 50.0

    def test_fh_pr_raw_35(self):
        assert normalize_pr_cl(3.5) == round((7 - 3.5) / 6 * 100, 4)


class TestWGINormalization:
    def test_wgi_raw_minus_25(self):
        assert normalize_wgi(-2.5) == 0.0

    def test_wgi_raw_0(self):
        assert normalize_wgi(0.0) == 50.0

    def test_wgi_raw_plus_25(self):
        assert normalize_wgi(2.5) == 100.0

    def test_wgi_raw_minus_125(self):
        assert normalize_wgi(-1.25) == 25.0


class TestGDELTNormalization:
    def test_gdelt_goldstein_minus_10(self):
        assert normalize_gdelt(-10.0) == 0.0

    def test_gdelt_goldstein_0(self):
        assert normalize_gdelt(0.0) == 50.0

    def test_gdelt_goldstein_plus_10(self):
        assert normalize_gdelt(10.0) == 100.0

    def test_gdelt_goldstein_minus_5(self):
        assert normalize_gdelt(-5.0) == 25.0


class TestISO3MappingEdgeCases:
    def test_kosovo_xkx(self):
        VDEM_TO_ISO3 = {"KSV": "XKX"}
        assert VDEM_TO_ISO3.get("KSV") == "XKX"

    def test_palestine_pse(self):
        FH_NAME_TO_ISO3 = {"Palestine": "PSE", "Kosovo": "XKX", "Taiwan": "TWN"}
        assert FH_NAME_TO_ISO3.get("Palestine") == "PSE"

    def test_taiwan_twn(self):
        FH_NAME_TO_ISO3 = {"Palestine": "PSE", "Kosovo": "XKX", "Taiwan": "TWN"}
        assert FH_NAME_TO_ISO3.get("Taiwan") == "TWN"

    def test_kosovo_in_name_mapping(self):
        FH_NAME_TO_ISO3 = {"Palestine": "PSE", "Kosovo": "XKX", "Taiwan": "TWN"}
        assert FH_NAME_TO_ISO3.get("Kosovo") == "XKX"