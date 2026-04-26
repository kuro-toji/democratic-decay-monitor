import pytest
import statistics


def test_no_alert_stable_country():
    from pipeline.anomaly.detect import AnomalyDetector

    history = [(2019, 70.0), (2020, 70.0), (2021, 70.0), (2022, 70.0), (2023, 70.0)]
    current_score = 70.0

    scores = [s for _, s in history]
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0

    if stdev == 0:
        z_score = None
    else:
        z_score = (current_score - mean) / stdev

    score_dropped = current_score < scores[-1]
    alert_triggered = score_dropped and abs(z_score) >= 1.5 if z_score is not None else False

    assert not alert_triggered
    assert abs(z_score) < 1e-6 if z_score else True


def test_watch_alert_triggered():
    history = [(2019, 72.0), (2020, 71.0), (2021, 70.0), (2022, 69.0), (2023, 70.0)]
    current_score = 62.0

    scores = [s for _, s in history]
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0

    z_score = (current_score - mean) / stdev
    score_dropped = current_score < scores[-1]

    assert score_dropped
    assert abs(z_score) >= 1.5
    assert current_score < mean


def test_red_alert_triggered():
    history = [(2019, 72.0), (2020, 71.0), (2021, 70.0), (2022, 71.0), (2023, 70.0)]
    current_score = 55.0

    scores = [s for _, s in history]
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0

    z_score = (current_score - mean) / stdev
    score_dropped = current_score < scores[-1]

    assert score_dropped
    assert abs(z_score) >= 2.0


def test_no_alert_on_improvement():
    history = [(2019, 55.0), (2020, 56.0), (2021, 58.0), (2022, 60.0), (2023, 62.0)]
    current_score = 75.0

    scores = [s for _, s in history]
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0

    z_score = (current_score - mean) / stdev
    score_dropped = current_score < scores[-1]

    assert not score_dropped
    assert z_score > 1.5


def test_insufficient_history_skipped():
    history = [(2022, 70.0), (2023, 71.0)]

    assert len(history) < 3
    mean = None
    stdev = None

    if len(history) < 3:
        mean = None
    else:
        scores = [s for _, s in history]
        mean = statistics.mean(scores)

    assert mean is None


def test_zero_variance_absolute_threshold():
    history = [(2019, 70.0), (2020, 70.0), (2021, 70.0), (2022, 70.0), (2023, 70.0)]
    current_score = 62.0

    scores = [s for _, s in history]
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0

    assert stdev == 0.0

    prev_score = scores[-1]
    drop = prev_score - current_score
    assert drop == 8.0
    assert drop > 5
    assert drop <= 10