"""USD/INR exchange rate from a free, keyless FX API (open.er-api.com)."""

import requests

from ._errors import ScrapeError


def usd_inr() -> float:
    r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=30)
    r.raise_for_status()
    data = r.json()
    rate = data.get("rates", {}).get("INR")
    if rate is None:
        raise ScrapeError("FX API did not return an INR rate")
    return float(rate)