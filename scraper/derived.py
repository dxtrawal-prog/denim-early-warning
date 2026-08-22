"""Calculated (derived) signals, produced by the pipeline from raw readings.

yarn_cotton_spread = coarse yarn spot (INR/kg) - cotton spot (INR/kg)
Cotton spot is quoted INR/candy; 1 candy = 355.62 kg.
"""

import pandas as pd

import db

CANDY_KG = 355.62

# Priority: test_injection > synthetic_seed > manual > live
_QUALITY_RANK = {"test_injection": 3, "synthetic_seed": 2, "manual": 1, "live": 0}


def _derive_quality(a: str, b: str) -> str:
    """Return the 'worst' data_quality of two inputs."""
    rank_a = _QUALITY_RANK.get(a, 0)
    rank_b = _QUALITY_RANK.get(b, 0)
    best = max(rank_a, rank_b)
    for label, r in _QUALITY_RANK.items():
        if r == best:
            return label
    return "live"


def compute_yarn_cotton_spread(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, slug from public.signal_sources
            where slug in ('yarn_spot_coarse', 'cotton_spot_cai', 'yarn_cotton_spread')
            """
        )
        ids = {slug: sid for sid, slug in cur.fetchall()}
    if any(k not in ids for k in ("yarn_spot_coarse", "cotton_spot_cai", "yarn_cotton_spread")):
        print("derived: required sources missing, skipping spread")
        return

    yarn = db.read_sql(
        conn,
        "select date, value, data_quality from public.signal_readings where source_id = %s and data_quality in ('live', 'manual') order by date",
        params=(ids["yarn_spot_coarse"],),
    )
    cotton = db.read_sql(
        conn,
        "select date, value, data_quality from public.signal_readings where source_id = %s and data_quality in ('live', 'manual') order by date",
        params=(ids["cotton_spot_cai"],),
    )
    if yarn.empty or cotton.empty:
        print("derived: yarn or cotton has no readings, skipping spread")
        return

    cotton["date"] = pd.to_datetime(cotton["date"])
    yarn["value"] = yarn["value"].astype(float)
    cotton["value"] = cotton["value"].astype(float) / CANDY_KG

    spread_source = ids["yarn_cotton_spread"]
    with conn.cursor() as cur:
        for _, yr in yarn.iterrows():
            d = pd.to_datetime(yr["date"])
            prev = cotton[cotton["date"] <= d]
            if prev.empty:
                continue
            cotton_kg = float(prev.iloc[-1]["value"])
            spread = float(yr["value"]) - cotton_kg
            cur.execute(
                """
                insert into public.signal_readings (source_id, date, value, ingested_at, data_quality)
                values (%s, %s, %s, now(), %s)
                on conflict (source_id, date) do update set
                  value = excluded.value,
                  ingested_at = now(),
                  data_quality = excluded.data_quality
                """,
                (spread_source, d.date().isoformat(), round(spread, 3),
                 _derive_quality(yr.get("data_quality", "live"), prev.iloc[-1].get("data_quality", "live"))),
            )
    print("derived: yarn_cotton_spread updated")