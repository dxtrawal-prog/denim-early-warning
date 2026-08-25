import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:dxtrawal@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export async function POST(req: Request) {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
    }

    const { title, body, tag } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'Missing title or body' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: subs, error } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (error) throw error;

    const payload = JSON.stringify({ title, body, tag: tag || 'denim-alert' });
    const results = { sent: 0, failed: 0 };

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        results.sent++;
      } catch {
        results.failed++;
        if ((await import('node:http')).default) {
          // Remove expired/invalid subscriptions
          await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
