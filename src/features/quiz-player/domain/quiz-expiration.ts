import type { QuizExpirationResponse } from "../model";

export const EXPIRATION_RETRY_DELAYS_MS = [1_000, 3_000] as const;

export function canRetryQuizExpiration(response: QuizExpirationResponse): boolean {
  return !response.ok && response.payload.retryable === true && response.payload.outcome === "not_applied";
}
