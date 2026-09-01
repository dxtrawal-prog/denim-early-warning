import { FREQUENCY_CONFIG } from './constants';
import { getSupabase } from './supabase';
import type { Frequency, Source, TrendSeries } from './types';
import { computeZSeries, latestZ } from './zscore';

function computeWindow(s: Source): number {
  const f = (s.frequency as Frequency) ?? 'daily';
  return s.rolling_window ?? FREQUENCY_CONFIG[f].window;
}

/** Fetch start date: the displayed range plus the per-frequency rolling window,
 *  so both the visible points and the z-band baseline are computed in full.
 *  (Also keeps the query under PostgREST's 1000-row cap for 4y dailies.) */
function fetchStartIso(rangeDays: number, s: Source): string {
  const f = (s.frequency as Frequency) ?? 'daily';
  const periodDays = f === 'monthly' ? 31 : f === 'weekly' ? 7 : 1;
  const window = s.rolling_window ?? FREQUENCY_CONFIG[f].window;
  const backDays = rangeDays + window * periodDays + 5;
  const d = new Date();
  d.setDate(d.getDate() - backDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-signal daily % change series with the rolling band stats (current
 * window mean/std) used to draw the amber/red threshold bands on /trends.
 */
export async function getTrends(rangeDays: number): Promise<TrendSeries[]> {
  const sb = getSupabase();
  const { data: sources } = await sb.from('signal_sources').select('*').order('tier');
  if (!sources) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const out: TrendSeries[] = [];
  for (const s of sources as Source[]) {
    if (s.tier === 'overlay') continue; // FX is an overlay signal, not plotted

    const { data: readings, error: readingsError } = await sb
      .from('signal_readings')
      .select('date,value,data_quality')
      .eq('source_id', s.id)
      .gte('date', fetchStartIso(rangeDays, s))
      .in('data_quality', ['live', 'manual', 'synthetic_seed'])
      .order('date', { ascending: true })
      .limit(3000);
    if (readingsError) {
      console.error(`trends: ${s.slug}: ${readingsError.message}`);
      continue;
    }
    if (!readings || readings.length < 2) continue;
    const hasSyntheticHistory = readings.some((r) => r.data_quality === 'synthetic_seed');

    const useAbsolute = s.slug === 'yarn_cotton_spread';
    const zs = computeZSeries(
      readings.map((r) => ({ date: r.date, value: Number(r.value) })),
      useAbsolute,
      {
        frequency: (s.frequency as 'daily' | 'weekly' | 'monthly') ?? 'daily',
        window: s.rolling_window,
        minPeriods: s.rolling_min_periods,
      },
    );
    const withPct = zs.filter((p) => p.pct_change !== null);
    const points = withPct
      .filter((p) => p.date >= cutoffIso)
      .map((p) => ({ date: p.date, pct_change: p.pct_change as number }));

    const last = latestZ(zs);
    const band = {
      mean: last?.mean ?? null,
      sd: last?.sd ?? null,
      amberUpper: last?.mean != null && last.sd != null ? last.mean + 1.5 * last.sd : null,
      redUpper: last?.mean != null && last.sd != null ? last.mean + 2.5 * last.sd : null,
      amberLower: last?.mean != null && last.sd != null ? last.mean - 1.5 * last.sd : null,
      redLower: last?.mean != null && last.sd != null ? last.mean - 2.5 * last.sd : null,
    };

    out.push({
      slug: s.slug,
      name: s.name,
      unit: s.unit,
      tier: s.tier,
      reliability: s.scrape_reliability,
      frequency: (s.frequency as 'daily' | 'weekly' | 'monthly') ?? 'daily',
      window: computeWindow(s),
      hasSyntheticHistory,
      points,
      band,
      last: withPct.length ? { date: withPct[withPct.length - 1].date, value: withPct[withPct.length - 1].value } : null,
    });
  }
  return out;
}