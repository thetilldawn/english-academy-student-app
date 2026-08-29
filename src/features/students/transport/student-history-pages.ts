import type {
  StudentHistoryInitialRequest,
  StudentHistoryPage,
  StudentHistoryPageChunk,
  StudentHistoryPageRequest,
} from "../contracts/student-detail-read-model";

type StudentHistoryResponse = {
  error?: string;
  page?: StudentHistoryPage | StudentHistoryPageChunk;
};

async function requestStudentHistory(
  studentId: string,
  request: StudentHistoryInitialRequest | StudentHistoryPageRequest,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/admin/students/${studentId}/history`, {
    body: JSON.stringify(request),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const payload = await response.json().catch(() => null) as
    | StudentHistoryResponse
    | null;
  if (!response.ok || !payload?.page) {
    throw new Error(payload?.error ?? "학생 시험 내역을 불러오지 못했습니다.");
  }
  return payload.page;
}

export async function loadStudentHistoryInitial(
  studentId: string,
  request: StudentHistoryInitialRequest,
  signal?: AbortSignal,
) {
  const page = await requestStudentHistory(studentId, request, signal);
  if (!("totalCount" in page)) {
    throw new Error("학생 시험 내역 응답을 확인하지 못했습니다.");
  }
  return page;
}

export async function loadStudentHistoryNextPage(
  studentId: string,
  request: StudentHistoryPageRequest,
  signal?: AbortSignal,
): Promise<StudentHistoryPageChunk> {
  return requestStudentHistory(studentId, request, signal);
}
