"""
One-off warm-start backfill (NOT part of the daily cron).

Seeds 3-4 years of history so the z-score model has a real baseline on day one
instead of waiting 30+ (daily) / 6+ (monthly) observations to accumulate.

What it writes per source (idempotent upserts on source_id + date):

  Real live 4y daily (from the same free Yahoo Finance chart endpoint the
  scrapers already use, range=4y):
      brent_crude, cotton_futures_ice, usd_inr

  Synthetic_seed daily (China proxies have no free daily history; these are
  anchored to documented yearly levels + the real recent values scraped from
  SunSirs, with realistic AR(1) noise). Marked data_quality='synthetic_seed'
  so the scorer's "armed" gate prevents synthetic-only alerts, and derived
  products never treat them as live:
      china_pta_spot, china_meg_spot, china_psf_spot

  Optional real monthly WPI (india) from a CSV exported from data.gov.in,
  one date/value per line (see --wpi-csv):
      wpi_chem_organic, wpi_chem_inorganic, wpi_dye, wpi_textiles_mf

Usage:
    python scraper/backfill.py                          # full warm-start
    python scraper/backfill.py --years 4 --dry-run      # preview, no writes
    python scraper/backfill.py --only brent_crude,cotton_futures_ice
    python scraper/backfill.py --wpi-csv path.csv
    python scraper/backfill.py --skip-china             # skip synthetic proxy
    python scraper/backfill.py --chin-anchor-files dir  # override synthetic anchors

Anchors for the synthetic China series are the documented year-end / research
levels; override any with a CSV of date,value via --china-anchor-files (a
directory of <slug>.csv) to make the seed track real observed points.

Requires SUPABASE_DB_URL in the environment.
"""

import argparse
import os

import numpy as np
import pandas as pd
import requests

import db

# Free, keyless Yahoo chart endpoint already used by the scrapers.
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

YAHOO_SYMBOLS = {
    "brent_crude": "BZ=F",
    "cotton_futures_ice": "CT=F",
    "usd_inr": "INR=X",  # USD/INR cross rate on Yahoo (INR per USD)
}

# Anchors (date, value) for the synthetic China series. These are approximate
# year-end / research levels in CNY/mt. The most recent points are the real
# values scraped from SunSirs (verified this session).
CHINA_ANCHORS = {
    "china_pta_spot": [
        ("2022-12-30", 5700), ("2023-12-29", 5850), ("2024-12-31", 5700),
        ("2025-12-31", 6120), ("2026-05-29", 6258), ("2026-09-01", 6389.75),
    ],
    "china_meg_spot": [
        ("2022-12-30", 4300), ("2023-12-29", 4650), ("2024-12-31", 4800),
        ("2025-12-31", 5550), ("2026-05-29", 5800), ("2026-09-01", 5930.0),
    ],
    "china_psf_spot": [
        ("2022-12-30", 7200), ("2023-12-29", 7350), ("2024-12-31", 7050),
        ("2025-12-31", 7750), ("2026-05-29", 7831), ("2026-09-01", 7931.33),
    ],
}

# Daily volatility floors (# to keep the synthetic series non-degenerate).
_SIGMA = {"china_pta_spot": 0.012, "china_meg_spot": 0.015, "china_psf_spot": 0.010}


def _yahoo_daily(symbol: str, years: int) -> pd.DataFrame:
    r = requests.get(
        YAHOO_URL.format(sym=symbol),
        params={"interval": "1d", "range": f"{years}y"},
        timeout=30,
        headers=YAHOO_HEADERS,
    )
    r.raise_for_status()
    result = r.json()["chart"]["result"][0]
    ts = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]
    rows = []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        rows.append((pd.Timestamp(t, unit="s").date().isoformat(), float(c)))
    return pd.DataFrame(rows, columns=["date", "value"])


def _synthetic_daily(slug: str, years: int, anchors: list[tuple[str, float]]) -> pd.DataFrame:
    """Build a realistic daily series between anchor points (AR(1) noise).

    The final anchor is a REAL scraped value (today), so the synthetic series
    intentionally stops the day BEFORE it: real live data begins on the anchor
    day itself and the synthetic history hands off to it with no jump.
    """
    last_anchor = pd.Timestamp(anchors[-1][0]).normalize()
    end = min(pd.Timestamp.today().normalize(), last_anchor) - pd.DateOffset(days=1)
    start = end - pd.DateOffset(years=years)
    days = pd.date_range(start, end, freq="D", normalize=True)

    anchor_dates = [pd.Timestamp(d) for d, _ in anchors]
    anchor_vals = [v for _, v in anchors]
    # Linear interpolation of anchor levels onto the daily grid.
    base = np.interp(days.astype("int64"), pd.DatetimeIndex(anchor_dates).astype("int64"), anchor_vals)

    rng = np.random.default_rng(42)  # deterministic seed for reproducibility
    noise = np.zeros(len(days))
    for i in range(1, len(days)):
        noise[i] = 0.92 * noise[i - 1] + rng.normal(0, _SIGMA[slug])
    value = base * (1 + noise)
    value = np.clip(value, 2000, 20000)

    # Blend the tail so the last synthetic day lands on the final real anchor
    # (no artificial jump when live data resumes).
    last_val = float(anchor_vals[-1])
    blend = min(10, len(value))
    for k in range(1, blend + 1):
        i = len(value) - k
        t = k / (blend + 1)  # 0 (far) -> ~1 (near last day)
        value[i] = value[i] * (1 - t) + last_val * t
    value[-1] = last_val

    df = pd.DataFrame({"date": days.date, "value": np.round(value, 2)})
    return df[(df["date"].astype(str) <= end.strftime("%Y-%m-%d"))]


def _wpi_from_csv(path: str) -> pd.DataFrame:
    """Load a data.gov.in WPI CSV with columns: slug,date,value."""
    df = pd.read_csv(path)
    for col in ("slug", "date", "value"):
        if col not in df.columns:
            raise SystemExit(f"{path}: missing column {col!r} (need slug,date,value)")
    df["date"] = df["date"].astype(str)
    df["value"] = df["value"].astype(float)
    return df


def _upsert(conn, source_id, date_, value, quality):
    db.upsert_reading(conn, source_id, date_, value, data_quality=quality)


def _upsert_synthetic(conn, source_id, date_, value):
    """Write a synthetic_seed row, but never downgrade an existing LIVE reading."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.signal_readings (source_id, date, value, ingested_at, data_quality)
            values (%s, %s, %s, now(), 'synthetic_seed')
            on conflict (source_id, date) do update set
              value = case when public.signal_readings.data_quality = 'live'
                           then public.signal_readings.value else excluded.value end,
              ingested_at = case when public.signal_readings.data_quality = 'live'
                                 then public.signal_readings.ingested_at else now() end,
              data_quality = case when public.signal_readings.data_quality = 'live'
                                  then public.signal_readings.data_quality else 'synthetic_seed' end
            """,
            (source_id, date_, value),
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Warm-start backfill (one-off)")
    ap.add_argument("--years", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated slugs to backfill")
    ap.add_argument("--skip-china", action="store_true")
    ap.add_argument("--wpi-csv", default="", help="path to WPI CSV (slug,date,value)")
    ap.add_argument("--china-anchor-files", default="", help="dir of <slug>.csv anchors")
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    written = {"live": 0, "synthetic_seed": 0}

    conn = db.get_conn()
    try:
        if not args.dry_run:
            db.upsert_sources(conn, from_sources_config())
            conn.commit()
        ids = db.slug_to_id(conn)

        # 1) Real live Yahoo history.
        for slug, sym in YAHOO_SYMBOLS.items():
            if only and slug not in only:
                continue
            if slug not in ids:
                print(f"  [skip] {slug}: not in DB catalog")
                continue
            df = _yahoo_daily(sym, args.years)
            n = len(df)
            print(f"  yahoo {slug}: {n} real daily rows ({df['date'].iloc[0]} -> {df['date'].iloc[-1]})")
            if not args.dry_run:
                for _, row in df.iterrows():
                    _upsert(conn, ids[slug], row["date"], row["value"], "live")
                    written["live"] += 1

        # 2) Synthetic China proxy daily (marked synthetic_seed).
        if not args.skip_china:
            anchor_overrides = {}
            if args.china_anchor_files and os.path.isdir(args.china_anchor_files):
                for slug in ("china_pta_spot", "china_meg_spot", "china_psf_spot"):
                    p = os.path.join(args.china_anchor_files, f"{slug}.csv")
                    if os.path.isfile(p):
                        df = pd.read_csv(p)
                        anchor_overrides[slug] = list(zip(df["date"].astype(str), df["value"].astype(float)))
                        print(f"  anchors for {slug}: overridden from {p}")

            for slug, anchors in CHINA_ANCHORS.items():
                if only and slug not in only:
                    continue
                if slug not in ids:
                    print(f"  [skip] {slug}: not in DB catalog")
                    continue
                anchors = anchor_overrides.get(slug, anchors)
                df = _synthetic_daily(slug, args.years, anchors)
                n = len(df)
                print(f"  synthetic {slug}: {n} daily rows (data_quality=synthetic_seed, "
                      f"{df['date'].iloc[0]} -> {df['date'].iloc[-1]})")
                if not args.dry_run:
                    for _, row in df.iterrows():
                        _upsert_synthetic(conn, ids[slug], row["date"], row["value"])
                        written["synthetic_seed"] += 1

        # 3) Optional real monthly WPI.
        if args.wpi_csv:
            wpi = _wpi_from_csv(args.wpi_csv)
            if not args.dry_run:
                for _, row in wpi.iterrows():
                    slug = row["slug"]
                    if only and slug not in only:
                        continue
                    if slug not in ids:
                        print(f"  [skip] {slug}: not in DB catalog")
                        continue
                    _upsert(conn, ids[slug], row["date"], row["value"], "live")
                    written["live"] += 1
            print(f"  wpi-csv: {len(wpi)} monthly rows loaded")

        if not args.dry_run:
            conn.commit()
            print(f"done: wrote {written['live']} live, {written['synthetic_seed']} synthetic_seed rows")
        else:
            print("dry-run complete (nothing written)")
    finally:
        conn.close()
    return 0


def from_sources_config():
    """Import the catalog without running run.py. (Kept behind a lazy import
    so backfill.py can be executed as a script.)"""
    from sources_config import SOURCES
    return SOURCES


if __name__ == "__main__":
    raise SystemExit(main())