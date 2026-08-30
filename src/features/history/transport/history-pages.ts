import type {
  AdminHistoryNextPage,
  AdminHistoryReadRequest,
  AdminHistorySectionRefresh,
  AdminHistorySnapshot,
} from "@/features/history/contracts/admin-history-read-model";

type HistoryPageResponse = {
  error?: string;
  page?: AdminHistoryNextPage;
  section?: AdminHistorySectionRefresh["section"];
  snapshot?: AdminHistorySnapshot;
};

async function requestHistoryPage(
  request: AdminHistoryReadRequest,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/admin/history", {
    body: JSON.stringify(request),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
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
