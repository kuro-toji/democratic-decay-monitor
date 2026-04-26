-- Democratic Decay Monitor - Full 195 Countries Schema

DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS pipeline_runs CASCADE;
DROP TABLE IF EXISTS dimension_scores CASCADE;
DROP TABLE IF EXISTS ddi_scores CASCADE;
DROP TABLE IF EXISTS countries CASCADE;

CREATE TABLE countries (
    iso3 VARCHAR(3) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    subregion VARCHAR(100),
    flag VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ddi_scores (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    ddi_score DECIMAL(6,4) NOT NULL,
    alert_level VARCHAR(20) DEFAULT 'GREEN',
    weights_version VARCHAR(50),
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(iso3, year)
);

CREATE TABLE dimension_scores (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    dimension VARCHAR(50) NOT NULL,
    score DECIMAL(6,4) NOT NULL,
    raw_value DECIMAL(10,4),
    source VARCHAR(100),
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(iso3, year, dimension)
);

CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    dimension VARCHAR(50),
    description TEXT,
    threshold DECIMAL(6,4),
    actual DECIMAL(6,4),
    triggered_at TIMESTAMP DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP
);

CREATE TABLE pipeline_runs (
    id SERIAL PRIMARY KEY,
    pipeline_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'running',
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT,
    records_processed INTEGER DEFAULT 0
);

CREATE INDEX idx_scores_iso3_year ON ddi_scores(iso3, year DESC);
CREATE INDEX idx_alerts_iso3 ON alerts(iso3, triggered_at DESC);
CREATE INDEX idx_dimension_scores_lookup ON dimension_scores(iso3, dimension, year DESC);
