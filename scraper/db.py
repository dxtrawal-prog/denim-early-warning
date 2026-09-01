"""Thin Postgres helpers (psycopg2 direct connection to Supabase)."""

import os

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values


def get_conn():
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DB_URL environment variable is required. "
            "Use a postgresql:// connection string from the Supabase dashboard "
            "(Database > Connect > Connection string)."
        )
    return psycopg2.connect(url, connect_timeout=30)


def upsert_sources(conn, sources):
    """Keep the signal_sources catalog in sync with sources_config.py."""
    rows = [
        (
            s.slug,
            s.name,
            str(s.tier),
            s.unit,
            s.scrape_reliability,
            s.expected_update_frequency_hours,
            s.url,
            s.is_calculated,
            s.notes,
            s.frequency,
            s.region,
            s.rolling_window,
            s.rolling_min_periods,
        )
        for s in sources
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.signal_sources
              (slug, name, tier, unit, scrape_reliability,
               expected_update_frequency_hours, url, is_calculated, notes,
               frequency, region, rolling_window, rolling_min_periods)
            values %s
            on conflict (slug) do update set
              name = excluded.name,
              tier = excluded.tier,
              unit = excluded.unit,
              scrape_reliability = excluded.scrape_reliability,
              expected_update_frequency_hours = excluded.expected_update_frequency_hours,
              url = excluded.url,
              is_calculated = excluded.is_calculated,
              notes = excluded.notes,
              frequency = excluded.frequency,
              region = excluded.region,
              rolling_window = excluded.rolling_window,
              rolling_min_periods = excluded.rolling_min_periods
            """,
            rows,
        )


def slug_to_id(conn):
    with conn.cursor() as cur:
        cur.execute("select id, slug from public.signal_sources")
        return {slug: sid for sid, slug in cur.fetchall()}


def upsert_reading(conn, source_id, date_, value, touch_last_scrape=False, data_quality="live"):
    """Upsert a reading for (source_id, date). Optionally record the scrape."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.signal_readings (source_id, date, value, ingested_at, data_quality)
            values (%s, %s, %s, now(), %s)
            on conflict (source_id, date) do update set
              value = excluded.value,
              ingested_at = now(),
              data_quality = excluded.data_quality
            """,
            (source_id, date_, value, data_quality),
        )
        if touch_last_scrape:
            cur.execute(
                "update public.signal_sources set last_scrape_at = now() where id = %s",
                (source_id,),
            )


def read_sql(conn, sql, params=None) -> pd.DataFrame:
    """pandas DataFrame from a query, without pulling in SQLAlchemy.

    (pandas only officially supports SQLAlchemy/URI/sqlite3 connectables, so we
    build the frame ourselves to avoid warnings and extra dependencies.)
    """
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        columns = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns)