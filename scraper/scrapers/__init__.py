"""Scraper package.

Each scraper function returns a plain numeric value for today (e.g. 98.5) or
raises ScrapeError to signal a clean skip (the pipeline never fabricates data).

Functions are re-exported here so the pipeline can resolve them by name from
sources_config.py via getattr(scrapers, "function_name").
"""

from ._errors import ScrapeError  # noqa: F401
from .chinapoly import china_meg_spot, china_pta_spot, china_psf_spot
from .commodity import brent_crude, cotton_futures_ice
from .cotton import cotton_spot_mcx, cotton_spot_cai
from .fx import usd_inr
from .wpi_india import wpi_chem_inorganic, wpi_chem_organic, wpi_dye, wpi_textiles_mf
from .yarn_coarse import yarn_spot_coarse_linnseed, yarn_spot_coarse_smartinfo