import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnvironment } from "@/lib/env";
import { adminAuthCookieOptions } from "@/lib/supabase/cookie-options";

export async function createServerSupabaseClient() {
  const environment = getPublicEnvironment();
  const cookieStore = await cookies();

  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
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
