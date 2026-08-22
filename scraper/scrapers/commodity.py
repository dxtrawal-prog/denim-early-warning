"""Commodity prices from free Yahoo Finance chart endpoints (no API key).

- Brent crude  -> symbol BZ=F (USD/bbl)
- ICE Cotton No.2 (NY) -> symbol CT=F (USc/lb)

The endpoint is undocumented but has been stable and keyless for years. It is
the least-fragile option we have for these two series, so both are marked
'stable' in sources_config.py. If Yahoo ever breaks, flip them to 'fragile'.
"""

import requests

from ._errors import ScrapeError

YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def _yahoo_close(symbol: str) -> float:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {"interval": "1d", "range": "10d"}
    r = requests.get(url, params=params, timeout=30, headers=YAHOO_HEADERS)
    r.raise_for_status()
    try:
        result = r.json()["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError) as e:
        raise ScrapeError(f"unexpected Yahoo response for {symbol}") from e
    for c in reversed(closes):
        if c is not None:
            return float(c)
    raise ScrapeError(f"no closing price for {symbol}")


def brent_crude() -> float:
    return _yahoo_close("BZ=F")


def cotton_futures_ice() -> float:
    return _yahoo_close("CT=F")