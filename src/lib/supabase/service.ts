import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServiceEnvironment } from "@/lib/env";

let serviceClient: SupabaseClient | undefined;

export function getServiceSupabaseClient(): SupabaseClient {
  if (serviceClient) {
    return serviceClient;
  }

  const environment = getServiceEnvironment();
  serviceClient = createClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );

  return serviceClient;
}
