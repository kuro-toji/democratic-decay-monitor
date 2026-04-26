-- Democratic Decay Monitor Database Schema

-- Countries table
CREATE TABLE IF NOT EXISTS countries (
    iso3 VARCHAR(3) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    flag VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- DDI Scores (historical snapshots)
CREATE TABLE IF NOT EXISTS ddi_scores (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    ddi_score DECIMAL(5,4) NOT NULL,
    alert_level VARCHAR(20) DEFAULT 'GREEN',
    weights_version VARCHAR(50),
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(iso3, year)
);

-- Dimension scores
CREATE TABLE IF NOT EXISTS dimension_scores (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    dimension VARCHAR(50) NOT NULL,
    score DECIMAL(5,4) NOT NULL,
    raw_value DECIMAL(10,4),
    source VARCHAR(100),
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(iso3, year, dimension)
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    iso3 VARCHAR(3) REFERENCES countries(iso3) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    dimension VARCHAR(50),
    description TEXT,
    threshold DECIMAL(5,4),
    actual DECIMAL(5,4),
    triggered_at TIMESTAMP DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP
);

-- Pipeline runs
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id SERIAL PRIMARY KEY,
    pipeline_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'running',
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT,
    records_processed INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scores_iso3_year ON ddi_scores(iso3, year DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_iso3 ON alerts(iso3, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_dimension_scores_lookup ON dimension_scores(iso3, dimension, year DESC);

-- Insert initial countries
INSERT INTO countries (iso3, name, region, flag) VALUES
    ('HUN', 'Hungary', 'Europe', '🇭🇺'),
    ('POL', 'Poland', 'Europe', '🇵🇱'),
    ('GEO', 'Georgia', 'Asia', '🇬🇪'),
    ('SRB', 'Serbia', 'Europe', '🇷🇸'),
    ('TUN', 'Tunisia', 'Africa', '🇹🇳'),
    ('KEN', 'Kenya', 'Africa', '🇰🇪'),
    ('IND', 'India', 'Asia', '🇮🇳'),
    ('BRA', 'Brazil', 'South America', '🇧🇷'),
    ('USA', 'United States', 'North America', '🇺🇸'),
    ('GBR', 'United Kingdom', 'Europe', '🇬🇧'),
    ('FRA', 'France', 'Europe', '🇫🇷'),
    ('DEU', 'Germany', 'Europe', '🇩🇪'),
    ('ITA', 'Italy', 'Europe', '🇮🇹'),
    ('ESP', 'Spain', 'Europe', '🇪🇸'),
    ('ZAF', 'South Africa', 'Africa', '🇿🇦'),
    ('NGA', 'Nigeria', 'Africa', '🇳🇬'),
    ('MEX', 'Mexico', 'North America', '🇲🇽'),
    ('ARG', 'Argentina', 'South America', '🇦🇷'),
    ('TUR', 'Turkey', 'Europe', '🇹🇷'),
    ('PHL', 'Philippines', 'Asia', '🇵🇭'),
    ('THA', 'Thailand', 'Asia', '🇹🇭'),
    ('MYS', 'Malaysia', 'Asia', '🇲🇾'),
    ('IDN', 'Indonesia', 'Asia', '🇮🇩'),
    ('VNM', 'Vietnam', 'Asia', '🇻🇳'),
    ('PAK', 'Pakistan', 'Asia', '🇵🇰')
ON CONFLICT (iso3) DO NOTHING;

-- Insert sample DDI scores for all countries (2010-2024)
DO $$
DECLARE
    c RECORD;
    y INTEGER;
    base_score DECIMAL;
    variance DECIMAL;
    score DECIMAL;
BEGIN
    FOR c IN SELECT iso3, 
        CASE iso3
            WHEN 'HUN' THEN 0.75
            WHEN 'POL' THEN 0.80
            WHEN 'GEO' THEN 0.70
            WHEN 'SRB' THEN 0.72
            WHEN 'TUN' THEN 0.68
            WHEN 'KEN' THEN 0.65
            WHEN 'IND' THEN 0.60
            WHEN 'BRA' THEN 0.72
            WHEN 'USA' THEN 0.85
            WHEN 'GBR' THEN 0.88
            WHEN 'FRA' THEN 0.86
            WHEN 'DEU' THEN 0.90
            WHEN 'ITA' THEN 0.78
            WHEN 'ESP' THEN 0.82
            WHEN 'ZAF' THEN 0.62
            WHEN 'NGA' THEN 0.55
            WHEN 'MEX' THEN 0.58
            WHEN 'ARG' THEN 0.65
            WHEN 'TUR' THEN 0.55
            WHEN 'PHL' THEN 0.60
            WHEN 'THA' THEN 0.62
            WHEN 'MYS' THEN 0.70
            WHEN 'IDN' THEN 0.58
            WHEN 'VNM' THEN 0.52
            WHEN 'PAK' THEN 0.48
        END as base
        FROM countries
    LOOP
        FOR y IN 2010..2024 LOOP
            -- Add historical decline trend for certain countries
            IF c.iso3 IN ('HUN', 'POL', 'GEO', 'SRB', 'TUR', 'VNM', 'PAK') THEN
                IF y >= 2015 THEN
                    score := c.base - ((y - 2015) * 0.02) + (random() * 0.03 - 0.015);
                ELSE
                    score := c.base + (random() * 0.02 - 0.01);
                END IF;
            ELSIF c.iso3 = 'POL' AND y >= 2023 THEN
                -- Poland recovery after 2023 elections
                score := 0.65 + ((y - 2023) * 0.05) + (random() * 0.02 - 0.01);
            ELSE
                score := c.base + (random() * 0.04 - 0.02);
            END IF;
            
            -- Clamp between 0.1 and 1.0
            score := GREATEST(0.1, LEAST(1.0, score));
            
            INSERT INTO ddi_scores (iso3, year, ddi_score, alert_level, weights_version)
            VALUES (c.iso3, y, score, 
                CASE 
                    WHEN score < 0.4 THEN 'RED'
                    WHEN score < 0.6 THEN 'YELLOW'
                    ELSE 'GREEN'
                END,
                '1.0.0'
            )
            ON CONFLICT (iso3, year) DO UPDATE SET 
                ddi_score = EXCLUDED.ddi_score,
                alert_level = EXCLUDED.alert_level;
        END LOOP;
    END LOOP;
END $$;

-- Insert dimension scores
DO $$
DECLARE
    c RECORD;
    y INTEGER;
    d RECORD;
    base_score DECIMAL;
BEGIN
    FOR c IN SELECT iso3, ddi_score FROM ddi_scores WHERE year = 2024
    LOOP
        FOR d IN SELECT unnest(ARRAY['electoral_integrity', 'media_freedom', 'rule_of_law', 'civil_liberties', 'institutional_checks', 'polarisation_violence']) as dim,
            unnest(ARRAY[0.95, 0.85, 0.80, 0.90, 0.88, 0.92]) as weight
        LOOP
            INSERT INTO dimension_scores (iso3, year, dimension, score, source)
            VALUES (c.iso3, 2024, d.dim, c.ddi_score * d.weight + (random() * 0.04 - 0.02), 'vdem_v14')
            ON CONFLICT (iso3, year, dimension) DO UPDATE SET score = EXCLUDED.score;
        END LOOP;
    END LOOP;
END $$;

-- Insert sample alerts
INSERT INTO alerts (iso3, alert_type, severity, dimension, description, threshold, actual) VALUES
    ('HUN', 'CRITICAL_DECLINE', 'HIGH', 'media_freedom', 'Sharp decline in media pluralism scores - Orbán captured most independent outlets', 0.15, 0.23),
    ('GEO', 'RAPID_DECLINE', 'HIGH', 'civil_liberties', 'Foreign agent law reminiscent of Russian legislation - civil society crackdown accelerating', 0.15, 0.31),
    ('POL', 'WARNING', 'MEDIUM', 'rule_of_law', 'PiS judicial capture showed early signs of reversal after 2023 elections', 0.20, 0.18),
    ('SRB', 'WARNING', 'MEDIUM', 'electoral_integrity', 'OSCE flags election administration concerns, Vučić media dominance', 0.15, 0.12),
    ('TUR', 'CRITICAL_DECLINE', 'HIGH', 'civil_liberties', 'Post-2016 emergency powers made permanent, civil society space collapsed', 0.15, 0.28),
    ('VNM', 'WARNING', 'MEDIUM', 'media_freedom', 'Online dissent criminalized, no independent journalism allowed', 0.15, 0.19),
    ('PAK', 'WARNING', 'MEDIUM', 'electoral_integrity', 'Military interference in elections,PTI crackdown in 2024', 0.15, 0.21),
    ('PHL', 'WARNING', 'MEDIUM', 'civil_liberties', 'Duterte-era policies continued, journalist killings unprosecuted', 0.15, 0.14),
    ('NGA', 'WARNING', 'MEDIUM', 'rule_of_law', 'Security forces impunity, judicial delays undermine rights', 0.15, 0.11),
    ('BRA', 'WARNING', 'MEDIUM', 'institutional_checks', 'January 2023 events exposed democratic resilience concerns', 0.15, 0.09)
ON CONFLICT DO NOTHING;

-- Create function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for countries
DROP TRIGGER IF EXISTS update_countries_updated_at ON countries;
CREATE TRIGGER update_countries_updated_at
    BEFORE UPDATE ON countries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
