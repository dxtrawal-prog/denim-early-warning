-- ============================================================================
-- Denim Fabric Price Early-Warning System — Phase 1 schema
-- Apply in the Supabase SQL editor, or with: supabase db push
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Catalog of every signal the dashboard tracks.
-- `tier` is 1 (leading), 2 (coincident), 3 (lagging) or 'overlay'.
-- `scrape_reliability` is 'stable' | 'fragile' | 'manual'.
-- `is_calculated` marks signals that the pipeline derives from other readings
-- (e.g. yarn-to-cotton spread); these are never manually entered.
-- ---------------------------------------------------------------------------
create table if not exists public.signal_sources (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  tier text not null check (tier in ('1', '2', '3', 'overlay')),
  unit text not null,
  scrape_reliability text not null check (scrape_reliability in ('stable', 'fragile', 'manual')),
  expected_update_frequency_hours integer not null default 24,
  url text,
  is_calculated boolean not null default false,
  notes text,
  last_scrape_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Raw readings. is_stale is kept as a column for schema stability but the
-- dashboard reads staleness from the view below (recomputed at read time).
-- ---------------------------------------------------------------------------
create table if not exists public.signal_readings (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.signal_sources (id) on delete cascade,
  date date not null,
  value numeric not null,
  ingested_at timestamptz not null default now(),
  is_stale boolean not null default false,
  data_quality text not null default 'live' check (data_quality in ('live', 'manual', 'synthetic_seed', 'test_injection')),
  unique (source_id, date)
);

create index if not exists idx_signal_readings_source_date
  on public.signal_readings (source_id, date desc);
create index if not exists idx_signal_readings_date
  on public.signal_readings (date);

-- ---------------------------------------------------------------------------
-- Daily rule-based scores per tier (1/2/3). detail holds the per-signal
-- z-scores and values that produced the tier score.
-- ---------------------------------------------------------------------------
create table if not exists public.tier_scores (
  id bigint generated always as identity primary key,
  date date not null,
  tier smallint not null check (tier in (1, 2, 3)),
  z_score numeric not null,
  status text not null check (status in ('green', 'amber', 'red')),
  signal_count integer not null default 0,
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (date, tier)
);

create index if not exists idx_tier_scores_date
  on public.tier_scores (date desc);

-- ---------------------------------------------------------------------------
-- Log of every amber/red crossing, including the exact signals and values
-- that caused it (used later for accuracy review / backtesting).
-- ---------------------------------------------------------------------------
create table if not exists public.triggers (
  id bigint generated always as identity primary key,
  date date not null,
  tier text not null check (tier in ('1', '2', '3')),
  level text not null check (level in ('amber', 'red')),
  triggering_signals jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_triggers_date
  on public.triggers (date desc);

-- ---------------------------------------------------------------------------
-- Manual log of what the owner actually observed in the fabric market.
-- Used later for backtesting the rule-based scores.
-- ---------------------------------------------------------------------------
create table if not exists public.outcomes (
  id bigint generated always as identity primary key,
  trigger_id bigint references public.triggers (id) on delete set null,
  date date not null,
  actual_fabric_price_change_pct numeric not null,
  entered_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_outcomes_date
  on public.outcomes (date desc);

-- ---------------------------------------------------------------------------
-- Overlay "policy shock" flags (import duty / GST changes). Manual entry only.
-- ---------------------------------------------------------------------------
create table if not exists public.policy_notices (
  id bigint generated always as identity primary key,
  date date not null,
  title text not null,
  description text,
  entered_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_policy_notices_date
  on public.policy_notices (date desc);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Every reading joined to its source, with staleness computed at read time:
-- a reading is stale when it was ingested more than
-- (expected_update_frequency_hours * 2) ago.
create or replace view public.signal_readings_v as
select
  r.id,
  r.source_id,
  s.slug,
  s.name,
  s.tier,
  s.unit,
  s.scrape_reliability,
  s.expected_update_frequency_hours,
  r.date,
  r.value,
  r.ingested_at,
  r.data_quality,
  (r.ingested_at < now() - (s.expected_update_frequency_hours * 2) * interval '1 hour') as is_stale
from public.signal_readings r
join public.signal_sources s on s.id = r.source_id;

-- Latest reading per source (used by the dashboard).
create or replace view public.v_latest_readings as
select distinct on (r.source_id)
  r.id,
  r.source_id,
  s.slug,
  s.name,
  s.tier,
  s.unit,
  s.scrape_reliability,
  s.expected_update_frequency_hours,
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
-- Seed the signal source catalog (idempotent).
-- The Python scraper also upserts the same catalog from sources_config.py,
-- so this seed mainly lets the dashboard render before the first daily run.
-- ---------------------------------------------------------------------------
insert into public.signal_sources
  (slug, name, tier, unit, scrape_reliability, expected_update_frequency_hours, url, is_calculated, notes)
values
  ('cotton_spot_cai', 'Cotton spot rate (CAI)', '1', 'INR/candy', 'fragile', 24,
   'https://www.cai.org.in', false,
   'CAI daily report is PDF/image based; parsing may drift. Manual fallback available on /sources.'),
  ('cotton_spot_mcx', 'Cotton spot MCX (Rajkot)', '1', 'INR/bale', 'fragile', 24,
   'https://www.mcxindia.com', false,
   'MCX physical cotton spot (Rajkot). MCX cotton futures are illiquid (zero volume).'),
  ('cotton_futures_ice', 'Cotton futures ICE No.2 (NY)', '1', 'USc/lb', 'stable', 24,
   'https://query1.finance.yahoo.com/v8/finance/chart/CT=F', false,
   'Free Yahoo Finance chart endpoint.'),
  ('brent_crude', 'Brent crude oil', '1', 'USD/bbl', 'stable', 24,
   'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F', false,
   'Free Yahoo Finance chart endpoint.'),
  ('yarn_spot_coarse', 'Coarse yarn spot (Ne 6s-16s)', '2', 'INR/kg', 'fragile', 24,
   'https://admin.linnseed.com:8891/api/mobile/spot_price', false,
   'Linnseed JSON API (OE 10s/16s); fallback SmartInfoIndia PDFs. Manual entry on /sources as fallback.'),
  ('pta_price', 'PTA spot (RIL circular)', '2', 'INR/kg', 'manual', 168,
   null, false,
   'RIL circular prices are trade-reported only; no stable public page. Manual entry.'),
  ('meg_price', 'MEG spot (RIL circular)', '2', 'INR/kg', 'manual', 168,
   null, false, 'Manual entry.'),
  ('psf_price', 'PSF spot (RIL circular)', '2', 'INR/kg', 'manual', 168,
   null, false, 'Manual entry.'),
  ('yarn_cotton_spread', 'Yarn-to-cotton spread', '2', 'INR/kg', 'stable', 24,
   null, true,
   'Calculated: yarn spot - cotton spot (converted to INR/kg). Computed by the pipeline, not manually entered.'),
  ('indigo_dye', 'Indigo dye spot', '3', 'INR/kg', 'manual', 168,
   null, false, 'Manual entry.'),
  ('caustic_soda', 'Caustic soda spot', '3', 'INR/kg', 'manual', 168,
   null, false, 'Manual entry.'),
  ('weaving_discount_surat', 'Weaving cash discount (Surat/Ahmedabad)', '3', '%', 'manual', 168,
   null, false, 'Manual entry.'),
  ('mill_utilization', 'Mill operating rate', '3', '%', 'manual', 168,
   null, false, 'Manual entry.'),
  ('usd_inr', 'USD/INR exchange rate', 'overlay', 'INR per USD', 'stable', 24,
   'https://open.er-api.com/v6/latest/USD', false,
   'Free FX API.')
on conflict (slug) do nothing;