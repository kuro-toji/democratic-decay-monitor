# Democratic Decay Monitor

An analytical tool for monitoring democratic backsliding using a two-layer architecture: a deterministic trajectory engine grounded in V-Dem data, and an LLM-assisted AIP layer for narrative synthesis and intervention recommendations.

Built for policy analysts and democracy researchers. No API key required for the deterministic layer; MiniMax API key optional for the AIP layer.

---

## Ontology

```
Institution
  └── HealthIndicator (×5)
        ├── HistoricalBaseline
        │     └── AlertCondition
        │           └── InterventionRecord
```

This mirrors a Foundry ontology design. Each object has typed relationships — an **Institution** has many **HealthIndicators**, each with a **HistoricalBaseline** that defines **AlertConditions**, which reference **InterventionRecords** from analogous historical cases.

---

## Classification Logic

Trajectory classified as **DEGRADING** when 3 or more indicators show >15% decline over a 3-year rolling window compared to the prior 5-year mean. **STRESS** when 1–2 indicators decline >15%. **STABLE** when no indicator declines >15%.

Additionally, any indicator whose current value falls below its global one-standard-deviation threshold is marked **CRITICAL**. Any indicator below 90% of the global mean is marked **WARNING**.

Analogue matching uses **cosine similarity** on normalized degradation vectors. Each historical case is encoded as a binary 5-dimension vector (1 = that indicator degraded in the case). Cosine similarity identifies structurally similar precedents. Top 3 matches are injected as context into the AIP layer prompt.

---

## Data Sources

| Source | Indicators | Notes |
|--------|-----------|-------|
| **V-Dem Dataset v14** (vdem.net) | v2juncind, v2elintmon, v2cseeorgs | Judicial independence, electoral integrity, civil society |
| **Freedom House** | RSF Press Freedom Index inverted | Press freedom |
| **World Bank / IDEA** | Electoral indicators cross-referenced | Supplementary electoral data |
| **OSCE/ODIHR** | Electoral observation reports | Contextual validation |

All raw values normalized to 0–1 where higher = stronger democratic health. For inverted variables (censorship, repression), values are flipped so the direction is always: **higher = healthier**.

**Countries in dataset:** Hungary, Georgia, Poland, Tunisia, Kenya, Serbia. **Year range:** 2010–2024.

---

## AIP Layer

The Automated Inference Platform (AIP) layer extends the deterministic classification with LLM-assisted reasoning. When the user runs an analysis:

1. Deterministic layer computes the degradation vector and classifies the trajectory
2. Cosine similarity identifies the top 3 historical analogues
3. A structured prompt is sent to **MiniMax-Text-01** with: country name, current indicator values, trajectory classification, critical flags, and analogue context
4. The model returns a typed JSON object:
   - `trajectory_narrative` — 2–3 sentence summary of what the indicator data shows
   - `primary_risk_factor` — the single leading indicator driving risk
   - `analogue_reasoning` — why the closest historical match is relevant to this case
   - `recommended_interventions` — array of `{type, actor, rationale, historical_success_rate}` drawn from analogous cases
   - `confidence` — HIGH / MEDIUM / LOW
   - `analyst_action` — one sentence on what the analyst should do this week

The AIP layer does **not** override the deterministic layer. If the two layers conflict, the deterministic classification takes precedence for alerts.

**API key (optional):** Set `VITE_MINIMAX_API_KEY` in your environment. Endpoint configurable via `VITE_MINIMAX_API_ENDPOINT`. Without a key, a mock result is returned so the full UI flow still works.

---

## Architecture

```
src/
├── data/
│   ├── types.ts              # TypeScript interfaces
│   ├── index.ts             # Data exports
│   ├── indicators.json      # Country-year V-Dem indicator data (6 countries)
│   ├── analogues.json        # Historical intervention cases (24 cases, with notes)
│   └── baselines.json        # Global indicator baselines
├── lib/
│   ├── trajectoryEngine.ts   # Core algorithm — degradation vector + classification
│   ├── trajectoryEngine.test.ts  # 11 unit tests
│   ├── aipAnalysis.ts        # MiniMax API + robust streaming parser
│   ├── aipAnalysis.test.ts   # 10 parsing resilience tests
│   └── interventionLibrary.ts # Historical case library + recovery overlay
└── components/
    └── Dashboard.tsx         # Full UI — radar, timeline, AIP panel, library
```

---

## Running

```bash
npm install
npm run dev      # development server
npm run build   # production build (TypeScript + Vite)
npm run test    # run all unit tests (21 tests, 2 test files)
```

---

## Demo Mode

Click **DEMO MODE** in the top bar for an automated walkthrough:

1. Selects **Georgia** — DEGRADING trajectory, rapid 2020–2024 decline across all 5 indicators
2. Runs AIP analysis (streams mock result in no-API mode)
3. Highlights the judicial independence line with a pulsing dashed style
4. Shows an analogue callout banner

From Demo Mode, clicking **Serbia** switches to a secondary flow:
- Trajectory classifies as **STRESS** (1–2 indicators declining >15%)
- Different analogue match surfaces — press + executive pressure pattern
- Demonstrates range: two countries, two different trajectory classes, same pipeline

---

## Recovery Overlay

The **RECOVERY OVERLAY** toggle (available after running AIP analysis) superimposes the top analogue's trajectory onto the current country's timeline, shifted so T=0 aligns with the analogue's point of maximum degradation. Recovery cases show an upward trend (dashed lines); failure cases show continued decline.

---

## Methodology

Click **?** in the top bar to open the full methodology modal covering:
- Data source descriptions and V-Dem variable codes
- Trajectory classification thresholds and window definitions
- Cosine similarity analogue matching algorithm
- Deterministic vs. AIP layer comparison table

---

## Key Cases in the Analogue Library

| Case | Period | Notes |
|------|--------|-------|
| **Poland** | 2015–2023 | PiS Constitutional Tribunal capture → EU Article 7 → December 2023 electoral reversal. Outcome: recovery (0.62). Primary demo analogue. |
| **Hungary** | 2011–2023 | Fidesz supermajority, 2011 Constitution, Media Acts, NJC capture. No recovery signal. First EU member state Not Free. Outcome: failure (0.18). |
| **Georgia** | 2020–2024 | Russian-model consolidation, foreign agent law, civil society crackdown. Currently DEGRADING. |
| **Serbia** | 2012–2024 | Vučić/SNS media consolidation, 2019 NGO law, 2024 foreign agent protests. Currently STRESS — 18–24 months from potential capture. |
| **Czech Republic** | 1992–1997 | Mečiar media capture → EU/NATO conditionality → 1998 electoral defeat. Recovery within 2 years. Demonstrates conditionality effectiveness model. |

---


## Deployment

### Frontend (Cloudflare Pages)

The frontend is deployed to Cloudflare Pages with automatic deployments from GitHub Actions.

#### Prerequisites

1. Cloudflare account with Pages enabled
2. GitHub repository with Actions enabled
3. Domain configured in Cloudflare (optional)

#### Required Secrets

Set these in GitHub → Settings → Secrets and variables → Actions:

| Secret | Where to get it | Purpose |
|--------|-----------------|---------|
| `CF_ACCOUNT_ID` | Cloudflare Dashboard → Overview → Account ID | Identifies your Cloudflare account |
| `CF_API_TOKEN` | Cloudflare Dashboard → Profile → API Tokens → Create Token | Grants access to deploy to Pages |
| `API_BASE_URL` | Your API deployment URL | Backend API endpoint for the frontend |

**Creating CF_API_TOKEN:**
1. Go to Cloudflare Dashboard → Profile → API Tokens
2. Create a custom token with the **Cloudflare Pages** template
3. Grant edit permissions for your account
4. Copy the generated token to GitHub Secrets

#### Custom Domain Setup

1. Go to Cloudflare Pages → democratic-decay-monitor → Settings → Custom Domains
2. Add your domain (e.g., `ddm.example.com`)
3. Update DNS in Cloudflare DNS panel with a CNAME to `ddm.pages.dev`
4. SSL will be provisioned automatically

#### Preview Deployments

Every pull request automatically gets a unique preview URL:
```
https://<pr-number>.democratic-decay-monitor.pages.dev
```

This allows you to test changes before merging.

#### Manual Deployment

If you need to deploy without GitHub Actions:

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler pages login

# Deploy directory
wrangler pages deploy frontend/dist --project-name=democratic-decay-monitor
```

### API (Railway)

The backend API is deployed separately. See [api/README.md](api/README.md) for Railway-specific instructions.

#### API Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Turso SQLite connection string |
| `VITE_MINIMAX_API_KEY` | Optional: MiniMax API key for AIP layer |


---

## Embeddable Widget

News outlets can embed a compact DDI widget on their pages:

```html
<!-- Add this script -->
<script src="https://ddm.pages.dev/embed.js" data-iso3="IND"></script>

<!-- Or use a div with specific country -->
<div data-ddm-widget data-iso3="HUN"></div>
```

The widget renders a small card showing the country's flag, DDI score, and alert level. It's ~9KB uncompressed and requires no dependencies.
