'use client';

import { FormEvent, useState } from 'react';

interface Props {
  sources: { id: number; slug: string; name: string; unit: string }[];
  onComplete: () => void;
}

export default function QuickEntry({ sources, onComplete }: Props) {
  const [selected, setSelected] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !value) return;
    setSaving(true);
    setMsg(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/sources/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_slug: selected, date: today, value: Number(value) }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
      } else {
        setMsg('Saved!');
        setValue('');
        onComplete();
        setTimeout(() => setMsg(null), 3000);
      }
    } catch (err) {
      setMsg(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="entry-card" onSubmit={submit}>
      <div className="entry-header">
        <h3 style={{ fontSize: 14 }}>Quick Entry</h3>
        {msg && <span className={`banner ${msg === 'Saved!' ? 'ok' : 'error'}`} style={{ padding: '4px 10px', fontSize: 12 }}>{msg}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          required
          style={{ flex: '1 1 140px', minHeight: 44 }}
        >
          <option value="">Source...</option>
          {sources.map((s) => (
            <option key={s.id} value={s.slug}>{s.name}</option>
          ))}
        </select>
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          required
          style={{ flex: '1 1 100px', minHeight: 44 }}
        />
        <button type="submit" disabled={saving || !selected || !value} style={{ minHeight: 44 }}>
          {saving ? '...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
