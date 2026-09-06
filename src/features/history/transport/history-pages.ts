import type { AdminHistoryReadRequest } from "../contracts/admin-history-read-model";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";
import { parseHistoryCacheResponse, parseHistoryNextPage, parseHistorySection, parseHistorySnapshot } from "../api/history-read-response";
import type { HistoryCacheRequest } from "../contracts/history-list-cache-contract";
import { createRequestDeadline, INTERACTIVE_READ_REQUEST_DEADLINE_MS } from "@/lib/network/request-policy";

async function requestHistoryPage(request: AdminHistoryReadRequest | HistoryCacheRequest, signal?: AbortSignal) {
  const deadline = createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS, signal);
  try {
    const response = await fetch("/api/admin/history", {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: deadline.signal,
    });
    // Authentication must not depend on the error body being valid JSON.
    if (response.status === 401) throw new AdminHistoryRequestError("unauthenticated");
    if (response.status === 403) throw new AdminHistoryRequestError("forbidden");
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 400) throw new AdminHistoryRequestError("invalid-request");
      if (payload && typeof payload === "object" && "code" in payload &&
          payload.code === "upstream_timeout") throw new AdminHistoryRequestError("timeout");
      throw new AdminHistoryRequestError("unavailable");
    }
    if (!payload) throw new AdminHistoryRequestError("invalid-response");
    return payload;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (deadline.expired) throw new AdminHistoryRequestError("timeout");
    if (error instanceof AdminHistoryRequestError) throw error;
    throw new AdminHistoryRequestError("unavailable");
  } finally {
    deadline.dispose();
  }
}

export async function loadAdminHistorySnapshot(
  request: Extract<AdminHistoryReadRequest, { mode: "initial" }>,
  signal?: AbortSignal,
) {
  return parseHistorySnapshot(await requestHistoryPage(request, signal), request);
}

export async function readHistoryListCache(request: HistoryCacheRequest, signal?: AbortSignal) {
  return parseHistoryCacheResponse(await requestHistoryPage(request, signal), request);
}

export async function loadAdminHistoryNextPage(
  request: Extract<AdminHistoryReadRequest, { mode: "page" }>,
  signal?: AbortSignal,
) {
  return parseHistoryNextPage(await requestHistoryPage(request, signal));
}

export async function loadAdminHistoryFreshSection(
  request: Extract<AdminHistoryReadRequest, { mode: "section" }>,
  signal?: AbortSignal,
) {
  return parseHistorySection(await requestHistoryPage(request, signal), request.groupKey);
}
