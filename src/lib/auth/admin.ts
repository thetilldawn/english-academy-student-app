import "server-only";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";

import {
  ADMIN_AUTH_REQUEST_DEADLINE_MS,
  createRequestDeadline,
  requestTimeoutWithinBudget,
} from "@/lib/network/request-policy";
import { getCurrentRequestContext } from "@/lib/observability/server-request-context";
import { logServerOperationTiming } from "@/lib/observability/request-timing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AdminContext = {
  userId: string;
  displayName: string;
};

export class AdminAuthenticationUnavailableError extends Error {
  readonly code: "AUTH_UPSTREAM_UNAVAILABLE" | "UPSTREAM_TIMEOUT";

  constructor(
    code: "AUTH_UPSTREAM_UNAVAILABLE" | "UPSTREAM_TIMEOUT",
    options: { cause?: unknown } = {},
  ) {
    super("관리자 인증 서버의 응답이 늦어지고 있습니다.", options);
    this.name = "AdminAuthenticationUnavailableError";
    this.code = code;
  }
}

function isUnavailableAuthError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? error.status : undefined;
  return typeof status === "number" && status >= 500;
}

async function readAdminContext(
  parentSignal?: AbortSignal,
): Promise<AdminContext | null> {
  const requestContext = await getCurrentRequestContext();
  const deadline = createRequestDeadline(
    requestTimeoutWithinBudget(
      ADMIN_AUTH_REQUEST_DEADLINE_MS,
      requestContext.absoluteDeadlineAt,
    ),
    parentSignal,
  );
  let operation = "admin.auth.claims";
  let operationStartedAt = performance.now();

  try {
    const supabase = await createServerSupabaseClient({
      signal: deadline.signal,
    });
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    logServerOperationTiming({
      durationMs: performance.now() - operationStartedAt,
      operation,
      outcome: deadline.expired
        ? "timeout"
        : parentSignal?.aborted
          ? "cancelled"
          : isUnavailableAuthError(claimsError)
            ? "error"
            : "success",
      requestId: requestContext.requestId,
    });

    if (
      deadline.expired ||
      parentSignal?.aborted ||
      isUnavailableAuthError(claimsError)
    ) {
      throw new AdminAuthenticationUnavailableError(
        deadline.expired ? "UPSTREAM_TIMEOUT" : "AUTH_UPSTREAM_UNAVAILABLE",
        { cause: claimsError },
      );
    }

    const userId = claimsData?.claims?.sub;
    if (claimsError || typeof userId !== "string") {
      return null;
    }

    operation = "admin.auth.profile";
    operationStartedAt = performance.now();
    const { data: profile, error: profileError } = await supabase
      .from("admin_profiles")
      .select("display_name, is_active")
      .eq("user_id", userId)
      .maybeSingle();
    logServerOperationTiming({
      durationMs: performance.now() - operationStartedAt,
      operation,
      outcome: deadline.expired
        ? "timeout"
        : parentSignal?.aborted
          ? "cancelled"
          : profileError
            ? "error"
            : "success",
      requestId: requestContext.requestId,
    });

    if (deadline.expired || parentSignal?.aborted || profileError) {
      throw new AdminAuthenticationUnavailableError(
        deadline.expired ? "UPSTREAM_TIMEOUT" : "AUTH_UPSTREAM_UNAVAILABLE",
        { cause: profileError },
      );
    }
    if (!profile?.is_active) {
      return null;
    }

    return {
      userId,
      displayName: profile.display_name,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AdminAuthenticationUnavailableError) throw error;

    logServerOperationTiming({
      durationMs: performance.now() - operationStartedAt,
      operation,
      outcome: deadline.expired
        ? "timeout"
        : parentSignal?.aborted
          ? "cancelled"
          : "error",
      requestId: requestContext.requestId,
    });
    throw new AdminAuthenticationUnavailableError(
      deadline.expired ? "UPSTREAM_TIMEOUT" : "AUTH_UPSTREAM_UNAVAILABLE",
      { cause: error },
    );
  } finally {
    deadline.dispose();
  }
}

export const getAdminContextOrThrow = cache(readAdminContext);

export const getAdminContext = cache(async (
  parentSignal?: AbortSignal,
): Promise<AdminContext | null> => {
  try {
    return await getAdminContextOrThrow(parentSignal);
  } catch (error) {
    if (error instanceof AdminAuthenticationUnavailableError) return null;
    throw error;
  }
});

export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getAdminContextOrThrow();

  if (!admin) {
    redirect("/admin/login");
  }

  return admin;
}
