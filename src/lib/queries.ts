import { POLICY_SHOCK_DAYS, TIER_WEIGHTS, statusForZ } from './constants';
import { getSupabase } from './supabase';
import type {
  DashboardData,
  Outcome,
  PolicyNotice,
  ReadingV,
  Source,
  SourceWithLatest,
  TierNumber,
  TierScore,
  Trigger,
} from './types';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchLatestReadings(): Promise<ReadingV[]> {
  const { data, error } = await getSupabase().from('v_latest_readings').select('id,source_id,slug,name,tier,unit,scrape_reliability,expected_update_frequency_hours,frequency,region,rolling_window,rolling_min_periods,is_calculated,last_scrape_at,date,value,ingested_at,data_quality,is_stale');
  if (error) throw new Error(`Failed to load latest readings: ${error.message}`);
  return (data ?? []) as ReadingV[];
}

export async function getSources(): Promise<Source[]> {
  const { data, error } = await getSupabase().from('signal_sources').select('*').order('tier');
  if (error) throw new Error(`Failed to load sources: ${error.message}`);
  return (data ?? []) as Source[];
}

export async function getSourcesWithLatest(): Promise<SourceWithLatest[]> {
  const sb = getSupabase();
  const [{ data: sources }, { data: latest }] = await Promise.all([
    sb.from('signal_sources').select('*').order('tier'),
    sb.from('v_latest_readings').select('*'),
  ]);
  if (!sources) throw new Error('Failed to load sources');
  const byId = new Map<number, ReadingV>((latest ?? []).map((r) => [r.source_id, r as ReadingV]));
  return sources.map((s) => {
    const l = byId.get(s.id);
    return {
      ...(s as Source),
      latest_reading: l
        ? {
            date: l.date,
            value: num(l.value) ?? 0,
            ingested_at: l.ingested_at,
            is_stale: l.is_stale,
            data_quality: (l.data_quality ?? 'live') as any,
          }
        : null,
    };
  });
}

export async function getLatestTierScores(): Promise<Record<TierNumber, TierScore | null>> {
  const { data, error } = await getSupabase()
    .from('tier_scores')
    .select('*')
    .order('date', { ascending: false })
    .limit(10);
  if (error) throw new Error(`Failed to load tier scores: ${error.message}`);
  const out: Record<TierNumber, TierScore | null> = { '1': null, '2': null, '3': null };
  for (const s of data ?? []) {
    const tier = String(s.tier) as TierNumber;
    if (!out[tier]) {
      out[tier] = {
        ...(s as TierScore),
        z_score: num(s.z_score) ?? 0,
        detail: (s.detail ?? []) as TierScore['detail'],
      };
    }
  }
  return out;
}

export async function getPolicyNotices(recentOnly = false): Promise<PolicyNotice[]> {
  let q = getSupabase()
    .from('policy_notices')
    .select('*')
    .order('date', { ascending: false });
  if (recentOnly) {
    q = q.gte('date', daysAgo(POLICY_SHOCK_DAYS));
  }
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load policy notices: ${error.message}`);
  return (data ?? []) as PolicyNotice[];
}

export async function getTriggers(): Promise<Trigger[]> {
  const { data, error } = await getSupabase()
    .from('triggers')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load triggers: ${error.message}`);
  return (data ?? []) as Trigger[];
}

export async function getOutcomes(): Promise<Outcome[]> {
  const { data, error } = await getSupabase()
    .from('outcomes')
    .select('*, triggers(id, date, tier, level)')
    .order('date', { ascending: false });
  if (error) throw new Error(`Failed to load outcomes: ${error.message}`);
  return (data ?? []).map((o) => ({ ...(o as Outcome), actual_fabric_price_change_pct: num(o.actual_fabric_price_change_pct) ?? 0 }));
}

function buildTierViews(
  sources: Source[],
  latest: ReadingV[],
  scores: Record<TierNumber, TierScore | null>,
): Record<TierNumber, DashboardData['tiers'][TierNumber]> {
  const readingBySource = new Map<number, ReadingV>(latest.map((r) => [r.source_id, r]));
  const tiers = {} as Record<TierNumber, DashboardData['tiers'][TierNumber]>;

  (['1', '2', '3'] as TierNumber[]).forEach((tier) => {
    const score = scores[tier];
    const detailBySlug = new Map((score?.detail ?? []).map((d) => [d.slug, d]));
    const signals = sources
      .filter((s) => s.tier === tier)
      .map((s) => {
        const r = readingBySource.get(s.id);
        const d = detailBySlug.get(s.slug);
        return {
          slug: s.slug,
          name: s.name,
          unit: s.unit,
          reliability: s.scrape_reliability,
          value: r ? num(r.value) : null,
          date: r?.date ?? null,
          is_stale: r?.is_stale ?? false,
          z: d ? num(d.z) : null,
          lastScrapeAt: s.last_scrape_at,
          isCalculated: s.is_calculated,
          dataQuality: (r?.data_quality ?? 'live') as any,
        };
      });
    tiers[tier] = {
      tier,
      status: score?.status ?? null,
      z: score ? num(score.z_score) : null,
      scoreDate: score?.date ?? null,
      signals,
    };
  });
  return tiers;
}

function computeCombined(scores: Record<TierNumber, TierScore | null>): DashboardData['combined'] {
  const tiers = (['1', '2', '3'] as TierNumber[]).filter((t) => scores[t]?.z_score != null);
  if (tiers.length === 0) return null;
  const weightSum = tiers.reduce((a, t) => a + TIER_WEIGHTS[Number(t)], 0);
  const z =
    tiers.reduce((a, t) => a + TIER_WEIGHTS[Number(t)] * (scores[t]!.z_score as number), 0) /
    weightSum;
  return { z, status: statusForZ(z), includedTiers: tiers };
}

export async function getDashboard(): Promise<DashboardData> {
  const [sources, latest, scores, notices] = await Promise.all([
    getSources(),
    fetchLatestReadings(),
    getLatestTierScores(),
    getPolicyNotices(true),
  ]);

  const sb = getSupabase();
  const { data: readingCounts } = await sb
    .from('signal_readings')
    .select('source_id, count:id.count()')
    .eq('data_quality', 'live')
    .or('data_quality.eq.manual');

  const realCounts = new Map<number, number>();
  if (readingCounts) {
    for (const row of readingCounts as any[]) {
      realCounts.set(row.source_id, Number(row.count));
    }
  }

  // Last pipeline run: most recent ingested_at among live readings
  const { data: lastRun } = await sb
    .from('signal_readings')
    .select('ingested_at')
    .eq('data_quality', 'live')
    .order('ingested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let lastPipelineRun: DashboardData['lastPipelineRun'] = null;
  if (lastRun?.ingested_at) {
    const ts = lastRun.ingested_at;
    const { data: countRows } = await sb
      .from('signal_readings')
      .select('source_id')
      .eq('data_quality', 'live')
      .eq('ingested_at', ts);
    lastPipelineRun = { at: ts, sourcesUpdated: countRows?.length ?? 0 };
  }

  const tiers = buildTierViews(sources, latest, scores);
  const hasRunScoring = Object.values(scores).some((s) => s !== null);

  const manualSourcesNeeded = sources
    .filter((s) => !s.is_calculated && s.scrape_reliability === 'manual')
    .map((s) => ({ name: s.name, count: realCounts.get(s.id) ?? 0 }));

  return {
    generatedAt: new Date().toISOString(),
    combined: computeCombined(scores),
    tiers,
    sources: sources.map((s) => {
      const l = latest.find((r) => r.source_id === s.id);
      return {
        ...s,
        latest_reading: l
          ? { date: l.date, value: num(l.value) ?? 0, ingested_at: l.ingested_at, is_stale: l.is_stale, data_quality: (l.data_quality ?? 'live') as any }
          : null,
      };
    }),
    policyShock: notices,
    hasRunScoring,
    manualSourcesNeeded,
    lastPipelineRun,
  };
}