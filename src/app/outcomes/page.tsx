'use client';

import { FormEvent, useEffect, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import type { Outcome, Trigger } from '@/lib/types';

export default function OutcomesPage() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    pct: '',
    trigger_id: '',
    notes: '',
  });
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [o, t] = await Promise.all([
      fetch('/api/outcomes').then((r) => r.json()),
      fetch('/api/triggers').then((r) => r.json()),
    ]);
    setOutcomes(Array.isArray(o) ? o : []);
    setTriggers(Array.isArray(t) ? t : []);
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          actual_fabric_price_change_pct: Number(form.pct),
          trigger_id: form.trigger_id ? Number(form.trigger_id) : null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (data.error) setMsg({ type: 'err', text: data.error });
      else {
        setMsg({ type: 'ok', text: 'Outcome logged.' });
        setForm({ ...form, pct: '', notes: '', trigger_id: '' });
        load();
      }
    } catch (e) {
      setMsg({ type: 'err', text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Outcomes</h1>
        <div className="muted">
          Log the actual fabric price moves you observed in the market — used later to
          backtest the rule-based scores.
        </div>
      </header>

      <div className="panel">
        <h2>Log an outcome</h2>
        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Price change (%)</label>
            <input
              type="number"
              step="any"
              value={form.pct}
              onChange={(e) => setForm({ ...form, pct: e.target.value })}
              placeholder="e.g. 2.5"
              required
            />
          </div>
          <div className="field">
            <label>Related trigger (optional)</label>
            <select
              value={form.trigger_id}
              onChange={(e) => setForm({ ...form, trigger_id: e.target.value })}
            >
              <option value="">— none —</option>
              {triggers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.date} · Tier {t.tier} · {t.level}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="what you saw in the market"
            />
          </div>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Log outcome'}
          </button>
        </form>
        {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}
      </div>

      <div className="panel">
        <h2>Past entries</h2>
        {outcomes.length === 0 ? (
          <p className="empty">No outcomes logged yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>% change</th>
                <th>Trigger</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.id}>
                  <td>{o.date}</td>
                  <td>{o.actual_fabric_price_change_pct}%</td>
                  <td>
                    {o.triggers ? (
                      <>
                        Tier {o.triggers.tier} <StatusBadge status={o.triggers.level} /> on {o.triggers.date}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{o.notes ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}