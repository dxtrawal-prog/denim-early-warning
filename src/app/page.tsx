import ReliabilityTag from '@/components/ReliabilityTag';
import StaleBadge from '@/components/StaleBadge';
import StatusBadge from '@/components/StatusBadge';
import TierCard from '@/components/TierCard';
import { getDashboard } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const data = await getDashboard();
  const combined = data.combined;

  return (
    <div className="stack">
      <header className="hero">
        <div>
          <h1>Denim Fabric Price Early-Warning</h1>
          <div className="muted">
            Combined market pressure (weights: Tier1 35% · Tier2 45% · Tier3 20%)
          </div>
        </div>
        <div className="hero-right">
          {combined ? (
            <>
              <StatusBadge status={combined.status} label="Market pressure" />
              <div className="score">z = {combined.z?.toFixed(2)}</div>
              <div className="muted">tiers included: {combined.includedTiers.join(', ')}</div>
            </>
          ) : (
            <div className="muted">
              {data.hasRunScoring
                ? 'No tiers scored yet.'
                : 'Awaiting first daily pipeline run (see README: run scraper/run.py once).'}
            </div>
          )}
        </div>
      </header>

      {data.policyShock.length > 0 && (
        <div className="banner shock">
          <strong>Policy shock:</strong>{' '}
          {data.policyShock.map((n) => `${n.title} (${n.date})`).join('; ')}
        </div>
      )}

      {data.manualSourcesNeeded.length > 0 && (
        <div className="banner info">
          <strong>Building history:</strong> Z-scores require {30} readings minimum per signal.
          Enter daily values on the{' '}
          <a href="/sources">Sources page</a> to build up history.
          <ul className="reading-counts">
            {data.manualSourcesNeeded.map((s) => (
              <li key={s.name}>{s.name}: {s.count}/30 readings</li>
            ))}
          </ul>
        </div>
      )}

      <div className="tier-grid">
        {(['1', '2', '3'] as const).map((t) => (
          <TierCard key={t} view={data.tiers[t]} />
        ))}
      </div>

      <section className="panel">
        <h2>Source health</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Tier</th>
              <th>Reliability</th>
              <th>Last reading</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name} {s.is_calculated && <span className="tag calc">derived</span>}
                </td>
                <td>{s.tier === 'overlay' ? 'overlay' : `Tier ${s.tier}`}</td>
                <td>
                  <ReliabilityTag r={s.scrape_reliability} />
                </td>
                <td>
                  {s.latest_reading ? (
                    <>
                      {s.latest_reading.value} {s.unit} {s.latest_reading.is_stale && <StaleBadge />}
                      {s.latest_reading.data_quality !== 'live' && (
                        <span className={`tag dq dq-${s.latest_reading.data_quality}`}>
                          {s.latest_reading.data_quality === 'manual' ? 'Manual' : 'Test/Seed'}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{s.latest_reading?.date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}