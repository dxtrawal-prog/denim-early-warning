import { FREQUENCY_CONFIG } from './constants';

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface ZPoint {
  date: string;
  value: number;
  pct_change: number | null;
  mean: number | null;
  sd: number | null;
  z: number | null;
}

interface ZParams {
  /** Signal frequency — drives rolling window + min observations. Defaults to daily. */
  frequency?: Frequency;
  /** Optional explicit overrides (per-source values from the catalog). */
  window?: number | null;
  minPeriods?: number | null;
}

/**
 * Rolling z-score of % change over a per-frequency window
 * (daily 90 / min 30, weekly 52 / min 12, monthly 24 / min 6).
 * Uses population std (ddof=0) to stay consistent with the Python scorer.
 * For metrics that cross zero (like yarn_cotton_spread), use absolute
 * day-over-day change instead of percentage change.
 */
export function computeZSeries(
  sorted: { date: string; value: number }[],
  useAbsoluteChange = false,
  params: ZParams = {},
): ZPoint[] {
  const cfg = FREQUENCY_CONFIG[params.frequency ?? 'daily'];
  const window = params.window ? Number(params.window) : cfg.window;
  const minPeriods = params.minPeriods != null ? Number(params.minPeriods) : cfg.minPeriods;

  return computeZSeriesCustom(
    sorted,
    window,
    minPeriods,
    useAbsoluteChange,
  );
}

/** Core implementation with explicit window/minPeriods (also used for tests). */
export function computeZSeriesCustom(
  sorted: { date: string; value: number }[],
  window: number,
  minPeriods: number,
  useAbsoluteChange = false,
): ZPoint[] {
  const pct = sorted.map((p, i) => {
    if (i === 0) return { date: p.date, value: p.value, pct: null as number | null };
    const prev = sorted[i - 1].value;
    const c = useAbsoluteChange
      ? p.value - prev
      : prev !== 0
        ? ((p.value - prev) / prev) * 100
        : null;
    return { date: p.date, value: p.value, pct: c };
  });

  return pct.map((p, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = pct
      .slice(start, i)
      .map((x) => x.pct)
      .filter((x): x is number => x !== null);
    if (slice.length < minPeriods || p.pct === null) {
      return { date: p.date, value: p.value, pct_change: p.pct, mean: null, sd: null, z: null };
    }
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const sd = Math.sqrt(variance);
    const z = sd === 0 ? 0 : (p.pct - mean) / sd;
    return { date: p.date, value: p.value, pct_change: p.pct, mean, sd, z };
  });
}

/** Most recent point that actually has a z-score. */
export function latestZ(points: ZPoint[]): ZPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].z !== null) return points[i];
  }
  return null;
}