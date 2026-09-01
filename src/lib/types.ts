export type TierNumber = '1' | '2' | '3';
export type Reliability = 'stable' | 'fragile' | 'manual';
export type Status = 'green' | 'amber' | 'red';
export type TriggerLevel = 'amber' | 'red';
export type DataQuality = 'live' | 'manual' | 'synthetic_seed' | 'test_injection';
export type Frequency = 'daily' | 'weekly' | 'monthly';
export type Region = 'india' | 'china' | 'global';

export interface Source {
  id: number;
  slug: string;
  name: string;
  tier: TierNumber | 'overlay';
  unit: string;
  scrape_reliability: Reliability;
  expected_update_frequency_hours: number;
  url: string | null;
  is_calculated: boolean;
  notes: string | null;
  frequency: Frequency;
  region: Region;
  rolling_window: number | null;
  rolling_min_periods: number | null;
  last_scrape_at: string | null;
  created_at: string;
}

export interface SourceWithLatest extends Source {
  latest_reading: {
    date: string;
    value: number;
    ingested_at: string;
    is_stale: boolean;
    data_quality: DataQuality;
  } | null;
}

/** Row of the signal_readings_v / v_latest_readings views. */
export interface ReadingV {
  id: number;
  source_id: number;
  slug: string;
  name: string;
  tier: string;
  unit: string;
  scrape_reliability: Reliability;
  expected_update_frequency_hours: number;
  frequency: Frequency;
  region: Region;
  rolling_window: number | null;
  rolling_min_periods: number | null;
  is_calculated: boolean;
  last_scrape_at: string | null;
  date: string;
  value: number;
  ingested_at: string;
  is_stale: boolean;
  data_quality: DataQuality;
}

export interface SignalDetail {
  slug: string;
  name: string;
  unit: string;
  value: number;
  date: string;
  pct_change: number | null;
  z: number;
}

export interface TierScore {
  id: number;
  date: string;
  tier: number;
  z_score: number;
  status: Status;
  signal_count: number;
  detail: SignalDetail[] | null;
  created_at: string;
}

export interface Trigger {
  id: number;
  date: string;
  tier: string;
  level: TriggerLevel;
  triggering_signals: {
    tier_z?: number;
    status?: string;
    signals?: SignalDetail[];
  } | null;
  notes: string | null;
  created_at: string;
}

export interface Outcome {
  id: number;
  trigger_id: number | null;
  date: string;
  actual_fabric_price_change_pct: number;
  entered_by: string | null;
  notes: string | null;
  created_at: string;
  triggers?: { id: number; date: string; tier: string; level: string } | null;
}

export interface PolicyNotice {
  id: number;
  date: string;
  title: string;
  description: string | null;
  entered_by: string | null;
  created_at: string;
}

export interface TierStatusView {
  tier: TierNumber;
  status: Status | null;
  z: number | null;
  scoreDate: string | null;
  signals: {
    slug: string;
    name: string;
    unit: string;
    reliability: Reliability;
    value: number | null;
    date: string | null;
    is_stale: boolean;
    z: number | null;
    lastScrapeAt: string | null;
    isCalculated: boolean;
    dataQuality: DataQuality;
  }[];
}

export interface DashboardData {
  generatedAt: string;
  combined: {
    z: number | null;
    status: Status | null;
    includedTiers: TierNumber[];
  } | null;
  tiers: Record<TierNumber, TierStatusView>;
  sources: SourceWithLatest[];
  policyShock: PolicyNotice[];
  hasRunScoring: boolean;
  manualSourcesNeeded: { name: string; count: number }[];
  lastPipelineRun: { at: string | null; sourcesUpdated: number } | null;
}

export interface TrendBand {
  mean: number | null;
  sd: number | null;
  amberUpper: number | null;
  redUpper: number | null;
  amberLower: number | null;
  redLower: number | null;
}

export interface TrendPoint {
  date: string;
  pct_change: number;
}

export interface TrendSeries {
  slug: string;
  name: string;
  unit: string;
  tier: string;
  reliability: Reliability;
  frequency: Frequency;
  window: number;
  hasSyntheticHistory: boolean;
  points: TrendPoint[];
  band: TrendBand;
  last: { date: string; value: number } | null;
}