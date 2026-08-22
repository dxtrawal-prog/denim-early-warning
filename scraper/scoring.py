"""
Rule-based scoring (Phase 1 — no ML / no regression weight tuning).

For every Tier 1/2/3 signal:
  1. compute a rolling 90-day mean/std of daily % change (min 30 obs),
  2. today's z-score = (today's % change - rolling mean) / rolling std,
  3. aggregate signal z-scores within a tier (simple average),
  4. map the tier average to green/amber/red:
         green  |z| < 1.5
         amber  1.5 <= |z| < 2.5
         red    |z| >= 2.5
  5. write the tier score; when a tier crosses into amber/red, write a
     `triggers` row containing the exact signals/values that caused it.

Weights (35/45/20) are used ONLY by the dashboard's combined "market pressure"
score, never to weight the per-tier statuses.

Note: pandas std uses ddof=0 (population) here to match the TypeScript rolling
z-score used by the /trends charts.
"""

import json
from datetime import date

import numpy as np
import pandas as pd

import db

Z_AMBER = 1.5
Z_RED = 2.5
WINDOW = 90
MIN_PERIODS = 30

TIER_WEIGHTS = {"1": 0.35, "2": 0.45, "3": 0.20}


def status_for_z(z: float) -> str:
    az = abs(z)
    if az >= Z_RED:
        return "red"
    if az >= Z_AMBER:
        return "amber"
    return "green"


def load_readings(conn) -> pd.DataFrame:
    df = db.read_sql(
        conn,
        """
        select r.source_id, s.slug, s.name, s.tier, s.unit, r.date, r.value
        from public.signal_readings r
        join public.signal_sources s on s.id = r.source_id
        where s.tier in ('1', '2', '3')
          and r.data_quality in ('live', 'manual')
        order by r.source_id, r.date
        """,
    )
    df["value"] = df["value"].astype(float)
    return df


def compute_signal_zs(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["source_id", "date"]).reset_index(drop=True)

    def _day_change(group):
        if group.name == "yarn_cotton_spread":
            return group["value"].diff()
        return group["value"].pct_change() * 100.0

    df["pct"] = df.groupby("source_id").apply(_day_change, include_groups=False).reset_index(level=0, drop=True)
    g = df.groupby("source_id")["pct"]
    df["mean"] = g.transform(lambda s: s.rolling(WINDOW, min_periods=MIN_PERIODS).mean())
    df["std"] = g.transform(lambda s: s.rolling(WINDOW, min_periods=MIN_PERIODS).std(ddof=0))
    df["z"] = np.where(
        df["std"].isna() | df["pct"].isna() | (df["std"] == 0),
        np.nan,
        (df["pct"] - df["mean"]) / df["std"],
    )
    return df


def latest_signals_per_tier(df: pd.DataFrame) -> dict[str, list[pd.Series]]:
    valid = df[df["z"].notna()]
    if valid.empty:
        return {}
    latest = valid.sort_values("date").groupby("source_id").tail(1)
    tiers: dict[str, list[pd.Series]] = {}
    for _, row in latest.iterrows():
        tiers.setdefault(row["tier"], []).append(row)
    return tiers


def build_detail(rows: list[pd.Series]) -> list[dict]:
    detail = [
        {
            "slug": r["slug"],
            "name": r["name"],
            "unit": r["unit"],
            "value": float(r["value"]),
            "date": str(r["date"]),
            "pct_change": float(r["pct"]) if pd.notna(r["pct"]) else None,
            "z": float(r["z"]),
        }
        for r in rows
    ]
    detail.sort(key=lambda d: -abs(d["z"]))
    return detail


def upsert_tier_score(conn, today, tier, avg_z, status, detail):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.tier_scores (date, tier, z_score, status, signal_count, detail)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (date, tier) do update set
              z_score = excluded.z_score,
              status = excluded.status,
              signal_count = excluded.signal_count,
              detail = excluded.detail
            """,
            (today, int(tier), round(float(avg_z), 4), status, len(detail), json.dumps(detail)),
        )


def detect_trigger(conn, today, tier, avg_z, status, detail):
    """Log a trigger when a tier crosses into amber/red (not on repeats)."""
    if status == "green":
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            select status from public.tier_scores
            where tier = %s and date < %s
            order by date desc limit 1
            """,
            (int(tier), today),
        )
        row = cur.fetchone()
        prev_status = row[0] if row else "green"

        if status == "amber" and prev_status != "amber":
            level = "amber"
        elif status == "red" and prev_status != "red":
            level = "red"
        else:
            return  # still amber/red — don't spam

        cur.execute(
            "select 1 from public.triggers where date = %s and tier = %s and level = %s limit 1",
            (today, str(tier), level),
        )
        if cur.fetchone():
            return

        payload = {
            "tier_z": round(float(avg_z), 4),
            "status": status,
            "signals": detail,
        }
        cur.execute(
            """
            insert into public.triggers (date, tier, level, triggering_signals)
            values (%s, %s, %s, %s)
            """,
            (today, str(tier), level, json.dumps(payload)),
        )
        print(f"  [trigger] tier {tier} -> {level.upper()} (z={avg_z:.2f})")


def run_scoring(conn, today=None):
    today = today or date.today().isoformat()
    df = load_readings(conn)
    if df.empty:
        print("scoring: no live/manual readings yet, skipping")
        return

    df = compute_signal_zs(df)

    for tier in ("1", "2", "3"):
        tier_df = df[df["tier"] == tier]
        if tier_df.empty:
            print(f"scoring: tier {tier}: no readings at all")
            continue

        tier_with_z = tier_df[tier_df["z"].notna()]
        if tier_with_z.empty:
            total_readings = len(tier_df)
            sources_in_tier = tier_df["slug"].nunique()
            print(
                f"scoring: tier {tier}: no z-scores yet "
                f"({total_readings} total readings across {sources_in_tier} sources, "
                f"need {MIN_PERIODS}+ per signal)"
            )
            continue

        latest = tier_with_z.sort_values("date").groupby("source_id").tail(1)
        avg_z = float(np.mean([latest["z"]]))
        status = status_for_z(avg_z)
        detail = build_detail(list(latest.itertuples()))
        upsert_tier_score(conn, today, tier, avg_z, status, detail)
        detect_trigger(conn, today, tier, avg_z, status, detail)
        print(f"scoring: tier {tier}: z={avg_z:.3f} status={status.upper()} signals={len(detail)}")

    conn.commit()