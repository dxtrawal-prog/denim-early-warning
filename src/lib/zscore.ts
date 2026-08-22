import { ROLLING_MIN_PERIODS, ROLLING_WINDOW } from './constants';

export interface ZPoint {
  date: string;
  value: number;
  pct_change: number | null;
  mean: number | null;
  sd: number | null;
  z: number | null;
}

/**
 * Rolling z-score of daily % change over a 90-day window (min 30 obs).
 * Uses population std (ddof=0) to stay consistent with the Python scorer.
 * For metrics that cross zero (like yarn_cotton_spread), use absolute
 * day-over-day change instead of percentage change.
 */
export function computeZSeries(
  sorted: { date: string; value: number }[],
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
    const start = Math.max(0, i - ROLLING_WINDOW + 1);
    const slice = pct
      .slice(start, i)
      .map((x) => x.pct)
      .filter((x): x is number => x !== null);
    if (slice.length < ROLLING_MIN_PERIODS || p.pct === null) {
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