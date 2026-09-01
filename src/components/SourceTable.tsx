import ReliabilityTag from './ReliabilityTag';
import StaleBadge from './StaleBadge';
import type { SourceWithLatest } from '@/lib/types';

export default function SourceTable({
  sources,
  showLastScrape = true,
}: {
  sources: SourceWithLatest[];
  showLastScrape?: boolean;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Source</th>
          <th>Tier</th>
          <th>Reliability</th>
          <th>Freq</th>
          <th>Region</th>
          <th>Unit</th>
          <th>Last reading</th>
          <th>Reading date</th>
          {showLastScrape && <th>Last scrape</th>}
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.id}>
            <td>
              {s.name} {s.is_calculated && <span className="tag calc">derived</span>}
            </td>
            <td>{s.tier === 'overlay' ? 'overlay' : `Tier ${s.tier}`}</td>
            <td>
              <ReliabilityTag r={s.scrape_reliability} />
            </td>
            <td>
              <span className="tag tag-freq">{s.frequency ?? 'daily'}</span>
            </td>
            <td>{s.region ?? 'india'}</td>
            <td>{s.unit}</td>
            <td>
              {s.latest_reading ? (
                <>
                  {s.latest_reading.value} {s.latest_reading.is_stale && <StaleBadge />}
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td>{s.latest_reading?.date ?? '—'}</td>
            {showLastScrape && (
              <td>
                {s.last_scrape_at ? (
                  new Date(s.last_scrape_at).toLocaleString()
                ) : (
                  <span className="muted">never</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}