import { createClient } from '@supabase/supabase-js';

export function createSupabaseUserClient({
  accessToken,
  supabaseAnonKey,
  supabaseUrl,
}: {
  accessToken: string;
  supabaseAnonKey: string;
  supabaseUrl: string;
}) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function createSupabaseServiceClient({
  serviceRoleKey,
  supabaseUrl,
}: {
  serviceRoleKey: string;
  supabaseUrl: string;
}) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
