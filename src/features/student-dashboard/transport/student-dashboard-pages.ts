import type {
  StudentDashboardCompletedPage,
  StudentDashboardCompletedPageResponse,
} from "@/features/student-dashboard/contracts/student-dashboard-read-model";

type StudentDashboardPagePayload = Partial<
  StudentDashboardCompletedPageResponse
> & {
  error?: string;
};

export async function loadStudentDashboardCompletedPage(
  cursor: string,
  signal?: AbortSignal,
): Promise<StudentDashboardCompletedPage> {
  const response = await fetch("/api/student/dashboard/completed", {
    body: JSON.stringify({ cursor }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const payload = await response.json().catch(() => null) as
    | StudentDashboardPagePayload
    | null;
  if (!response.ok || !payload?.page) {
    throw new Error(
      payload?.error ?? "다음 완료 시험을 불러오지 못했습니다.",
    );
  }
  return payload.page;
}

