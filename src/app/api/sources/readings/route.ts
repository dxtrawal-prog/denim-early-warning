import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Manually log a reading for a 'manual' or 'fragile' source
 * (e.g. weaving discounts, mill utilization, or a CAI fallback).
 * Body: { source_slug: string, date: 'YYYY-MM-DD', value: number }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const slug = typeof body.source_slug === 'string' ? body.source_slug : null;
  const date = typeof body.date === 'string' ? body.date : null;
  const value = body.value;
  if (!slug || !date || value === undefined || value === null || Number.isNaN(Number(value))) {
    return NextResponse.json(
      { error: 'source_slug, date and numeric value are required' },
      { status: 400 },
    );
  }

  const sb = getSupabase();
  const { data: src, error: srcError } = await sb
    .from('signal_sources')
    .select('id, slug, is_calculated')
    .eq('slug', slug)
    .maybeSingle();
  if (srcError || !src) {
    return NextResponse.json({ error: `Unknown source slug: ${slug}` }, { status: 404 });
  }
  if (src.is_calculated) {
    return NextResponse.json(
      { error: 'Derived signals are computed by the pipeline, not entered manually' },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from('signal_readings')
    .upsert(
      { source_id: src.id, date, value: Number(value), ingested_at: new Date().toISOString(), data_quality: 'manual' },
      { onConflict: 'source_id,date' },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reading: data }, { status: 201 });
}