import StaleBadge from './StaleBadge';
import StatusBadge from './StatusBadge';
import type { DataQuality, TierStatusView } from '@/lib/types';

function DataQualityBadge({ quality }: { quality: DataQuality }) {
  if (quality === 'live') return null;
  const labels: Record<DataQuality, string> = {
    live: '',
    manual: 'Manual',
    synthetic_seed: 'Test/Seed — not scored',
    test_injection: 'Test injection — not scored',
  };
  return <span className={`tag dq dq-${quality}`}>{labels[quality]}</span>;
}

export default function TierCard({ view }: { view: TierStatusView }) {
  return (
    <div className="panel tier-card">
      <div className="tier-head">
        <h2>Tier {view.tier}</h2>
        {view.status ? <StatusBadge status={view.status} /> : <span className="muted">no data</span>}
      </div>
      {view.z != null && (
        <div className="tier-z">
          z = {view.z.toFixed(2)} <span className="muted">({view.scoreDate})</span>
        </div>
      )}
      <ul className="signal-list">
        {view.signals.map((s) => (
          <li key={s.slug}>
            <div className="signal-name">
              {s.name}
              {s.isCalculated && <span className="tag calc">derived</span>}
              <DataQualityBadge quality={s.dataQuality} />
            </div>
            <div className="signal-meta">
              {s.z != null ? <span>z {s.z.toFixed(2)}</span> : <span className="muted">no z yet</span>}
              <span> · </span>
              {s.value != null ? (
                <span>
                  {s.value} {s.unit}
                </span>
              ) : (
                <span className="muted">no reading</span>
              )}
              {s.date ? <span> · {s.date}</span> : null}
              {s.is_stale && <StaleBadge />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}