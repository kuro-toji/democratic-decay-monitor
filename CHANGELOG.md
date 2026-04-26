# Changelog

All notable changes to the Democratic Decay Monitor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-15

### Added
- Initial API release with countries, scores, history, and alerts endpoints
- V-Dem v14 dataset integration (6 countries: Hungary, Georgia, Poland, Tunisia, Kenya, Serbia)
- Historical data coverage: 2010-2024
- Rate limiting with Redis backend (100 req/hour globally, 10 req/min on /v1/history)
- Structured JSON logging with hashed IPs for privacy
- Admin endpoints for pipeline management via GitHub Actions
- Sentry error monitoring integration
- Comprehensive test suite with pytest
- Cloudflare Pages deployment workflow

### Security
- CORS hardening with origin whitelisting for write operations
- HMAC-based admin key verification (constant-time comparison)
- Security headers middleware (X-Frame-Options, X-Content-Type-Options, etc.)
- Research API key for rate limit bypass

### API Endpoints
- `GET /v1/countries` - List all countries with DDI scores
- `GET /v1/countries/{iso3}` - Get country detail
- `GET /v1/countries/compare` - Compare two countries
- `GET /v1/scores/latest` - Latest DDI scores snapshot
- `GET /v1/scores/ranking` - Country rankings
- `GET /v1/history/{iso3}` - Historical time series
- `GET /v1/history/{iso3}/trend` - Trend analysis with regression
- `GET /v1/history/worst-declines` - Countries with largest DDI drops
- `GET /v1/alerts` - List alerts with filtering
- `GET /v1/alerts/summary` - Alert statistics
- `GET /v1/meta/weights` - DDI dimension weights
- `GET /v1/meta/stats` - System statistics
- `GET /v1/meta/changelog` - Version changelog
- `POST /v1/admin/trigger-pipeline` - Trigger data pipeline (admin only)
- `GET /v1/admin/pipeline-status` - Workflow run status (admin only)

## [0.1.0] - 2024-11-01

### Added
- Project initialization
- V-Dem data pipeline
- Core trajectory engine
- Basic API endpoints
