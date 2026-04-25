# Deployment Guide

This document covers deployment options for the Democratic Decay Monitor.

## Quick Start

### Docker (Recommended)

```bash
# Clone and setup
git clone https://github.com/kuro-toji/democratic-decay-monitor.git
cd democratic-decay-monitor

# Create .env file
cp .env.example .env
# Edit .env with your API keys

# Build and run
docker compose --profile prod up -d

# Check status
docker compose ps
curl http://localhost/api/health/live
```

### Manual Deployment

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Build server
bun --cwd server run build

# Build frontend
bun run build

# Run
PORT=3000 DATABASE_URL=file:data/democracy.db bun run server/dist/index.js
```

## Docker Deployment Options

### Option 1: Docker Compose (Full Stack)

```yaml
# docker-compose.prod.yml
services:
  api:
    image: democratic-decay-monitor:latest
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:data/democracy.db
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
    volumes:
      - ./data:/app/data

  frontend:
    image: nginx:alpine
    volumes:
      - ./dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

### Option 2: Single Container with Nginx

```bash
# Build image
docker build -t ddm .

# Run
docker run -d \
  --name ddm \
  -p 3000:3000 \
  -v ./data:/app/data \
  -e MINIMAX_API_KEY=your_key \
  ddm
```

### Option 3: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ddm-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ddm-api
  template:
    metadata:
      labels:
        app: ddm-api
    spec:
      containers:
        - name: api
          image: democratic-decay-monitor:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              value: "file:data/democracy.db"
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | production | Runtime environment |
| `PORT` | No | 3000 | Server port |
| `DATABASE_URL` | Yes | - | SQLite database path |
| `MINIMAX_API_KEY` | No | - | MiniMax API key for AI analysis |
| `VDEM_API_KEY` | No | - | V-Dem API key for data sync |
| `CORS_ORIGINS` | No | * | Allowed CORS origins |

## Database

The application uses embedded SQLite via libsql. For production:

### Option 1: Local Volume
```yaml
volumes:
  - ./data:/app/data
```

### Option 2: TursoDB (Distributed SQLite)
```bash
# Create Turso database
turso db create ddm-production

# Get connection URL
turso db show ddm-production --url

# Set environment
DATABASE_URL=libsql://your-db.turso.io?authToken=your-token
```

## Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name ddm.example.com;

    # API
    location /api/ {
        proxy_pass http://ddm-api:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    # SSE
    location /api/realtime/ {
        proxy_pass http://ddm-api:3000/api/realtime/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }

    # Frontend
    location / {
        root /var/www/ddm;
        try_files $uri $uri/ /index.html;
    }
}
```

## Health Checks

```bash
# API health
curl http://localhost:3000/api/health/live

# Readiness
curl http://localhost:3000/api/health/ready

# Docker health
docker inspect ddm-api --format='{{.State.Health.Status}}'
```

## CI/CD Setup

### GitHub Actions

1. Add secrets to repository:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
   - `PRODUCTION_HOST`
   - `PRODUCTION_SSH_KEY`

2. Create environments:
   - `staging` (required reviewers: 0)
   - `production` (required reviewers: 1)

3. Push to trigger deployment

### Manual Deployment

```bash
# SSH to server
ssh user@production-server

# Pull latest
cd /opt/ddm
git pull
docker compose pull

# Deploy
docker compose up -d

# Check
docker compose logs -f
```

## Monitoring

### Logs

```bash
# View logs
docker compose logs -f api

# Follow specific service
docker compose logs -f --tail=100 api
```

### Metrics

The API exposes metrics at `/api/health`:
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe
- `GET /api/realtime/status` - SSE connection stats

## Security Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `CORS_ORIGINS` (not `*`)
- [ ] Use strong `MINIMAX_API_KEY`
- [ ] Enable database backups
- [ ] Set up TLS/SSL
- [ ] Configure log rotation
- [ ] Enable rate limiting
- [ ] Review firewall rules

## Troubleshooting

### Database locked
```bash
# Check for running instances
docker compose ps

# Restart services
docker compose restart api
```

### Out of memory
```bash
# Increase memory limit in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 1G
```

### Frontend 502
```bash
# Check API is healthy
curl http://localhost:3000/api/health/live

# Restart API
docker compose restart api
```
