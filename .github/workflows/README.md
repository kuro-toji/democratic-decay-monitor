# GitHub Actions Workflows

This directory contains CI/CD workflows for the Democratic Decay Monitor.

## Workflows

### 1. Annual Data Refresh (`pipeline_annual.yml`)

Runs on **February 1st at 02:00 UTC** (after V-Dem and Freedom House publish their annual datasets).

Also triggers manually via `workflow_dispatch`.

**Jobs:**
1. Ingest Freedom House FIW (`freedom_house --download`)
2. Ingest World Bank WGI (`wgi --years 2000-2023`)
3. Compute DDI scores (`compute_ddi --all-countries`)
4. Detect anomalies (`anomaly.detect --all-countries`)
5. Post summary to GitHub Job Summary

### 2. Daily GDELT + Shutdown Signals (`pipeline_daily.yml`)

Runs **daily at 06:00 UTC**.

Also triggers manually via `workflow_dispatch`.

**Jobs:**
1. Ingest GDELT daily events (`gdelt`)
2. Ingest Access Now shutdown data (`access_now --year 2024`)
3. Compute DDI scores for changed countries (`compute_ddi --changed-only`)
4. Detect anomalies for changed countries (`anomaly.detect --changed-only`)

### 3. API Deploy (`api_deploy.yml`)

Runs on **push to `main`** when `api/**` files change.

Also triggers manually via `workflow_dispatch`.

**Jobs:**
1. Install Railway CLI
2. Deploy `ddm-api` service via `railway up`

## Secrets

Required secrets for workflows:

| Secret | Workflow | Description |
|--------|----------|-------------|
| `MONGO_URI` | pipeline_annual, pipeline_daily | MongoDB Atlas connection string |
| `RAILWAY_TOKEN` | api_deploy | Railway CLI authentication token |

### Adding Secrets

1. Go to **Settings → Secrets and variables → Actions** in your repository
2. Click **New repository secret**
3. Add `MONGO_URI` with your MongoDB Atlas connection string (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority`)
4. Add `RAILWAY_TOKEN` with your Railway API token

## Manual Trigger

To trigger any workflow manually:

1. Go to the **Actions** tab in your repository
2. Select the workflow you want to run
3. Click **Run workflow** (right side)
4. Choose branch and fill in any required inputs

## Cron Syntax

| Workflow | Cron | Meaning |
|----------|------|---------|
| pipeline_annual | `0 2 1 2 *` | Feb 1st at 02:00 UTC |
| pipeline_daily | `0 6 * * *` | Daily at 06:00 UTC |