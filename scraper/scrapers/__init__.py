"""Scraper package.

Each scraper function returns a plain numeric value for today (e.g. 98.5) or
raises ScrapeError to signal a clean skip (the pipeline never fabricates data).

Functions are re-exported here so the pipeline can resolve them by name from
sources_config.py via getattr(scrapers, "function_name").
"""

from ._errors import ScrapeError  # noqa: F401
from .cotton import cotton_spot_mcx, cotton_spot_cai
from .commodity import brent_crude, cotton_futures_ice
from .fx import usd_inr
from .yarn_coarse import yarn_spot_coarse_linnseed, yarn_spot_coarse_smartinfo