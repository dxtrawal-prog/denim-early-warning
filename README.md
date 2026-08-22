# Denim Fabric Price Early-Warning System

Phase 1 MVP for a denim fabric trading business. An early-warning dashboard that
ingests commodity/market signals (cotton, yarn, chemicals), scores them with a
**rule-based** (not ML) model, and flags when Indian denim fabric prices are
likely to move in the next 1–6 weeks.

```
┌─────────────────────┐      ┌──────────────────────┐      ┌──────────────┐
│ GitHub Actions      │      │ Supabase (Postgres)  │      │ Vercel       │
│ cron 01:00 UTC      │─────▶│ signal_sources       │◀────▶│ Next.js app  │
│ scraper/run.py      │      │ signal_readings      │      │ 5 pages +    │
│  ingest + derive    │      │ tier_scores          │      │ API routes   │
│  score + triggers   │      │ triggers, outcomes   │      │ (Recharts)   │
└─────────────────────┘      │ policy_notices       │      └──────────────┘
                             └──────────────────────┘
```

- **Frontend + API**: Next.js (App Router, TypeScript) — pages and API routes in one repo.
- **Database**: Supabase (hosted Postgres), accessed from the Next.js API routes via the Supabase JS client.
- **Scraper**: a separate Python script (`scraper/`) using `requests`, `BeautifulSoup`, `pandas`, writing via `psycopg2` directly to the same Postgres DB.
- **Scheduler**: the scraper runs from a GitHub Actions cron job, once daily. No standalone server.
- **Hosting**: Next.js deploys to Vercel.

---

## Quick start

### 1. Database

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/migrations/001_initial_schema.sql` (creates all tables, views, and the seed catalog).
3. From **Project Settings → API** copy the Project URL and the `service_role` key.
4. From **Project Settings → Database → Connection string** copy the pooler `postgresql://…` connection string (used only by the Python scraper).

### 2. Next.js app (Vercel)

1. Push this repo to GitHub and import it into Vercel.
2. Add these environment variables (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy. The five pages are:

| Route | Purpose |
|---|---|
| `/` | Status view: per-tier Green/Amber/Red cards, stale badges, combined weighted "market pressure" score, Policy Shock banner |
| `/trends` | Recharts line charts per signal with amber/red z-score threshold bands; 30/90/180-day range selector |
| `/triggers` | Sortable table of every amber/red crossing; expandable rows show the exact signals and values that caused them |
| `/outcomes` | Manual log of actual fabric price moves (for later backtesting) |
| `/sources` | Source catalog with reliability tags + last-scrape times, manual entry forms, and the policy-notice form |

For local dev: copy `.env.example` to `.env.local`, fill in the two Supabase vars, then `npm install && npm run dev`.

### 3. Scraper + scheduler

1. In GitHub: **Settings → Secrets and variables → Actions**, add secret `SUPABASE_DB_URL` = the pooler connection string from step 1.
2. The workflow `.github/workflows/daily-scrape.yml` runs `scraper/run.py` every day at 01:00 UTC (06:30 IST). You can also trigger it manually with the **Run workflow** button to test immediately.

---

## How to run the scraper manually (testing)

```bash
# from the repo root, with SUPABASE_DB_URL exported
python -m venv .venv
.venv/Scripts/activate            # Windows; on Linux: source .venv/bin/activate
pip install -r scraper/requirements.txt

# full run: ingest scraped signals, derive calculated signals, score tiers
python scraper/run.py

# scoring only (e.g. after entering manual readings on the dashboard)
python scraper/run.py --no-scrape

# ingest only
python scraper/run.py --no-score
```

The pipeline **never fabricates data**. If a source can't be scraped it prints a
`[skip] …` line and simply stores nothing for that day. Manual sources only get
values when the owner enters them on the `/sources` page.

> **Note for Windows users**: `psycopg2-binary` is pinned so no compiler is needed.

---

## How the z-score scoring works

For each Tier 1/2/3 signal (per day, per signal):

1. Compute the **daily % change** of the reading.
2. Compute a **rolling 90-day mean and std** of daily % change (minimum 30 observations; population std, `ddof=0` — identical in Python and TypeScript so charts match the scored statuses).
3. **Today's z-score** = `(today's % change − rolling mean) / rolling std`.
4. **Aggregate** z-scores within a tier as a **simple average**.
5. Map the tier average:

| Tier z-score | Status |
|---|---|
| `|z| < 1.5` | Green |
| `1.5 ≤ |z| < 2.5` | Amber |
| `|z| ≥ 2.5` | Red |

6. When a tier **crosses** into Amber or Red, a row is written to `triggers`
   containing the exact signals, values, % changes and z-scores that caused it
   (for later accuracy review). The same tier remaining red the next day does
   **not** create a duplicate trigger.
7. **Overlay policy notices** entered within the last 3 days show the
   **Policy Shock** banner regardless of z-scores — they are never blended in.

The **combined "market pressure" score** uses the tier weights **35 / 45 / 20**
(Tier 1 / Tier 2 / Tier 3) as a weighted average of the tier z-scores, then maps
to Green/Amber/Red with the same thresholds. The per-tier statuses themselves are
**never weighted** — each tier is shown independently. If a tier has no scores,
it is excluded and the remaining weights are renormalized.

Weights are fixed constants for this phase (`src/lib/constants.ts` and
`scraper/scoring.py`); regression-based weight tuning is intentionally out of scope.

---

## Data sources & reliability

Tier weights and lead times (from the spec):

- **Tier 1 — Leading (3–6 week lead), 35%**: raw cotton spot (CAI), cotton futures (MCX + ICE No.2), Brent crude.
- **Tier 2 — Coincident (1–2 week lead), 45%**: coarse yarn spot, RIL PTA/MEG/PSF, yarn–cotton spread (calculated).
- **Tier 3 — Lagging (0–1 week lead), 20%**: indigo dye, caustic soda, weaving-cluster discounts, mill utilization.
- **Overlay** (not in any tier): USD/INR, import duty / GST notices.

| Source | Slug | Reliability | How it's fed |
|---|---|---|---|
| Cotton spot (CAI) | `cotton_spot_cai` | fragile | Best-effort scrape of cai.org.in. CAI's daily report is usually a PDF/image with no stable HTML table, so this may frequently skip. **Manual fallback** on `/sources`. |
| Cotton futures MCX | `cotton_futures_mcx` | fragile | Best-effort scrape of the MCX market page (JS-driven, may be blocked). **Manual fallback** on `/sources`. |
| Cotton futures ICE No.2 | `cotton_futures_ice` | stable | Free Yahoo Finance chart endpoint (`CT=F`). |
| Brent crude | `brent_crude` | stable | Free Yahoo Finance chart endpoint (`BZ=F`). |
| Coarse yarn spot (Ne 6s–16s) | `yarn_spot_coarse` | **manual** | **No reliable public feed** (YarnLIVE is a subscription service). Manual entry on `/sources`. |
| PTA / MEG / PSF (RIL circulars) | `pta_price` `meg_price` `psf_price` | **manual** | RIL circular prices are trade-reported; no stable public page. Manual entry. |
| Yarn–cotton spread | `yarn_cotton_spread` | derived | Calculated by the pipeline: yarn ₹/kg − cotton ₹/kg (1 candy = 355.62 kg). Never entered manually. |
| Indigo dye / caustic soda | `indigo_dye` `caustic_soda` | **manual** | No reliable free public feed. Manual entry. |
| Weaving cash discount (Surat/Ahmedabad) | `weaving_discount_surat` | **manual** | No public feed. Manual entry. |
| Mill operating rate | `mill_utilization` | **manual** | No public feed. Manual entry. |
| USD/INR | `usd_inr` | stable | Free keyless FX API (`open.er-api.com`). |
| Import duty / GST notices | — | manual | Logged on `/sources` (Policy notices). Not scraped in Phase 1. |

The dashboard visibly distinguishes **stable** (green), **fragile** (amber) and
**manual** (blue) sources, and shows a **STALE** badge when a reading is older
than `expected_update_frequency_hours × 2`.

---

## Adding a new signal source

Everything lives in `scraper/sources_config.py` — you should not need to touch
the scoring logic.

1. Add a `SourceConfig` entry (slug, name, tier, unit, reliability, frequency, url, notes).
2. If it has a scrapeable public page, write a function in `scraper/scrapers/`
   and set `scraper="your_function_name"`. It must return a number or raise
   `ScrapeError` (never fabricate). 
3. If there is **no** reliable public feed, set `scrape_reliability="manual"`
   and `scraper=None` — it automatically appears in the manual-entry form on
   `/sources`.
4. The pipeline upserts the catalog from `sources_config.py` on every run, so a
   new source needs **no** migration. For a derived signal, set
   `is_calculated=True` and add its computation to `scraper/derived.py`.
5. (Optional) add the source to the seed list in
   `supabase/migrations/001_initial_schema.sql` so it shows before the first run.

Scoring thresholds and weights live in `src/lib/constants.ts` and
`scraper/scoring.py` (keep them in sync).

---

## Repo layout

```
.github/workflows/daily-scrape.yml   # cron: daily scrape + scoring
scraper/
  run.py                             # CLI pipeline entry
  sources_config.py                  # <-- add/modify sources here
  db.py                              # psycopg2 helpers
  derived.py                         # calculated signals (yarn-cotton spread)
  scoring.py                         # rule-based z-score scoring + triggers
  scrapers/                          # per-source fetch functions
  requirements.txt
supabase/migrations/001_initial_schema.sql
src/app/                             # pages + API routes (App Router)
src/lib/                             # supabase client, queries, constants, zscore
src/components/                      # shared UI
```

---

## Phase 1 non-goals (explicitly not built)

- No Telegram / email / push notifications.
- No regression-based weight tuning — weights are fixed constants.
- No automated scraping of government duty/GST notifications (manual only).
- No multi-user auth — single-owner tool (Supabase service-role access; add RLS later if needed).
- No yarn→fabric ₹/meter cost-pass formula (a separate later feature).

Phase 2 idea: once `outcomes` has accumulated enough real entries, backtest the
rule-based scores and then train weights with regression.