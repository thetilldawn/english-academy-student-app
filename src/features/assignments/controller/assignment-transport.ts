export type AssignmentTransportRequest = {
  body?: unknown;
  method?: "DELETE" | "GET" | "POST" | "PUT";
  signal?: AbortSignal;
  url: string;
};

export type AssignmentTransportResponse = {
  data: unknown;
  ok: boolean;
  status: number;
};

export type AssignmentTransport = (
  request: AssignmentTransportRequest,
) => Promise<AssignmentTransportResponse>;

export const browserAssignmentTransport: AssignmentTransport = async ({
  body,
  method = "GET",
  signal,
  url,
}) => {
  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: method === "GET" ? "no-store" : undefined,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    method,
    signal,
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { data, ok: response.ok, status: response.status };
};

export function assignmentTransportError(
  data: unknown,
  fallback: string,
): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }
  return fallback;
}
