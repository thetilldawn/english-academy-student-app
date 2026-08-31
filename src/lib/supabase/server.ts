import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnvironment } from "@/lib/env";
import { createDeadlineFetch } from "@/lib/network/request-policy";
import { adminAuthCookieOptions } from "@/lib/supabase/cookie-options";

type ServerSupabaseClientOptions = {
  signal?: AbortSignal;
};

export async function createServerSupabaseClient(
  options: ServerSupabaseClientOptions = {},
) {
  const cookieStore = await cookies();
  const environment = getPublicEnvironment();

  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      ...(options.signal
        ? { global: { fetch: createDeadlineFetch(options.signal) } }
        : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const cookie of cookiesToSet) {
              cookieStore.set(cookie.name, cookie.value, {
                ...cookie.options,
                ...adminAuthCookieOptions(),
              });
            }
          } catch {
            // Server Components cannot write response cookies. proxy.ts refreshes
            // admin sessions before protected pages are rendered.
          }
        },
      },
    },
  );
}
