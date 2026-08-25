'use client';

import { useEffect, useState } from 'react';
import { subscribeToPush, unsubscribeFromPush, isSubscribed } from '@/lib/push';

export default function SubscribeButton() {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isSubscribed().then(setSubscribed).finally(() => setLoading(false));
  }, []);

  async function toggle() {
    setLoading(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        await subscribeToPush();
        setSubscribed(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!('serviceWorker' in navigator) && typeof window !== 'undefined') return null;

  return (
    <div>
      <button
        className={`btn-subscribe${subscribed ? ' subscribed' : ''}`}
        onClick={toggle}
        disabled={loading}
      >
        {loading ? '...' : subscribed ? '🔔 Alerts ON' : '🔕 Alerts OFF'}
      </button>
      {error && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
