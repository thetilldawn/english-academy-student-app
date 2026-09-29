import "server-only";

import { AuthenticationUnavailableError } from "./authentication-error";
import { privateJsonError } from "@/lib/http";

/** Only infrastructure failures are translated here; genuine denial stays in each route. */
export function withAuthenticationFailureResponse<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (!(error instanceof AuthenticationUnavailableError)) throw error;
      return privateJsonError("로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
  };
}
