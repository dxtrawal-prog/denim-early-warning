"""
Single place to add / modify a signal source.

Each entry maps to a row in `public.signal_sources`. The daily pipeline
upserts this catalog into the database, then calls the scraper function
named by `scraper` (a function inside the `scrapers` package) for every
non-calculated source that has one.

Rules:
- `scrape_reliability`:
    'stable'  -> dependable public endpoint (e.g. Yahoo Finance, open.er-api)
    'fragile' -> best-effort scrape of a page that may change/break
    'manual'  -> no reliable public feed; entered by the owner on /sources
- `scraper` = None  -> nothing is scraped (manual source)
- `is_calculated` = True -> derived from other readings by the pipeline
                            (never scraped and never manually entered)
- A source marked 'fragile' or 'manual' can still be entered manually on the
  /sources page (fragile = fallback if the scraper fails to parse).
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SourceConfig:
    slug: str
    name: str
    tier: str  # '1' | '2' | '3' | 'overlay'
    unit: str
    scrape_reliability: str  # 'stable' | 'fragile' | 'manual'
    expected_update_frequency_hours: int
    url: Optional[str] = None
    scraper: Optional[str] = None  # function name in the `scrapers` package
    is_calculated: bool = False
    notes: str = ""
    tags: list[str] = field(default_factory=list)


SOURCES: list[SourceConfig] = [
    # ---- Tier 1 — Leading (3-6 week lead), weight 35% ----
    SourceConfig(
        slug="cotton_spot_cai",
        name="Cotton spot rate (CAI)",
        tier="1",
        unit="INR/candy",
        scrape_reliability="fragile",
        expected_update_frequency_hours=24,
        url="https://www.cai.org.in",
        scraper="cotton_spot_cai",
        notes="CAI daily report is PDF/image based; parsing may drift. Manual fallback on /sources.",
    ),
    SourceConfig(
        slug="cotton_spot_mcx",
        name="Cotton spot MCX (Rajkot)",
        tier="1",
        unit="INR/bale",
        scrape_reliability="fragile",
        expected_update_frequency_hours=24,
        url="https://www.mcxindia.com",
        scraper="cotton_spot_mcx",
        notes="MCX physical cotton spot (Rajkot). MCX cotton futures are illiquid (zero volume).",
    ),
    SourceConfig(
        slug="cotton_futures_ice",
        name="Cotton futures ICE No.2 (NY)",
        tier="1",
        unit="USc/lb",
        scrape_reliability="stable",
        expected_update_frequency_hours=24,
        url="https://query1.finance.yahoo.com/v8/finance/chart/CT=F",
        scraper="cotton_futures_ice",
        notes="Free Yahoo Finance chart endpoint.",
    ),
    SourceConfig(
        slug="brent_crude",
        name="Brent crude oil",
        tier="1",
        unit="USD/bbl",
        scrape_reliability="stable",
        expected_update_frequency_hours=24,
        url="https://query1.finance.yahoo.com/v8/finance/chart/BZ=F",
        scraper="brent_crude",
        notes="Free Yahoo Finance chart endpoint.",
    ),

    # ---- Tier 2 — Coincident (1-2 week lead), weight 45% ----
    SourceConfig(
        slug="yarn_spot_coarse",
        name="Coarse yarn spot (Ne 6s-16s)",
        tier="2",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=24,
        notes="No reliable public feed (YarnLIVE is subscription). Manual entry on /sources.",
    ),
    SourceConfig(
        slug="pta_price",
        name="PTA spot (RIL circular)",
        tier="2",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="RIL circular prices are trade-reported only; no stable public page. Manual entry.",
    ),
    SourceConfig(
        slug="meg_price",
        name="MEG spot (RIL circular)",
        tier="2",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),
    SourceConfig(
        slug="psf_price",
        name="PSF spot (RIL circular)",
        tier="2",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),
    SourceConfig(
        slug="yarn_cotton_spread",
        name="Yarn-to-cotton spread",
        tier="2",
        unit="INR/kg",
        scrape_reliability="stable",
        expected_update_frequency_hours=24,
        is_calculated=True,
        notes="Calculated: yarn spot - cotton spot (converted to INR/kg). Computed by the pipeline, not manually entered.",
    ),

    # ---- Tier 3 — Lagging (0-1 week lead), weight 20% ----
    SourceConfig(
        slug="indigo_dye",
        name="Indigo dye spot",
        tier="3",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),
    SourceConfig(
        slug="caustic_soda",
        name="Caustic soda spot",
        tier="3",
        unit="INR/kg",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),
    SourceConfig(
        slug="weaving_discount_surat",
        name="Weaving cash discount (Surat/Ahmedabad)",
        tier="3",
        unit="%",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),
    SourceConfig(
        slug="mill_utilization",
        name="Mill operating rate",
        tier="3",
        unit="%",
        scrape_reliability="manual",
        expected_update_frequency_hours=168,
        notes="Manual entry.",
    ),

    # ---- Overlay (not part of the 3 tiers) ----
    SourceConfig(
        slug="usd_inr",
        name="USD/INR exchange rate",
        tier="overlay",
        unit="INR per USD",
        scrape_reliability="stable",
        expected_update_frequency_hours=24,
        url="https://open.er-api.com/v6/latest/USD",
        scraper="usd_inr",
        notes="Free FX API.",
    ),
]

# Overlay policy notices (import duty / GST) are stored in `policy_notices`
# via the /sources manual-entry form; they have no source row and are never
# scraped in Phase 1.