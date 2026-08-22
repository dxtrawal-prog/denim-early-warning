'use client';

import { FormEvent, useEffect, useState } from 'react';
import SourceTable from '@/components/SourceTable';
import type { PolicyNotice, SourceWithLatest } from '@/lib/types';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceWithLatest[]>([]);
  const [notices, setNotices] = useState<PolicyNotice[]>([]);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [reading, setReading] = useState({ source_slug: '', date: todayIso(), value: '' });
  const [notice, setNotice] = useState({ date: todayIso(), title: '', description: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    const [s, n] = await Promise.all([
      fetch('/api/sources').then((r) => r.json()),
      fetch('/api/policy-notices').then((r) => r.json()),
    ]);
    setSources(Array.isArray(s) ? s : []);
    setNotices(Array.isArray(n) ? n : []);
  }

  useEffect(() => {
    load();
  }, []);

  const enterable = sources.filter(
    (s) => !s.is_calculated && (s.scrape_reliability === 'manual' || s.scrape_reliability === 'fragile'),
  );

  async function submitReading(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/sources/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_slug: reading.source_slug,
          date: reading.date,
          value: Number(reading.value),
        }),
      });
      const data = await res.json();
      if (data.error) setMsg({ type: 'err', text: data.error });
      else {
        setMsg({ type: 'ok', text: 'Reading saved. It will be scored at the next daily run.' });
        setReading({ ...reading, value: '' });
        load();
      }
    } catch (err) {
      setMsg({ type: 'err', text: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function submitNotice(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/policy-notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: notice.date,
          title: notice.title,
          description: notice.description || null,
        }),
      });
      const data = await res.json();
      if (data.error) setMsg({ type: 'err', text: data.error });
      else {
        setMsg({ type: 'ok', text: 'Policy notice logged — the Policy Shock banner is now active.' });
        setNotice({ date: todayIso(), title: '', description: '' });
        load();
      }
    } catch (err) {
      setMsg({ type: 'err', text: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function removeNotice(id: number) {
    const res = await fetch(`/api/policy-notices/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Sources</h1>
        <div className="muted">
          Spot a broken scraper fast: check the <em>Last scrape</em> and stale badges below.
          {sources.length > 0 && (() => {
            const latest = sources
              .filter((s) => s.last_scrape_at)
              .sort((a, b) => new Date(b.last_scrape_at!).getTime() - new Date(a.last_scrape_at!).getTime())[0];
            return latest ? (
              <span> Latest scrape across all sources: <strong>{new Date(latest.last_scrape_at!).toLocaleString()}</strong>.</span>
            ) : null;
          })()}
        </div>
      </header>

      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      <div className="panel">
        <h2>All signal sources</h2>
        <SourceTable sources={sources} showLastScrape />
      </div>

      <div className="panel">
        <h2>Manual reading entry</h2>
        <p className="muted">
          Sources marked <em>manual</em> have no reliable public feed — enter what you observe in the
          market. <em>Fragile</em> sources can also be entered here as a fallback if the scraper
          cannot parse them. Values are never estimated automatically.
        </p>
        <form className="form-grid" onSubmit={submitReading}>
          <div className="field">
            <label>Source</label>
            <select
              value={reading.source_slug}
              onChange={(e) => setReading({ ...reading, source_slug: e.target.value })}
              required
            >
              <option value="">— select —</option>
              {enterable.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name} ({s.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              value={reading.date}
              onChange={(e) => setReading({ ...reading, date: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Value</label>
            <input
              type="number"
              step="any"
              value={reading.value}
              onChange={(e) => setReading({ ...reading, value: e.target.value })}
              placeholder="e.g. 95"
              required
            />
          </div>
          <button type="submit" disabled={saving || !reading.source_slug}>
            {saving ? 'Saving…' : 'Save reading'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Policy notices (duty / GST changes)</h2>
        <p className="muted">
          Log import-duty or GST changes here. Any notice entered in the last 3 days shows the
          <strong> Policy Shock</strong> banner on the dashboard, independent of the z-scores.
        </p>
        <form className="form-grid" onSubmit={submitNotice}>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              value={notice.date}
              onChange={(e) => setNotice({ ...notice, date: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Title</label>
            <input
              value={notice.title}
              onChange={(e) => setNotice({ ...notice, title: e.target.value })}
              placeholder="e.g. Cotton import duty raised 10%"
              required
            />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <input
              value={notice.description}
              onChange={(e) => setNotice({ ...notice, description: e.target.value })}
              placeholder="what changed and when"
            />
          </div>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add notice'}
          </button>
        </form>

        <div className="notice-list" style={{ marginTop: 14 }}>
          {notices.length === 0 && <p className="empty">No policy notices logged.</p>}
          {notices.map((n) => (
            <div key={n.id} className="notice-item">
              <div>
                <strong>{n.title}</strong> <small>· {n.date}</small>
                {n.description && <div className="muted">{n.description}</div>}
              </div>
              <button className="ghost" onClick={() => removeNotice(n.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}