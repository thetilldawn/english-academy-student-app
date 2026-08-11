import { adminStudentsText } from "@/content/ko/admin-students";

type StudentMutationResponse = {
  code?: string;
  error?: string;
};

async function requestStudentMutation(
  url: string,
  options?: RequestInit,
): Promise<StudentMutationResponse> {
  const response = await fetch(url, options);
  let payload: StudentMutationResponse = {};
  try {
    payload = (await response.json()) as StudentMutationResponse;
  } catch {
    // 프록시 오류처럼 JSON이 아닌 응답은 안전한 공통 문구로 처리한다.
  }
  if (!response.ok) {
    throw new Error(
      payload.error ?? adminStudentsText.codeModal.genericRequestError,
    );
  }
  return payload;
}
function jsonRequest(method: "PATCH" | "POST", body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createStudent(input: {
  currentVocabDatasetId: FormDataEntryValue | null;
  displayName: FormDataEntryValue | null;
  gradeLabel: FormDataEntryValue | null;
  note: FormDataEntryValue | null;
  schoolName: FormDataEntryValue | null;
}) {
  return requestStudentMutation(
    "/api/admin/students",
    jsonRequest("POST", input),
  );
}

export function updateStudentProfile(
  studentId: string,
  input: { displayName: string; gradeLabel: string; schoolName: string },
) {
  return requestStudentMutation(
    `/api/admin/students/${studentId}`,
    jsonRequest("PATCH", input),
  );
}

export function updateStudentDataset(studentId: string, datasetId: string) {
  return requestStudentMutation(
    `/api/admin/students/${studentId}/vocab`,
    jsonRequest("PATCH", { currentVocabDatasetId: datasetId }),
  );
}

export function revealStudentCode(studentId: string) {
  return requestStudentMutation(`/api/admin/students/${studentId}/code`);
}

export function rotateStudentCode(studentId: string) {
  return requestStudentMutation(
    `/api/admin/students/${studentId}/code/rotate`,
    { method: "POST" },
  );
}

export function blockStudent(studentId: string) {
  return requestStudentMutation(
    `/api/admin/students/${studentId}/status`,
    jsonRequest("PATCH", { status: "blocked" }),
  );
}

export function deleteStudent(studentId: string) {
  return requestStudentMutation(`/api/admin/students/${studentId}`, {
    method: "DELETE",
  });
}
