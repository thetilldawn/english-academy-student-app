import type {
  StudentDirectoryReadRequest,
} from "../contracts/student-directory-read-model";
import { z } from "zod";
import { directorySnapshotSchema, studentDirectoryListItemSchema, StudentDirectoryRequestError } from "../contracts/student-directory-cache-contract";
const pageResponseSchema = z.object({ page: z.object({ items: z.array(studentDirectoryListItemSchema).max(10), nextCursor: z.string().nullable() }) });
const snapshotResponseSchema = z.object({ snapshot: directorySnapshotSchema });

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
  if (!response.ok) throw new StudentDirectoryRequestError(response.status);
  return response.json().catch(() => null) as Promise<unknown>;
}
export async function loadStudentDirectorySnapshot(
  request: Extract<StudentDirectoryReadRequest, { mode: "initial" }>,
  signal?: AbortSignal,
) {
  const payload = await requestStudentDirectory(request, signal);
  const parsed = snapshotResponseSchema.safeParse(payload);
  if (!parsed.success) throw new StudentDirectoryRequestError(502);
  return parsed.data.snapshot;
}

export async function loadStudentDirectoryNextPage(
  request: Extract<StudentDirectoryReadRequest, { mode: "page" }>,
  signal?: AbortSignal,
) {
  const payload = await requestStudentDirectory(request, signal);
  const parsed = pageResponseSchema.safeParse(payload);
  if (!parsed.success) throw new StudentDirectoryRequestError(502);
  return parsed.data.page;
}
