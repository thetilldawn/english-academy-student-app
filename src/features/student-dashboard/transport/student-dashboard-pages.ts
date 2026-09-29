import type {
  StudentDashboardCompletedPage,
  StudentDashboardCompletedPageResponse,
} from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { StudentDashboardRequestError } from "../contracts/student-dashboard-request-error";
import { awaitWithAbortSignal, createRequestDeadline, INTERACTIVE_READ_REQUEST_DEADLINE_MS } from "@/lib/network/request-policy";

type StudentDashboardPagePayload = Partial<
  StudentDashboardCompletedPageResponse
> & {
  error?: string;
};

export async function loadStudentDashboardCompletedPage(
  cursor: string,
  signal?: AbortSignal,
): Promise<StudentDashboardCompletedPage> {
  return loadPage("/api/student/dashboard/completed", cursor, signal);
}

export async function loadStudentDashboardSectionPage(cursor: string, signal?: AbortSignal): Promise<StudentDashboardCompletedPage> {
  return loadPage("/api/student/dashboard/sections", cursor, signal);
}

async function loadPage(url: string, cursor: string, signal?: AbortSignal): Promise<StudentDashboardCompletedPage> {
  const deadline = createRequestDeadline(INTERACTIVE_READ_REQUEST_DEADLINE_MS, signal);
  try {
    const response = await awaitWithAbortSignal(fetch(url, {
      body: JSON.stringify({ cursor }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: deadline.signal,
    }), deadline.signal);
    // A denied request is authoritative even if its body is HTML, empty or stalled.
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new StudentDashboardRequestError(response.status);
    }
    const payload = await awaitWithAbortSignal(response.json(), deadline.signal) as
      | StudentDashboardPagePayload
      | null;
    if (!payload?.page || !Array.isArray(payload.page.items) ||
        !(payload.page.nextCursor === null || typeof payload.page.nextCursor === "string")) {
      throw new StudentDashboardRequestError(response.status);
    }
    return payload.page;
  } catch (error) {
    if (error instanceof StudentDashboardRequestError || signal?.aborted) throw error;
    throw new StudentDashboardRequestError(0);
  } finally {
    deadline.dispose();
  }
}

