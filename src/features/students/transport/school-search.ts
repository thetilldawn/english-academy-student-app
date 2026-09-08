import { createRequestDeadline, awaitWithAbortSignal, INTERACTIVE_READ_REQUEST_DEADLINE_MS } from "@/lib/network/request-policy";
import { SchoolSearchRequestError, schoolSearchMessages, schoolSearchRequestSchema, schoolSearchResponseSchema } from "../contracts/school-search-contract";

export async function loadSchoolSearch(query: string, signal: AbortSignal) {
  const input = schoolSearchRequestSchema.safeParse({ query });
  if (!input.success) throw new SchoolSearchRequestError(400, schoolSearchMessages.invalid);
  const deadline = createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS, signal);
  try {
    const response = await awaitWithAbortSignal(fetch("/api/admin/schools/search", {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data), signal: deadline.signal,
    }), deadline.signal);
    if (!response.ok) {
      // Safe fixed copy; arbitrary server text is not a UI message.
      throw new SchoolSearchRequestError(response.status, [401, 403].includes(response.status) ? schoolSearchMessages.auth : schoolSearchMessages.error);
    }
    const parsed = schoolSearchResponseSchema.safeParse(await awaitWithAbortSignal(response.json(), deadline.signal));
    if (!parsed.success) throw new SchoolSearchRequestError(503);
    return parsed.data;
  } finally { deadline.dispose(); }
}
