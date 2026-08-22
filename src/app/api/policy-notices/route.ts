import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getPolicyNotices } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getPolicyNotices(false));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date : null;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
  if (!date || !title) {
    return NextResponse.json({ error: 'date and title are required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('policy_notices')
    .insert({
      date,
      title,
      description: typeof body.description === 'string' && body.description ? body.description : null,
      entered_by: typeof body.entered_by === 'string' && body.entered_by ? body.entered_by : null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}