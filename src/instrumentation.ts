import type { Instrumentation } from "next";

import { getErrorReference } from "@/lib/observability/error-reference";
import { logServerError } from "@/lib/observability/server-log";

function firstHeader(
  value: string | string[] | undefined,
): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  logServerError({
    event: "request.failed",
    error,
    errorId: getErrorReference(error),
    requestId: firstHeader(request.headers["x-vercel-id"]),
    route: context.routePath,
    method: request.method,
    context: {
      routerKind: context.routerKind,
      routeType: context.routeType,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
    },
  });
};
