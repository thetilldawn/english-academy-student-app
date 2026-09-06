import { directoryCacheResponseSchema, StudentDirectoryRequestError, type DirectoryCacheRequest } from "../contracts/student-directory-cache-contract";

export async function readStudentDirectoryCache(request: DirectoryCacheRequest, signal?: AbortSignal) {
  const response = await fetch("/api/admin/students/directory", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(request), cache: "no-store", signal,
  });
  if (!response.ok) throw new StudentDirectoryRequestError(response.status);
  const parsed = directoryCacheResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new StudentDirectoryRequestError(502);
  return parsed.data;
}
