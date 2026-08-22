"""Indian cotton signals.

cotton_spot_cai     -> CAI daily spot rate (INR/candy). Sourced from the
                       caionline.in AJAX API which returns JSON with per-grade
                       spot rates. Picks the standard Fine/29mm grade.
                       Falls back gracefully on parse failures.
cotton_futures_mcx  -> MCX polled cotton spot price (INR/bale). Sourced from
                       the mcxdata package which handles WAF bypass via
                       curl_cffi Chrome TLS impersonation.
"""

import re
from datetime import date, timedelta

import requests

from ._errors import ScrapeError

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def _ordinal_day(d: date) -> str:
    day = d.day
    if 11 <= day <= 13:
        return f"{day}th"
    return f"{day}{['th','st','nd','rd','th','th','th','th','th','th'][day % 10]}"


def _cai_business_date() -> date:
    d = date.today()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def cotton_spot_cai() -> float:
    d = _cai_business_date()
    date_str = f"{d.day:02d}-{d.month:02d}-{d.year}"
    url = "https://caionline.in/details/cai/spot-rates/by/date"

    try:
        r = requests.post(
            url,
            data={"date": date_str},
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        raise ScrapeError(f"CAI API request failed: {e}") from e
    except (ValueError, KeyError) as e:
        raise ScrapeError("CAI API returned non-JSON response") from e

    grades = data.get("list") or []
    if not grades:
        raise ScrapeError(
            f"CAI spot rate: no grade data for {date_str} (may be holiday)"
        )

    target_staples = ("29 mm", "28 mm", "30 mm", "27 mm")
    for target in target_staples:
        for g in grades:
            staple = g.get("staple", "")
            candy = g.get("per_candy")
            if staple == target and candy and str(candy).strip() not in ("", "0"):
                return float(str(candy).replace(",", ""))

    for g in grades:
        candy = g.get("per_candy")
        if candy and str(candy).strip() not in ("", "0"):
            return float(str(candy).replace(",", ""))

    raise ScrapeError("CAI spot rate: no valid per_candy value found")


def cotton_spot_mcx() -> float:
    """MCX physical cotton spot price (INR/bale) from the Rajkot market.

    MCX cotton futures (FUTCOM) are effectively dead — zero volume and open
    interest.  The only liquid MCX cotton data is the spot market, which
    mcxdata exposes via ``get_spot_recent``.  The returned row is for a
    single location (Rajkot), unit "1 BALES" (170 kg).
    """
    try:
        from mcxdata import mcx as mcx_api
    except ImportError:
        raise ScrapeError(
            "mcx-data not installed. Run: pip install mcx-data"
        )

    try:
        df = mcx_api.get_spot_recent(commodity="COTTON")
    except Exception as e:
        raise ScrapeError(f"MCX data fetch failed: {e}") from e

    if df is None or df.empty:
        raise ScrapeError("MCX API: COTTON not found in spot data")

    row = df.iloc[0]

    unit = str(row.get("Unit", ""))
    if "BALES" not in unit.upper():
        raise ScrapeError(
            f"MCX API: unexpected unit '{unit}' — expected '1 BALES'"
        )

    location = str(row.get("Location", ""))
    if location.upper() != "RAJKOT":
        raise ScrapeError(
            f"MCX API: unexpected location '{location}' — expected RAJKOT"
        )

    price = row.get("Spot Price (Rs.)")
    if price is None:
        raise ScrapeError("MCX API: no spot price in COTTON row")

    return float(price)
