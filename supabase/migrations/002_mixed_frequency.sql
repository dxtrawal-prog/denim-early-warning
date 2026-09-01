-- ============================================================================
-- Denim Fabric Price Early-Warning System — Phase 2: mixed-frequency signals
-- ============================================================================
-- Adds per-source frequency / region so the z-score engine can handle both
-- daily signals (90-day window, min 30 obs) and monthly signals (24-month
-- window, min 6 obs), plus China proxy and India WPI sources.
-- Apply after 001_initial_schema.sql.

alter table public.signal_sources
  add column if not exists frequency text not null default 'daily'
    check (frequency in ('daily', 'weekly', 'monthly'));
alter table public.signal_sources
  add column if not exists region text not null default 'india'
    check (region in ('india', 'china', 'global'));
alter table public.signal_sources
  add column if not exists rolling_window int;
alter table public.signal_sources
  add column if not exists rolling_min_periods int;

-- Recomputed at read time; staleness already uses expected_update_frequency_hours.
-- (Drop first: the old view has different column order, and CREATE OR REPLACE
-- metadata.">cannot change an existing view's column names.)
drop view if exists public.v_latest_readings;
drop view if exists public.signal_readings_v;

create view public.signal_readings_v as
select
  r.id,
  r.source_id,
  s.slug,
  s.name,
  s.tier,
  s.unit,
  s.scrape_reliability,
  s.expected_update_frequency_hours,
  s.frequency,
  s.region,
  s.rolling_window,
  s.rolling_min_periods,
  r.date,
  r.value,
  r.ingested_at,
  r.data_quality,
  (r.ingested_at < now() - (s.expected_update_frequency_hours * 2) * interval '1 hour') as is_stale
from public.signal_readings r
join public.signal_sources s on s.id = r.source_id;

create view public.v_latest_readings as
select distinct on (r.source_id)
  r.id,
  r.source_id,
  s.slug,
  s.name,
  s.tier,
  s.unit,
  s.scrape_reliability,
  s.expected_update_frequency_hours,
  s.frequency,
  s.region,
  s.rolling_window,
  s.rolling_min_periods,
  s.is_calculated,
  s.last_scrape_at,
  r.date,
  r.value,
  r.ingested_at,
  r.data_quality,
  (r.ingested_at < now() - (s.expected_update_frequency_hours * 2) * interval '1 hour') as is_stale
from public.signal_readings r
join public.signal_sources s on s.id = r.source_id
order by r.source_id, r.date desc;

-- ---------------------------------------------------------------------------
-- Seed the new sources (idempotent). The Python scraper's sources_config.py
-- is authoritative and re-upserts the whole catalog on every run, so these
-- rows mainly let the dashboard render before the first daily run.
-- ---------------------------------------------------------------------------
insert into public.signal_sources
  (slug, name, tier, unit, scrape_reliability, expected_update_frequency_hours,
   url, is_calculated, notes, frequency, region)
values
  ('china_pta_spot', 'PTA spot (China)', '2', 'CNY/mt', 'fragile', 24,
   'https://www.sunsirs.com/uk/prodetail-356.html', false,
   'China proxy for directional polyester cost pressure (not RIL). Daily spot from SunSirs. Fragile scrape with manual fallback.', 'daily', 'china'),
  ('china_meg_spot', 'MEG spot (China)', '2', 'CNY/mt', 'fragile', 24,
   'https://www.sunsirs.com/uk/prodetail-222.html', false,
   'China proxy for directional polyester cost pressure (not RIL). Daily spot from SunSirs. Fragile scrape with manual fallback.', 'daily', 'china'),
  ('china_psf_spot', 'PSF spot (China)', '2', 'CNY/mt', 'fragile', 24,
   'https://www.sunsirs.com/uk/prodetail-976.html', false,
   'China proxy for directional polyester cost pressure (not RIL). Daily spot from SunSirs. Fragile scrape with manual fallback.', 'daily', 'china'),
  ('wpi_chem_organic', 'WPI: Basic organic chemicals', '3', 'index (2011-12=100)', 'fragile', 720,
   'https://www.data.gov.in', false,
   'India WPI sub-index, monthly, from the data.gov.in OGD API (free key required in DATA_GOV_IN_API_KEY). Real history 4+ years.', 'monthly', 'india'),
  ('wpi_chem_inorganic', 'WPI: Basic inorganic chemicals', '3', 'index (2011-12=100)', 'fragile', 720,
   'https://www.data.gov.in', false,
   'India WPI sub-index (incl. caustic soda), monthly, from the data.gov.in OGD API. Real history 4+ years.', 'monthly', 'india'),
  ('wpi_dye', 'WPI: Dyes & dye stuff', '3', 'index (2011-12=100)', 'fragile', 720,
   'https://www.data.gov.in', false,
   'India WPI sub-index for dyes, monthly, from the data.gov.in OGD API. Real history 4+ years.', 'monthly', 'india'),
  ('wpi_textiles_mf', 'WPI: Man-made fibres & textiles', '3', 'index (2011-12=100)', 'fragile', 720,
   'https://www.data.gov.in', false,
   'India WPI sub-index for man-made fibres/polyester fabric, monthly, from the data.gov.in OGD API. Real history 4+ years.', 'monthly', 'india')
on conflict (slug) do nothing;
