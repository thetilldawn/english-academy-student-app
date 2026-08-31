import type {
  AdminHistoryNextPage,
  AdminHistoryReadRequest,
  AdminHistorySectionRefresh,
  AdminHistorySnapshot,
} from "@/features/history/contracts/admin-history-read-model";
import {
  createRequestDeadline,
  INTERACTIVE_READ_REQUEST_DEADLINE_MS,
} from "@/lib/network/request-policy";

type HistoryPageResponse = {
  code?: string;
  error?: string;
  page?: AdminHistoryNextPage;
  section?: AdminHistorySectionRefresh["section"];
  snapshot?: AdminHistorySnapshot;
};

async function requestHistoryPage(
  request: AdminHistoryReadRequest,
  signal?: AbortSignal,
) {
  const deadline = createRequestDeadline(
    INTERACTIVE_READ_REQUEST_DEADLINE_MS,
    signal,
  );

  try {
    const response = await fetch("/api/admin/history", {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: deadline.signal,
    });
    const payload = await response.json().catch(() => null) as
      | HistoryPageResponse
      | null;
    if (!response.ok || !payload) {
      throw new Error(
        payload?.error ?? "시험 내역을 불러오지 못했습니다.",
      );
    }
    return payload;
  } catch (error) {
    if (deadline.expired) {
      throw new Error(
        "시험 내역 응답이 늦어지고 있습니다. 다시 시도해 주세요.",
      );
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

export async function loadAdminHistorySnapshot(
  request: Extract<AdminHistoryReadRequest, { mode: "initial" }>,
  signal?: AbortSignal,
) {
  const payload = await requestHistoryPage(request, signal);
  if (!payload.snapshot) {
    throw new Error("시험 내역 응답을 확인하지 못했습니다.");
  }
  return payload.snapshot;
}

export async function loadAdminHistoryNextPage(
  request: Extract<AdminHistoryReadRequest, { mode: "page" }>,
  signal?: AbortSignal,
) {
  const payload = await requestHistoryPage(request, signal);
  if (!payload.page) {
    throw new Error("다음 시험 내역 응답을 확인하지 못했습니다.");
  }
  return payload.page;
}

export async function loadAdminHistoryFreshSection(
  request: Extract<AdminHistoryReadRequest, { mode: "section" }>,
  signal?: AbortSignal,
) {
  const payload = await requestHistoryPage(request, signal);
  if (!payload.section) {
    throw new Error("시험 내역 구역 응답을 확인하지 못했습니다.");
  }
  return payload.section;
}
