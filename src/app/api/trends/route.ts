import { NextResponse } from 'next/server';
import { getTrends } from '@/lib/trends';

export const dynamic = 'force-dynamic';

const VALID_RANGES = [30, 90, 180];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const n = Number(searchParams.get('range'));
  const range = VALID_RANGES.includes(n) ? n : 90;
  try {
    return NextResponse.json(await getTrends(range));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}