"""
Rule-based scoring (Phase 1 — no ML / no regression weight tuning).

For every Tier 1/2/3 signal:
  1. compute a rolling mean/std of daily % change over that signal's own window
     (daily 90d / min 30 obs, weekly 52 / min 12, monthly 24 / min 6),
  2. today's z-score = (today's % change - rolling mean) / rolling std,
  3. aggregate signal z-scores within a tier (simple average of normalized z),
  4. map the tier average to green/amber/red:
         green  |z| < 1.5
         amber  1.5 <= |z| < 2.5
         red    |z| >= 2.5
  5. write the tier score; when a tier crosses into amber/red, write a
     `triggers` row containing the exact signals/values that caused it.

Weights (35/45/20) are used ONLY by the dashboard's combined "market pressure"
score, never to weight the per-tier statuses.

Signals are grouped by frequency; each uses `rolling_window` / `rolling_min_periods`
from the source catalog (falls back to per-frequency defaults). This lets daily
China-proxy and monthly India-WPI signals coexist in one screen without the
monthly series being starved of a baseline.

Note: pandas std uses ddof=0 (population) here to match the TypeScript rolling
z-score used by the /trends charts.
"""

import json
from datetime import date

import numpy as np
import pandas as pd

import db
import notify

Z_AMBER = 1.5
Z_RED = 2.5

# Per-frequency rolling defaults (days or months) and min observations.
FREQUENCY_DEFAULTS = {
    "daily": {"window": 90, "min_periods": 30},
    "weekly": {"window": 52, "min_periods": 12},
    "monthly": {"window": 24, "min_periods": 6},
}

TIER_WEIGHTS = {"1": 0.35, "2": 0.45, "3": 0.20}


def status_for_z(z: float) -> str:
    az = abs(z)
    if az >= Z_RED:
        return "red"
    if az >= Z_AMBER:
        return "amber"
    return "green"


def window_for_source(row) -> tuple[int, int]:
    """Return (window, min_periods) for a signal, honoring per-source overrides."""
    freq = row.get("frequency", "daily")
    defaults = FREQUENCY_DEFAULTS.get(freq, FREQUENCY_DEFAULTS["daily"])
    window = row.get("rolling_window") or defaults["window"]
    min_periods = row.get("rolling_min_periods") or defaults["min_periods"]
    return int(window), int(min_periods)


def load_readings(conn) -> pd.DataFrame:
    df = db.read_sql(
        conn,
        """
        select r.source_id, s.slug, s.name, s.tier, s.unit,
               s.frequency, s.rolling_window, s.rolling_min_periods,
               r.date, r.value, r.data_quality
        from public.signal_readings r
        join public.signal_sources s on s.id = r.source_id
        where s.tier in ('1', '2', '3')
          and r.data_quality in ('live', 'manual', 'synthetic_seed')
        order by r.source_id, r.date
        """,
    )
    df["value"] = df["value"].astype(float)
    if df.empty:
        return df
    df["frequency"] = df["frequency"].fillna("daily")
    return df


def compute_signal_zs(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["source_id", "date"]).reset_index(drop=True)

    def _day_change(group):
        if group.name == "yarn_cotton_spread":
            return group["value"].diff()
        return group["value"].pct_change() * 100.0

    df["pct"] = df.groupby("source_id").apply(_day_change, include_groups=False).reset_index(level=0, drop=True)

    window_info = df.groupby("source_id").apply(
        lambda g: window_for_source(g.iloc[0]), include_groups=False
    )

    def _rolling_stats(group):
        sid = group.name
        window, min_periods = window_info[sid]
        mean = group["pct"].rolling(window, min_periods=min_periods).mean()
        std = group["pct"].rolling(window, min_periods=min_periods).std(ddof=0)
        return pd.DataFrame({"mean": mean, "std": std})

    stats = df.groupby("source_id", group_keys=False).apply(_rolling_stats)
    df["mean"] = stats["mean"].reset_index(drop=True)
    df["std"] = stats["std"].reset_index(drop=True)
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
            "data_quality": str(r["data_quality"]),
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


def detect_trigger(conn, today, tier, avg_z, status, detail, armed=True):
    """Log a trigger when a tier crosses into amber/red (not on repeats).

    `armed=False` means the tier's latest readings are still synthetic warm-start
    placeholders — we compute & store the score but never fire a real alert (or
    push notification) off fabricated history alone.
    """
    if status == "green":
        return
    if not armed:
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
        notify.send_alert(tier, level, avg_z, detail)


def run_scoring(conn, today=None):
    today = today or date.today().isoformat()
    df = load_readings(conn)
    if df.empty:
        print("scoring: no readings yet, skipping")
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
            need = {
                s: window_for_source(row)
                for s, row in tier_df.drop_duplicates("source_id").iterrows()
            }
            print(
                f"scoring: tier {tier}: no z-scores yet "
                f"({total_readings} total readings across {sources_in_tier} sources. "
                f"Needs per-signal: { {k: need[k] for k in need} })"
            )
            continue

        latest = tier_with_z.sort_values("date").groupby("source_id").tail(1)
        avg_z = float(np.mean([latest["z"]]))
        status = status_for_z(avg_z)
        detail = build_detail([latest.loc[i] for i in latest.index])
        # A tier is "armed" for real alerts only when its latest contributing
        # reading is real (live/manual), not a synthetic warm-start placeholder.
        armed = (latest["data_quality"].isin(["live", "manual"])).any()
        upsert_tier_score(conn, today, tier, avg_z, status, detail)
        detect_trigger(conn, today, tier, avg_z, status, detail, armed=armed)
        arm_note = "" if armed else " [warm-start: alerts disarmed, latest still synthetic]"
        print(f"scoring: tier {tier}: z={avg_z:.3f} status={status.upper()} signals={len(detail)}{arm_note}")

    conn.commit()