import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Server-side Supabase client. RLS is disabled on all tables (single-owner
 * tool), so the anon key has full access. Only call from API routes / server
 * components — never from client components.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local).',
    );
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}