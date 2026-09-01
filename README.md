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
2. Open **SQL Editor** and run `supabase/migrations/001_initial_schema.sql`, then
   `supabase/migrations/002_mixed_frequency.sql` (adds frequency/region/rolling
   columns, the China proxy + India WPI seed catalog, and frequency-aware views).
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
2. Optional (India WPI): add secret `DATA_GOV_IN_API_KEY` (free key from data.gov.in) and,
   if the default WPI resource id is stale, `DATA_GOV_IN_WPI_RESOURCE_ID` = the resource id of
   the current monthly WPI dataset.
3. Then run the **one-time warm start** (seeds ~4y of history so the z-model has a baseline —
   the daily cron otherwise needs 30 daily / 6 monthly observations to go live):
   ```bash
   python scraper/backfill.py            # Yahoo real + synthetic China proxies + (if --wpi-csv) monthly WPI
   python scraper/backfill.py --wpi-csv data.csv --skip-china   # real WPI only
   python scraper/backfill.py --dry-run  # preview without writing
   ```
4. The workflow `.github/workflows/daily-scrape.yml` runs `scraper/run.py` every day at 01:00 UTC (06:30 IST). You can also trigger it manually with the **Run workflow** button to test immediately.

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

The pipeline **never fabricates data day-to-day**. If a source can't be scraped it prints a
`[skip] …` line and simply stores nothing for that day. Manual sources only get
values when the owner enters them on the `/sources` page. The one exception is
the **warm-start backfill** (`backfill.py`), which writes clearly-labelled
`synthetic_seed` history for the China proxies (see "Warm start" below) — those
rows never arm an alert on their own.

> **Note for Windows users**: `psycopg2-binary` is pinned so no compiler is needed.

---

## How the z-score scoring works

For each Tier 1/2/3 signal (per period, per signal):

1. Compute the **per-period % change** of the reading (daily % change for daily
   sources; monthly % change for monthly sources).
2. Compute a **rolling mean and std** of the period % change. The window is
   per-frequency: **90 periods / min 30 obs** (daily), **52 / 12** (weekly),
   **24 / 6** (monthly) — overridable per source via `rolling_window` /
   `rolling_min_periods`. Population std, `ddof=0` — identical in Python and
   TypeScript so charts match the scored statuses.
3. **Today's z-score** = `(today's % change − rolling mean) / rolling std`.
4. **Aggregate** z-scores within a tier as a **simple average** (still on the
   same frequency — monthly signals never get force-dated into a daily score).
5. Map the tier average:

| Tier z-score | Status |
|---|---|
| `|z| < 1.5` | Green |
| `1.5 ≤ |z| < 2.5` | Amber |
| `|z| ≥ 2.5` | Red |

6. When a tier **crosses** into Amber or Red, a row is written to `triggers`
   containing the exact signals, values, % changes and z-scores that caused it
   (for later accuracy review). The same tier remaining red the next day does
   **not** create a duplicate trigger. A tier whose **latest** contributing
   readings are still `synthetic_seed` warm-start placeholders is reported as
   disarmed and **never** writes a trigger — synthetic history alone cannot fire
   an alert.
7. **Overlay policy notices** entered within the last 3 days show the
   **Policy Shock** banner regardless of z-scores — they are never blended in.

> **Warm start.** A first-time deployment runs `scraper/backfill.py` once to
> seed ~4 years of history so the rolling mean/std has a baseline on day one:
> real 4y daily history for Brent, ICE cotton and USD/INR (`live`), real monthly
> India WPI via the OGD API (`live`), and deterministic synthetic daily China
> proxy series anchored to documented levels + the live-scraped spot value
> (`synthetic_seed`). Synthetic rows feed the baseline but are excluded from
> trigger arming.

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
- **Tier 2 — Coincident (1–2 week lead), 45%**: China PTA/MEG/PSF spot proxies, coarse yarn spot, RIL PTA/MEG/PSF, yarn–cotton spread (calculated).
- **Tier 3 — Lagging (0–1 week lead), 20%**: India WPI (chemicals, dye, textiles), indigo dye, caustic soda, weaving-cluster discounts, mill utilization.
- **Overlay** (not in any tier): USD/INR, import duty / GST notices.

| Source | Slug | Freq | Reliability | How it's fed |
|---|---|---|---|---|
| Cotton spot (CAI) | `cotton_spot_cai` | daily | fragile | Best-effort scrape of cai.org.in. CAI's daily report is usually a PDF/image with no stable HTML table, so this may frequently skip. **Manual fallback** on `/sources`. |
| Cotton futures MCX | `cotton_futures_mcx` | daily | fragile | Best-effort scrape of the MCX market page (JS-driven, may be blocked). **Manual fallback** on `/sources`. |
| Cotton futures ICE No.2 | `cotton_futures_ice` | daily | stable | Free Yahoo Finance chart endpoint (`CT=F`). |
| Brent crude | `brent_crude` | daily | stable | Free Yahoo Finance chart endpoint (`BZ=F`). |
| China PTA spot (SunSirs) | `china_pta_spot` | daily | fragile | Free scrape of sunsirs.com (PTA `prodetail-356`). **Directional proxy** for import parity — India is a price taker off Chinese supply. |
| China MEG spot (SunSirs) | `china_meg_spot` | daily | fragile | Free scrape of sunsirs.com (MEG `prodetail-222`). Directional proxy. |
| China PSF spot (SunSirs) | `china_psf_spot` | daily | fragile | Free scrape of sunsirs.com (PSF `prodetail-976`). Directional proxy. |
| Coarse yarn spot (Ne 6s–16s) | `yarn_spot_coarse` | daily | **manual** | **No reliable public feed** (YarnLIVE is a subscription service). Manual entry on `/sources`. |
| PTA / MEG / PSF (RIL circulars) | `pta_price` `meg_price` `psf_price` | daily | **manual** | RIL circular prices are trade-reported; no stable public page. Manual entry. |
| Yarn–cotton spread | `yarn_cotton_spread` | daily | derived | Calculated by the pipeline: yarn ₹/kg − cotton ₹/kg (1 candy = 355.62 kg). Never entered manually. |
| India WPI chemicals | `wpi_chem_organic` `wpi_chem_inorganic` | monthly | fragile | Free OGD API (data.gov.in) — monthly index; requires `DATA_GOV_IN_API_KEY`. |
| India WPI dye | `wpi_dye` | monthly | fragile | Free OGD API (data.gov.in); requires `DATA_GOV_IN_API_KEY`. |
| India WPI textiles (man-made) | `wpi_textiles_mf` | monthly | fragile | Free OGD API (data.gov.in); requires `DATA_GOV_IN_API_KEY`. |
| Indigo dye / caustic soda | `indigo_dye` `caustic_soda` | manual | **manual** | No reliable free public feed. Manual entry. |
| Weaving cash discount (Surat/Ahmedabad) | `weaving_discount_surat` | manual | **manual** | No public feed. Manual entry. |
| Mill operating rate | `mill_utilization` | manual | **manual** | No public feed. Manual entry. |
| USD/INR | `usd_inr` | daily | stable | Free keyless FX API (`open.er-api.com`). |
| Import duty / GST notices | — | notice | manual | Logged on `/sources` (Policy notices). Not scraped in Phase 1. |

**Frequencies.** Sources are `daily` (default), `monthly` (India WPI) or `weekly`.
Scoring windows are per-frequency: daily 90d/30 obs, weekly 52/12, monthly 24/6
(overridable per source via `rolling_window` / `rolling_min_periods`). Staleness
is measured against the source's own expected update cadence.

**Manual signals remain manual.** Indigo dye, caustic soda, weaving discounts,
mill utilization and the RIL PTA/MEG/PSF circulars still have no reliable free
feed and are entered on `/sources`. Do not type Chinese spot values into the
Indian manual form — those now scrape automatically as proxies.

The dashboard visibly distinguishes **stable** (green), **fragile** (amber) and
**manual** (blue) sources, and shows a **STALE** badge when a reading is older
than `expected_update_frequency_hours × 2`.

---

## Adding a new signal source

Everything lives in `scraper/sources_config.py` — you should not need to touch
the scoring logic.

1. Add a `SourceConfig` entry (slug, name, tier, unit, reliability, **frequency**,
   **region**, **rolling_window/rolling_min_periods** for non-default windows, url, notes).
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
   `supabase/migrations/001_initial_schema.sql` (pre-Phase-2 sources) or
   `002_mixed_frequency.sql` so it shows before the first run.

Scoring thresholds and weights live in `src/lib/constants.ts` and
`scraper/scoring.py` (keep them in sync).

---

## Repo layout

```
.github/workflows/daily-scrape.yml   # cron: daily scrape + scoring
scraper/
  run.py                             # CLI pipeline entry
  sources_config.py                  # <-- add/modify sources here (slug, freq, windows, scraper)
  db.py                              # psycopg2 helpers
  derived.py                         # calculated signals (yarn-cotton spread; trust-rank aware)
  scoring.py                         # rule-based z-score scoring + triggers (per-frequency windows)
  backfill.py                        # one-time warm start (real Yahoo + synthetic proxy history)
  scrapers/                          # per-source fetch functions
    chinapoly.py                     #   SunSirs China PTA/MEG/PSF spot (HW_CHECK cookie bypass)
    wpi_india.py                     #   India WPI via data.gov.in OGD API (monthly levels)
  requirements.txt
supabase/migrations/
  001_initial_schema.sql
  002_mixed_frequency.sql            # frequency/region/rolling columns + China/WPI seeds
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