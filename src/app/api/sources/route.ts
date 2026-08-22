import { NextResponse } from 'next/server';
import { getSourcesWithLatest } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getSourcesWithLatest());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}