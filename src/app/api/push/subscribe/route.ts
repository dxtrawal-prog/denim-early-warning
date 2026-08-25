import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { endpoint, p256dh, auth } = await req.json();
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Missing endpoint, p256dh, or auth' }, { status: 400 });
    }

    const sb = getSupabase();
    const { error } = await sb
      .from('push_subscriptions')
      .upsert({ endpoint, p256dh, auth, user_agent: req.headers.get('user-agent') ?? '' }, { onConflict: 'endpoint' });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
