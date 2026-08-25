"""Coarse yarn spot price scrapers (Ne 6s–16s, Open End).

Primary source: Linnseed.com JSON API (admin.linnseed.com:8891).
Secondary source: SmartInfoIndia.com PDF rate lists.

Both return INR/kg for coarse OE yarn counts used in denim warp.
"""

import re

import requests

from ._errors import ScrapeError

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

LINNSEED_API = "https://admin.linnseed.com:8891/api/mobile/spot_price"

# Regex to identify coarse Open End yarn counts in Linnseed's naming.
# Matches: "10s OE", "16/1 Open End Yarn", "Ne 16/1 Open End Yarn",
#          "24/1 Open End Yarn", "10s OE ", etc.
_COARSE_PATTERN = re.compile(
    r"(?:Ne\s*)?"                # optional Ne prefix
    r"(\d{1,2})"                 # count number (1-2 digits)
    r"(?:s(?:\s*/\s*1)?|/\s*1)" # either "s" (optionally + /1) or just "/1"
    r".*?"                       # greedy match to...
    r"(?:OE|O/?E|Open\s*End)",   # ...OE / Open End
    re.IGNORECASE | re.DOTALL,
)

# Coarse count range we care about.
_MIN_COUNT = 6
_MAX_COUNT = 16


def _parse_price(raw: str) -> float | None:
    """Extract numeric price from strings like '219', '205/-', '154 / 163'."""
    if not raw or not raw.strip():
        return None
    s = raw.strip().rstrip("/-").strip()
    # Handle range like "154 / 163" → take midpoint
    parts = re.split(r"\s*/\s*", s)
    nums = []
    for p in parts:
        p = p.strip()
        if p and p.replace(".", "").isdigit():
            nums.append(float(p))
    if not nums:
        return None
    if len(nums) == 2:
        return (nums[0] + nums[1]) / 2.0
    return nums[0]


def _is_valid_coarse_price(price: float) -> bool:
    """Sanity-check a coarse yarn price (INR/kg)."""
    return 50.0 <= price <= 600.0


def yarn_spot_coarse_linnseed() -> float:
    """Scrape Linnseed spot price API for coarse OE yarn (Ne 6s–16s).

    Returns the average INR/kg across available coarse OE counts and zones.
    Raises ScrapeError if no valid coarse data is found.
    """
    try:
        r = requests.get(LINNSEED_API, headers=HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        raise ScrapeError(f"Linnseed API request failed: {e}") from e
    except (ValueError, KeyError) as e:
        raise ScrapeError("Linnseed API returned non-JSON response") from e

    spot_items = data.get("spotPrice", [])
    if not spot_items:
        raise ScrapeError("Linnseed API: spotPrice array is empty")

    zone_keys = ["gujarat", "madhyaPradesh", "northZone", "southZone"]
    prices: list[float] = []

    for item in spot_items:
        count_str = item.get("count", "")
        m = _COARSE_PATTERN.search(count_str)
        if not m:
            continue
        count_num = int(m.group(1))
        if not (_MIN_COUNT <= count_num <= _MAX_COUNT):
            continue
        for zk in zone_keys:
            raw_val = item.get(zk, "")
            price = _parse_price(str(raw_val))
            if price is not None and _is_valid_coarse_price(price):
                prices.append(price)

    if not prices:
        raise ScrapeError(
            "Linnseed API: no coarse OE yarn (6s–16s) with valid prices found"
        )

    return round(sum(prices) / len(prices), 2)


def yarn_spot_coarse_smartinfo(pdf_url: str) -> float:
    """Parse a SmartInfoIndia PDF rate list for coarse yarn (Ne 6s–16s).

    The PDF layout is: ``COUNT  WEIGHT  RATE`` per line, e.g.::

        6s 42 189
        10s 42 201
        16s 42 201

    Only counts in the 6s–16s range are used.

    Parameters
    ----------
    pdf_url : str
        Full URL to the PDF (e.g. from smartinfoindia.com/storage/circulars/...).

    Returns
    -------
    float
        Average INR/kg for coarse counts found in the PDF.

    Raises
    ------
    ScrapeError
        If download fails, PDF can't be read, or no coarse data is found.
    """
    try:
        import pdfplumber
    except ImportError:
        raise ScrapeError(
            "pdfplumber not installed. Run: pip install pdfplumber"
        )

    try:
        r = requests.get(pdf_url, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        raise ScrapeError(f"SmartInfoIndia PDF download failed: {e}") from e

    try:
        import io
        pdf = pdfplumber.open(io.BytesIO(r.content))
    except Exception as e:
        raise ScrapeError(f"Failed to open PDF: {e}") from e

    # Pattern: count (e.g. "6s", "10s", "16s"), weight, rate
    line_re = re.compile(
        r"^\s*(\d{1,2})s\s+\d+\.?\d*\s+(\d+(?:\.\d+)?)",
        re.MULTILINE,
    )

    prices: list[float] = []
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
        for m in line_re.finditer(text):
            count_num = int(m.group(1))
            if _MIN_COUNT <= count_num <= _MAX_COUNT:
                price = float(m.group(2))
                if _is_valid_coarse_price(price):
                    prices.append(price)

    pdf.close()

    if not prices:
        raise ScrapeError(
            "SmartInfoIndia PDF: no coarse yarn (6s–16s) data found"
        )

    return round(sum(prices) / len(prices), 2)
