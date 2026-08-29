import type {
  StudentDirectoryPage,
  StudentDirectoryReadRequest,
  StudentDirectorySnapshot,
} from "../contracts/student-directory-read-model";

type StudentDirectoryResponse = {
  error?: string;
  page?: StudentDirectoryPage;
  snapshot?: StudentDirectorySnapshot;
};

async function requestStudentDirectory(
  request: StudentDirectoryReadRequest,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/admin/students/directory", {
    body: JSON.stringify(request),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const payload = await response.json().catch(() => null) as
    | StudentDirectoryResponse
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "학생 목록을 불러오지 못했습니다.");
  }
  return payload;
}
export async function loadStudentDirectorySnapshot(
  request: Extract<StudentDirectoryReadRequest, { mode: "initial" }>,
  signal?: AbortSignal,
) {
  const payload = await requestStudentDirectory(request, signal);
  if (!payload.snapshot) {
    throw new Error("학생 목록 응답을 확인하지 못했습니다.");
  }
  return payload.snapshot;
}

export async function loadStudentDirectoryNextPage(
  request: Extract<StudentDirectoryReadRequest, { mode: "page" }>,
  signal?: AbortSignal,
) {
  const payload = await requestStudentDirectory(request, signal);
  if (!payload.page) {
    throw new Error("다음 학생 목록 응답을 확인하지 못했습니다.");
  }
  return payload.page;
}
