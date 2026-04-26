# Democratic Decay Monitor API

Production-ready FastAPI backend for the Democratic Decay Monitor.

## Quick Start

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MongoDB/Turso connection string |
| `REDIS_URL` | No | Upstash Redis for distributed rate limiting |
| `UPSTASH_REDIS_URL` | No | Alternative Redis URL (Upstash free tier) |
| `ADMIN_API_KEY` | Yes (admin) | Admin key for pipeline trigger endpoints |
| `GITHUB_TOKEN` | Yes (admin) | GitHub token for GitHub Actions API |
| `GITHUB_REPO` | No | GitHub repository (default: kuro-toji/democratic-decay-monitor) |
| `SENTRY_DSN` | No | Sentry DSN for error monitoring |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS whitelist (default: *) |

## Rate Limiting

The API uses slowapi with Redis backend for distributed rate limiting.

### Limits

| Endpoint | Limit |
|----------|-------|
| Global | 100 requests/hour/IP |
| `/v1/history/*` | 10 requests/minute/IP |
| `/v1/scores/*` | 30 requests/minute/IP |

### Bypassing Rate Limits

Researchers can request a research API key by opening a GitHub issue:

1. Open [new issue](https://github.com/kuro-toji/democratic-decay-monitor/issues/new)
2. Select "Research API Key Request" template
3. Provide institution and intended use case
4. Include "X-DDM-Research-Key" header in requests

### Redis Configuration (Upstash Free Tier)

```bash
# Get your free Upstash Redis URL from https://console.upstash.com
export REDIS_URL="redis://default:your-password@your-url.upstash.io:6379"
```

## Admin Endpoints

Requires `X-Admin-Key` header with valid admin key (HMAC-verified).

### Trigger Pipeline

```bash
curl -X POST "https://api.ddm.dev/v1/admin/trigger-pipeline?pipeline=annual" \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

### Check Pipeline Status

```bash
curl "https://api.ddm.dev/v1/admin/pipeline-status" \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

## Structured Logging

All requests are logged in JSON format with hashed IPs:

```json
{
  "event": "request_completed",
  "method": "GET",
  "path": "/v1/countries/HUN",
  "status": 200,
  "duration_ms": 45.2,
  "ip_hash": "a1b2c3d4",
  "iso3": "HUN"
}
```

Never log full IP addresses - they are hashed with SHA256 and truncated to 8 characters.

## Deployment

### Railway

1. Connect GitHub repo to Railway
2. Add environment variables
3. Deploy

### Docker

```bash
docker build -t ddm-api .
docker run -p 8000:8000 --env-file .env ddm-api
```

## Testing

```bash
pytest tests/ -v
```
