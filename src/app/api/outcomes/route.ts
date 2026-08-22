import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getOutcomes } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getOutcomes());
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
  const pct = body.actual_fabric_price_change_pct;
  if (!date || pct === undefined || pct === null || Number.isNaN(Number(pct))) {
    return NextResponse.json(
      { error: 'date and numeric actual_fabric_price_change_pct are required' },
      { status: 400 },
    );
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('outcomes')
    .insert({
      date,
      actual_fabric_price_change_pct: Number(pct),
      trigger_id: body.trigger_id ? Number(body.trigger_id) : null,
      entered_by: typeof body.entered_by === 'string' ? body.entered_by : null,
      notes: typeof body.notes === 'string' && body.notes ? body.notes : null,
    })
    .select('*, triggers(id, date, tier, level)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}