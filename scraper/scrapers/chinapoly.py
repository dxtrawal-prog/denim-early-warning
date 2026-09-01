"""China polymer spot prices from SunSirs (directional polyester cost proxies).

These are China, not India, prices. They are used as *directional* proxies for
polyester cost pressure (RIL/Indian prices are trade-reported only and have no
stable public feed). The z-score model operates on % change, so absolute level
difference between China and India (China tends ~20-30% cheaper) does not matter.

SunSirs serves a tiny JS anti-bot challenge before the real page: the first
response sets an ``HW_CHECK`` cookie and schedules a reload. We replicate what
a browser does — fetch once, extract the cookie value from the obfuscated JS,
set it, and re-request. This is fragile (the site may change), hence
`scrape_reliability='fragile'` in sources_config.py and clean ScrapeError on
any failure.

Product pages (all spot, unit RMB/ton, latest rows first):
    PTA   -> uk/prodetail-356.html
    MEG   -> uk/prodetail-222.html
    PSF   -> uk/prodetail-976.html
"""

import re

import requests

from ._errors import ScrapeError

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Product id -> slug (for readable errors / sanity checks).
_PRODUCTS = {
    "356": "china_pta_spot",
    "222": "china_meg_spot",
    "976": "china_psf_spot",
}


def _fetch_sunsirs_page(product_id: str) -> str:
    """Fetch a SunSirs product page, defeating the HW_CHECK cookie challenge."""
    url = f"https://www.sunsirs.com/uk/prodetail-{product_id}.html"
    try:
        s = requests.Session()
        s.headers.update(HEADERS)
        r = s.get(url, timeout=30)
        r.raise_for_status()

        # First response is the challenge page unless we already hold the cookie.
        m = re.search(r'var _0x2 = "([a-f0-9]{32})"', r.text)
        if m:
            s.cookies.set("HW_CHECK", m.group(1), domain="sunsirs.com", path="/")
            r = s.get(url, timeout=30)
            r.raise_for_status()
            challenge = re.search(r'var _0x2 = "([a-f0-9]{32})"', r.text)
            if challenge:
                raise ScrapeError(f"SunSirs {product_id}: still on challenge page after cookie set")

        return r.text
    except ScrapeError:
        raise
    except requests.RequestException as e:
        raise ScrapeError(f"SunSirs request failed for {product_id}: {e}") from e


def _latest_spot(html: str, product_id: str) -> float:
    """Parse the Price/Date table and return the latest (top) spot price."""
    # Data rows look like: <td>PTA</td><td>Textile</td><td>6389.75</td><td>2026-09-01</td>
    pattern = re.compile(
        r"<td>\s*([^<]+?)\s*</td>"  # Commodity
        r"\s*<td>\s*([^<]+?)\s*</td>"  # Sector
        r"\s*<td>\s*([\d.,]+?)\s*</td>"  # Price
        r"\s*<td>\s*(\d{4}-\d{2}-\d{2})\s*</td>",  # Date
        re.IGNORECASE,
    )
    for m in pattern.finditer(html):
        price_raw = m.group(3).replace(",", "")
        try:
            price = float(price_raw)
        except ValueError:
            continue
        if price > 0:
            return price
    raise ScrapeError(f"SunSirs {product_id}: no valid spot price row found")


def _spot(product_id: str) -> float:
    html = _fetch_sunsirs_page(product_id)
    return _latest_spot(html, product_id)


def china_pta_spot() -> float:
    return _spot("356")


def china_meg_spot() -> float:
    return _spot("222")


def china_psf_spot() -> float:
    return _spot("976")
