"""
Daily pipeline: ingest scraped signals, compute derived signals, score tiers.

Usage:
    python scraper/run.py                # scrape + derive + score (default)
    python scraper/run.py --no-scrape    # scoring only (after manual entries)
    python scraper/run.py --no-score     # ingest scraped data only

Requires SUPABASE_DB_URL (a postgresql:// connection string) in the env.
"""

import argparse
import importlib
import sys
from datetime import date

import db
import derived
import scoring
from scrapers import ScrapeError
from sources_config import SOURCES


def run_source(conn, ids, cfg):
    """Fetch one source and store a reading for today. Never fabricates data:
    any failure prints a [skip] line and the reading is simply not written."""
    if cfg.is_calculated or not cfg.scraper:
        return
    try:
        mod = importlib.import_module("scrapers")
        fn = getattr(mod, cfg.scraper)
        value = float(fn())
    except ScrapeError as e:
        # Try fallback scraper if primary fails
        if cfg.scraper_fallback:
            try:
                fn2 = getattr(mod, cfg.scraper_fallback)
                value = float(fn2())
            except (ScrapeError, Exception) as e2:
                print(f"  [skip] {cfg.slug}: primary failed ({e}), fallback failed ({e2})")
                return
        else:
            print(f"  [skip] {cfg.slug}: {e}")
            return
    except Exception as e:  # noqa: BLE001 - keep the pipeline alive
        print(f"  [skip] {cfg.slug}: unexpected error: {e!r}")
        return

    source_id = ids.get(cfg.slug)
    if source_id is None:
        print(f"  [skip] {cfg.slug}: source missing from DB (apply migration first)")
        return

    db.upsert_reading(conn, source_id, date.today().isoformat(), value, touch_last_scrape=True)
    print(f"  [ok] {cfg.slug}: {value} {cfg.unit} ({cfg.scrape_reliability})")


def main():
    ap = argparse.ArgumentParser(description="Denim early-warning daily pipeline")
    ap.add_argument("--no-scrape", action="store_true", help="skip scraping and derived signals")
    ap.add_argument("--no-score", action="store_true", help="skip scoring")
    args = ap.parse_args()

    conn = db.get_conn()
    try:
        db.upsert_sources(conn, SOURCES)
        ids = db.slug_to_id(conn)

        if not args.no_scrape:
            print("scrape: starting")
            for cfg in SOURCES:
                run_source(conn, ids, cfg)
            derived.compute_yarn_cotton_spread(conn)
            conn.commit()

        if not args.no_score:
            print("scoring: starting")
            scoring.run_scoring(conn)

        print("done")
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())