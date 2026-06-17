// ============================================================================
// Supabase connection config
// ----------------------------------------------------------------------------
// Fill these in once you've created a free Supabase project and run
// supabase/schema.sql in its SQL Editor. See README.md for the full setup
// walkthrough. The anon key is meant to be public (it's protected by the
// row-level security policies in schema.sql) so it's safe to commit here.
// ============================================================================

export const SUPABASE_URL = 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE';
export const SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';

export const isConfigured =
  SUPABASE_URL.startsWith('http') &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_URL.includes('PASTE_');

let client = null;

export async function getSupabase() {
  if (!isConfigured) return null;
  if (client) return client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
