"""Shared scraper exception."""


class ScrapeError(Exception):
    """Raised when a source cannot be scraped; the pipeline skips it cleanly."""