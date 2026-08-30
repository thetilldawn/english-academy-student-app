import type {
  AssignmentDatasetUnitsResponse,
  AssignmentDatasetDirectoryResponse,
  AssignmentDirectorySelectionRequest,
  AssignmentDirectorySelectionResponse,
  AssignmentEditContext,
  AssignmentPlannerPreparation,
  AssignmentPreviousExamResponse,
} from "../contracts/assignment-workspace-read-model";

type ErrorPayload = { error?: string };

async function readJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallback: string,
) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as
    | (T & ErrorPayload)
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? fallback);
  }
  return payload;
}

export async function loadAssignmentDirectorySelection(
  request: AssignmentDirectorySelectionRequest,
  signal?: AbortSignal,
) {
  const payload = await readJson<{
    selection: AssignmentDirectorySelectionResponse;
  }>(
    "/api/admin/assignment-workspace/selection",
    {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    },
    "선택할 학생을 불러오지 못했습니다.",
  );
  return payload.selection;
}

export async function loadAssignmentPlannerPreparation(
  request: { initialDatasetId?: string; studentIds: readonly string[] },
  signal?: AbortSignal,
) {
  const payload = await readJson<{ preparation: AssignmentPlannerPreparation }>(
    "/api/admin/assignment-workspace/preparation",
    {
      body: JSON.stringify({
        initialDatasetId: request.initialDatasetId ?? "",
        studentIds: request.studentIds,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    },
    "배정 준비 자료를 불러오지 못했습니다.",
  );
  return payload.preparation;
}

export async function loadAssignmentPreviousExam(
  request: { datasetId: string; studentId: string },
  signal?: AbortSignal,
) {
  return readJson<AssignmentPreviousExamResponse>(
    "/api/admin/assignment-workspace/previous-exam",
    {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    },
    "최근 시험을 불러오지 못했습니다.",
  );
}

export async function loadAssignmentDatasetUnits(
  datasetId: string,
  signal?: AbortSignal,
) {
  return readJson<AssignmentDatasetUnitsResponse>(
    `/api/admin/assignment-workspace/datasets/${encodeURIComponent(datasetId)}/units`,
    { method: "GET", signal },
    "시험 범위를 불러오지 못했습니다.",
  );
}

export async function loadAssignmentDatasetDirectory(
  signal?: AbortSignal,
) {
  return readJson<AssignmentDatasetDirectoryResponse>(
    "/api/admin/assignment-workspace/datasets",
    { method: "GET", signal },
    "단어장 목록을 불러오지 못했습니다.",
  );
}

export async function loadAssignmentEditContext(
  input: { assignmentId: string; studentId: string },
  signal?: AbortSignal,
) {
  const payload = await readJson<{ context: AssignmentEditContext }>(
    `/api/admin/assignments/${encodeURIComponent(input.assignmentId)}/students/${encodeURIComponent(input.studentId)}/edit-context`,
    { method: "GET", signal },
    "수정 준비 자료를 불러오지 못했습니다.",
  );
  if (
    payload.context.initialEditDraft.assignmentId !== input.assignmentId ||
    payload.context.initialEditDraft.studentId !== input.studentId
  ) {
    throw new Error("수정 대상이 응답과 다릅니다.");
  }
  return payload.context;
}
