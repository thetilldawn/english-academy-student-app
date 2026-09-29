import "server-only";

import { createServerClient } from "@supabase/ssr";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicEnvironment } from "@/lib/env";
import { createAuthSafeFetch } from "@/lib/supabase/auth-fetch";
import { adminAuthCookieOptions } from "@/lib/supabase/cookie-options";

type ServerSupabaseClientOptions = {
  signal?: AbortSignal;
  deferCookieDeletion?: (apply: () => void) => void;
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
      global: { fetch: createAuthSafeFetch(environment.NEXT_PUBLIC_SUPABASE_URL, options.signal) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          const apply = () => {
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
          };
          // Refresh writes are immediate; only the final sign-out deletion is held.
          if (options.deferCookieDeletion && cookiesToSet.length > 0 && cookiesToSet.every(cookie => cookie.value === "" && cookie.options.maxAge === 0)) {
            options.deferCookieDeletion(apply);
          } else {
            apply();
          }
        },
      },
    },
  );
}

export async function signOutAdminSession() {
  const deletions: Array<() => void> = [];
  const client = await createServerSupabaseClient({ deferCookieDeletion: apply => deletions.push(apply) });
  const result = await client.auth.signOut({ scope: "local" });
  const alreadyInvalid = isAuthSessionMissingError(result.error) || (
    isAuthApiError(result.error) && ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "bad_jwt", "user_not_found"].includes(result.error.code ?? "")
  );
  // The SDK clears local storage even on a server error. Keep the cookie for a retry.
  if (!result.error || alreadyInvalid) for (const apply of deletions) apply();
  return alreadyInvalid ? { error: null } : result;
}
