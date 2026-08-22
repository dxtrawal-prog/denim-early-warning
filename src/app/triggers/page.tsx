'use client';

import { useEffect, useMemo, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import type { SignalDetail, Trigger } from '@/lib/types';

function TriggerRow({ trigger }: { trigger: Trigger }) {
  const [open, setOpen] = useState(false);
  const signals: SignalDetail[] = trigger.triggering_signals?.signals ?? [];

  return (
    <>
      <tr className="clickable" onClick={() => setOpen((o) => !o)}>
        <td>{trigger.date}</td>
        <td>Tier {trigger.tier}</td>
        <td>
          <StatusBadge status={trigger.level} />
        </td>
        <td>{signals.map((s) => s.slug).join(', ') || '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4}>
            <table className="table sub">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Value</th>
                  <th>Date</th>
                  <th>% change</th>
                  <th>z</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.slug}>
                    <td>{s.name}</td>
                    <td>
                      {s.value} {s.unit}
                    </td>
                    <td>{s.date}</td>
                    <td>{s.pct_change != null ? `${s.pct_change.toFixed(2)}%` : '—'}</td>
                    <td>{s.z.toFixed(2)}</td>
                  </tr>
                ))}
                {signals.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No signal detail stored for this trigger.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/triggers')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setTriggers(d);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const sorted = useMemo(
    () =>
      [...triggers].sort((a, b) =>
        sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
      ),
    [triggers, sortAsc],
  );

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Triggers</h1>
        <button className="ghost" onClick={() => setSortAsc((v) => !v)}>
          Sort {sortAsc ? 'newest first' : 'oldest first'}
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!error && sorted.length === 0 && (
        <p className="empty">
          No triggers logged yet. A trigger is written when a tier crosses into amber or red.
        </p>
      )}

      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Tier</th>
              <th>Level</th>
              <th>Signals</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <TriggerRow key={t.id} trigger={t} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}