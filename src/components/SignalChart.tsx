'use client';

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendSeries } from '@/lib/types';

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));

export default function SignalChart({ series }: { series: TrendSeries }) {
  const data = series.points;
  if (!data.length) return null;

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pct_change))) * 1.15;
  const b = series.band;

  return (
    <div className="panel chart-panel">
      <div className="chart-head">
        <h3>
          {series.name} <span className="muted">({series.unit})</span>
        </h3>
        <span className="muted">
          Tier {series.tier} · daily % change
          {series.last ? ` · last ${series.last.value} ${series.unit} on ${series.last.date}` : ''}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={48} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            formatter={(value) => [fmt(Number(value)) + '%', 'change']}
          />
          {b.redUpper != null && <ReferenceArea y1={b.redUpper} y2={maxAbs} fill="#ef4444" fillOpacity={0.14} />}
          {b.redLower != null && <ReferenceArea y1={-maxAbs} y2={b.redLower} fill="#ef4444" fillOpacity={0.14} />}
          {b.amberUpper != null && b.redUpper != null && (
            <ReferenceArea y1={b.amberUpper} y2={b.redUpper} fill="#f59e0b" fillOpacity={0.14} />
          )}
          {b.amberLower != null && b.redLower != null && (
            <ReferenceArea y1={b.redLower} y2={b.amberLower} fill="#f59e0b" fillOpacity={0.14} />
          )}
          {b.mean != null && <ReferenceLine y={b.mean} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.7} />}
          <Line
            type="monotone"
            dataKey="pct_change"
            stroke="#60a5fa"
            dot={false}
            strokeWidth={1.6}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend-row">
        <span className="legend red">red zone (|z| &ge; 2.5)</span>
        <span className="legend amber">amber zone (1.5 &le; |z| &lt; 2.5)</span>
        <span className="legend blue">90d rolling mean</span>
      </div>
    </div>
  );
}