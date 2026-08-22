'use client';

import { useEffect, useState } from 'react';
import SignalChart from '@/components/SignalChart';
import type { TrendSeries } from '@/lib/types';

const RANGES = [30, 90, 180] as const;

export default function TrendsPage() {
  const [range, setRange] = useState<number>(90);
  const [series, setSeries] = useState<TrendSeries[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trends?range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else {
          setSeries(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Trends</h1>
        <div className="range-picker">
          {RANGES.map((r) => (
            <button
              key={r}
              className={r === range ? 'active' : ''}
              onClick={() => setRange(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!error && series.length === 0 && (
        <p className="empty">
          No signal history yet — readings appear after the daily pipeline starts collecting data.
        </p>
      )}

      <div className="chart-grid">
        {series.map((s) => (
          <SignalChart key={s.slug} series={s} />
        ))}
      </div>
    </div>
  );
}