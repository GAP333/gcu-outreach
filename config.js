// ============================================================================
// Supabase connection config
// ----------------------------------------------------------------------------
// Fill these in once you've created a free Supabase project and run
// supabase/schema.sql in its SQL Editor. See README.md for the full setup
// walkthrough. The anon key is meant to be public (it's protected by the
// row-level security policies in schema.sql) so it's safe to commit here.
// ============================================================================

export const SUPABASE_URL = 'https://lpmumgnxdhyfoxazsiyy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbXVtZ254ZGh5Zm94YXpzaXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDY2NTUsImV4cCI6MjA5NTM4MjY1NX0.GJ6JEtnFhDh5Ng1yGXT5KwIaIo6Aafe6w28WQ98IUKk';

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
