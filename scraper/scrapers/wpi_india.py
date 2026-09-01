"""India WPI sub-indices from the data.gov.in Open Government Data (OGD) API.

These give real, free, monthly *India* macro pressure for chemical / dye /
textile inputs (organic chemicals, caustic soda/inorganic, dyes, man-made
fibres). They back only Tier 3 (lagging) and run at ``frequency='monthly'``.

Access
------
The OGD API requires a free API key (sign up at data.gov.in -> My Account ->
Generate API Key). Set it in the environment and this scraper reads it::

    DATA_GOV_IN_API_KEY=xxxxx
    DATA_GOV_IN_WPI_RESOURCE_ID=<resource id of the monthly WPI dataset>

`resource_id` defaults to a documented WPI resource if unset; set it to the
currently-published monthly WPI dataset's resource id for clean results.

Each function returns ``(reference_date, value)`` — the value at its published
reference month-end — so readings are dated at the month, not stamped each
daily cron run (repeated daily stamps of the same index would corrupt the
monthly z-score). The pipeline's run.py handles tuple returns.

Any failure raises ScrapeError: the pipeline skips cleanly, never fabricates.
"""

import os
from datetime import date, timedelta

import requests

from ._errors import ScrapeError

OGD_BASE = "https://api.data.gov.in/resource/{resource_id}"

# Default: "Wholesale Price Index (Base Year 2011-12) Upto May 2017".
# Replace via DATA_GOV_IN_WPI_RESOURCE_ID with the current monthly dataset.
_DEFAULT_RESOURCE = "abfd2d50-0d73-4a3e-9027-10edb3d21940"

# Which OGD API field holds the commodity label varies by dataset version.
_NAME_FIELDS = ("item_name", "item", "commodity_name", "commodity", "description", "group_name")

# Which field holds the numeric index.
_VALUE_FIELDS = ("index_value", "index", "wpi_index", "price_index", "value")

# Which field holds a date (YYYY-MM or YYYY-MM-DD).
_DATE_FIELDS = ("year_month", "month_year", "date", "period", "month", "year")

# The exact sub-index labels we map onto our four WPI signals.
_LABELS = {
    "wpi_chem_organic": (
        "basic organic chemicals",
        "organic chemicals",
    ),
    "wpi_chem_inorganic": (
        "basic inorganic chemicals",
        "inorganic chemicals",
        "caustic soda",
    ),
    "wpi_dye": (
        "dye stuff",
        "dye",
        "indigo",
    ),
    "wpi_textiles_mf": (
        "man made fibre",
        "man-made fibre",
        "synthetic fibre",
        "polyester",
    ),
}


def _api_key() -> str:
    key = os.environ.get("DATA_GOV_IN_API_KEY", "").strip()
    if not key:
        raise ScrapeError(
            "WPI scraper: DATA_GOV_IN_API_KEY not set. Get a free key at data.gov.in, "
            "then set the env var (e.g. GitHub Actions secret)."
        )
    return key


def _resource_id() -> str:
    return os.environ.get("DATA_GOV_IN_WPI_RESOURCE_ID", _DEFAULT_RESOURCE).strip()


def _latest_reading(slug: str) -> tuple[str, float]:
    """Fetch the latest record for `slug` and return (reference_date, value)."""
    key = _api_key()
    rid = _resource_id()
    url = OGD_BASE.format(resource_id=rid)
    params = {
        "api-key": key,
        "format": "json",
        "limit": 100,
        "offset": 0,
    }

    try:
        r = requests.get(url, params=params, timeout=60)
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        raise ScrapeError(f"data.gov.in request failed for {slug}: {e}") from e
    except ValueError as e:
        raise ScrapeError(f"data.gov.in returned non-JSON for {slug}: {e}") from e

    records = data.get("records") or data.get("data") or data.get("result") or []
    if not records:
        raise ScrapeError(f"data.gov.in: no records returned for {slug}")

    needles = _LABELS[slug]
    best: tuple[str, float] | None = None
    for rec in records:
        if not isinstance(rec, dict):
            continue
        label = _find_field(rec, _NAME_FIELDS)
        if label is None or not any(n.lower() in str(label).lower() for n in needles):
            continue
        value = _find_float(rec)
        d = _find_date(rec)
        if value is None or d is None:
            continue
        if best is None or d > best[0]:
            best = (d, value)
    if best is None:
        raise ScrapeError(
            f"data.gov.in: no matching record for {slug} (looked for {needles}). "
            "Check DATA_GOV_IN_WPI_RESOURCE_ID points at the monthly WPI dataset."
        )
    return best


def _find_field(rec: dict, candidates: tuple[str, ...]):
    for k, v in rec.items():
        lk = str(k).lower()
        for c in candidates:
            if c in lk:
                return v
    return None


def _find_float(rec: dict) -> float | None:
    for k, v in rec.items():
        if str(k).lower() in _VALUE_FIELDS:
            try:
                f = float(str(v).replace(",", "").strip())
            except (TypeError, ValueError):
                continue
            if f > 0:
                return f
    return None


def _find_date(rec: dict) -> str | None:
    for k, v in rec.items():
        lk = str(k).lower()
        for c in _DATE_FIELDS:
            if c not in lk:
                continue
            s = str(v).strip()
            if len(s) == 7 and s[4] == "-":  # YYYY-MM
                # Month-end reference date.
                y, m = int(s[:4]), int(s[5:7])
                if m == 12:
                    d = date(y, 12, 31)
                else:
                    d = date(y, m + 1, 1) - timedelta(days=1)
                return d.isoformat()
            if len(s) >= 10 and s[4] == "-":
                return s[:10]
    return None


def wpi_chem_organic() -> tuple[str, float]:
    return _latest_reading("wpi_chem_organic")


def wpi_chem_inorganic() -> tuple[str, float]:
    return _latest_reading("wpi_chem_inorganic")


def wpi_dye() -> tuple[str, float]:
    return _latest_reading("wpi_dye")


def wpi_textiles_mf() -> tuple[str, float]:
    return _latest_reading("wpi_textiles_mf")